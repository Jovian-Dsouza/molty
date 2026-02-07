import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { AssemblyAI } from "assemblyai";
import { getOrCreateDeviceKey, signChallenge } from "./deviceAttestation";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

process.env.APP_ROOT = path.join(__dirname, "..");

// Load .env into the Electron main process (Vite only injects VITE_* into the renderer)
try {
  const envPath = path.join(process.env.APP_ROOT, ".env");
  const envFile = readFileSync(envPath, "utf-8");
  for (const line of envFile.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const value = trimmed.slice(idx + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
} catch {
  // .env file may not exist; that's fine
}
export const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
export const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
export const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(process.env.APP_ROOT, "public")
  : RENDERER_DIST;

type OpenClawStatus = "disconnected" | "connecting" | "connected" | "error";

type OpenClawStatusPayload = {
  status: OpenClawStatus;
  error?: string | null;
};

type OpenClawMessagePayload = {
  direction: "in" | "out" | "system";
  data: string;
  ts: number;
};

type WebSocketLike = {
  send: (data: string | ArrayBuffer | Buffer) => void;
  close: () => void;
  addEventListener?: (
    event: string,
    handler: (...args: unknown[]) => void
  ) => void;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
};

const OPENCLAW_GATEWAY_URL =
  process.env.OPENCLAW_GATEWAY_URL ?? "wss://molty.somehow.dev/";
const OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;

let ws: WebSocketLike | null = null;
let wsStatus: OpenClawStatus = "disconnected";
let wsError: string | null = null;
/** Id of the pending connect request; we only treat res with this id as handshake result. */
let pendingConnectId: string | null = null;
/** Keepalive timer per gateway policy.tickIntervalMs (e.g. 15000). */
let tickIntervalId: ReturnType<typeof setInterval> | null = null;

let win: BrowserWindow | null;

// ── AssemblyAI Streaming STT ──────────────────────────────────────────────

const assemblyai = process.env.ASSEMBLYAI_API_KEY
  ? new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY })
  : null;

type StreamingTranscriberInstance = ReturnType<
  NonNullable<typeof assemblyai>["streaming"]["transcriber"]
>;
let transcriber: StreamingTranscriberInstance | null = null;

async function startTranscriber(): Promise<{ ok: boolean; error?: string }> {
  if (!assemblyai) {
    console.log("[STT] No ASSEMBLYAI_API_KEY set, skipping");
    return { ok: false, error: "Missing ASSEMBLYAI_API_KEY" };
  }
  if (transcriber) {
    console.log("[STT] Transcriber already running");
    return { ok: true };
  }

  try {
    console.log("[STT] Creating streaming transcriber...");
    transcriber = assemblyai.streaming.transcriber({
      sampleRate: 16_000,
      formatTurns: true,
    });

    transcriber.on("turn", (turn) => {
      console.log(
        `[STT] Turn: end_of_turn=${turn.end_of_turn} transcript="${turn.transcript}"`
      );
      if (turn.end_of_turn && turn.transcript.trim()) {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send("openclaw:transcript", turn.transcript);
        }
      }
    });

    transcriber.on("error", (err) => {
      console.error("[STT] Error:", err.message);
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send("openclaw:transcript-error", err.message);
      }
    });

    transcriber.on("close", () => {
      console.log("[STT] Transcriber closed");
      transcriber = null;
    });

    await transcriber.connect();
    console.log("[STT] Transcriber connected successfully");
    return { ok: true };
  } catch (err: unknown) {
    transcriber = null;
    const message =
      err instanceof Error ? err.message : "Failed to start transcriber";
    console.error("[STT] Failed to start:", message);
    return { ok: false, error: message };
  }
}

async function stopTranscriber(): Promise<{ ok: boolean; error?: string }> {
  if (!transcriber) {
    return { ok: true };
  }
  try {
    await transcriber.close();
  } catch {
    // best-effort close
  }
  transcriber = null;
  return { ok: true };
}

// ── OpenClaw Gateway ──────────────────────────────────────────────────────

function normalizeGatewayUrl(rawUrl: string) {
  if (rawUrl.startsWith("https://")) return `wss://${rawUrl.slice(8)}`;
  if (rawUrl.startsWith("http://")) return `ws://${rawUrl.slice(7)}`;
  return rawUrl;
}

function buildGatewayUrl(): string | null {
  if (!OPENCLAW_GATEWAY_TOKEN) return null;
  const url = new URL(normalizeGatewayUrl(OPENCLAW_GATEWAY_URL));
  url.searchParams.set("token", OPENCLAW_GATEWAY_TOKEN);
  return url.toString();
}

function getStatusPayload(): OpenClawStatusPayload {
  return { status: wsStatus, error: wsError };
}

function broadcastStatus() {
  const payload = getStatusPayload();
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("openclaw:status", payload);
  }
}

function broadcastMessage(
  direction: OpenClawMessagePayload["direction"],
  data: string
) {
  const payload: OpenClawMessagePayload = {
    direction,
    data,
    ts: Date.now(),
  };
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("openclaw:message", payload);
  }
}

function setStatus(next: OpenClawStatus, error: string | null = null) {
  wsStatus = next;
  wsError = error;
  broadcastStatus();
}

/** Start periodic status/tick send per gateway policy to keep connection alive. */
function startGatewayTick(socket: WebSocketLike, intervalMs: number) {
  stopGatewayTick();
  tickIntervalId = setInterval(() => {
    if (ws !== socket || wsStatus !== "connected") return;
    try {
      const tickReq = JSON.stringify({
        type: "req",
        id: `tick-${Date.now()}`,
        method: "status",
        params: {},
      });
      socket.send(tickReq);
    } catch {
      // ignore
    }
  }, intervalMs);
}

function stopGatewayTick() {
  if (tickIntervalId !== null) {
    clearInterval(tickIntervalId);
    tickIntervalId = null;
  }
}

function toText(data: unknown) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data))
    return Buffer.from(data.buffer as ArrayBuffer).toString("utf8");
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

function attachSocketHandlers(socket: WebSocketLike) {
  const handleOpen = () => {
    console.log("[Gateway] WebSocket open, waiting for challenge...");
    broadcastMessage("system", "WebSocket open, authenticating...");
  };

  const handleClose = () => {
    console.log("[Gateway] Disconnected");
    ws = null;
    pendingConnectId = null;
    stopGatewayTick();
    if (wsStatus !== "error") {
      setStatus("disconnected");
    }
    broadcastMessage("system", "Gateway disconnected");
  };

  const handleError = () => {
    console.error("[Gateway] Connection error");
    setStatus("error", "Gateway connection failed");
    broadcastMessage("system", "Gateway error");
  };

  const handleMessage = (...args: unknown[]) => {
    const eventOrData = args[0];
    const data = (eventOrData as { data?: unknown })?.data ?? eventOrData;
    const text = toText(data);
    console.log("[Gateway] ← IN:", text.slice(0, 200));

    // Handle OpenClaw gateway protocol messages
    try {
      const msg = JSON.parse(text);

      // Step 1: Server sends connect.challenge → we reply with a "connect" RPC request (device attestation)
      if (msg?.type === "event" && msg?.event === "connect.challenge") {
        const nonce = String(msg.payload?.nonce ?? "");
        console.log(
          "[Gateway] Got connect.challenge, sending connect request (device attestation)..."
        );
        const userData = app.getPath("userData");
        const deviceKey = getOrCreateDeviceKey(userData);
        const { signature, signedAt } = signChallenge(
          nonce,
          deviceKey.privateKeyPem
        );
        const connectReqId = `connect-${Date.now()}`;
        pendingConnectId = connectReqId;
        const connectReq = JSON.stringify({
          type: "req",
          id: connectReqId,
          method: "connect",
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
              id: "molty-kiosk",
              version: "1.0.0",
              platform: process.platform,
              mode: "operator",
            },
            role: "operator",
            scopes: ["operator.read", "operator.write"],
            caps: ["voice"],
            commands: [],
            permissions: {},
            auth: {
              token: OPENCLAW_GATEWAY_TOKEN,
            },
            locale: "en-US",
            userAgent: "molty-kiosk/1.0.0",
            device: {
              id: deviceKey.deviceId,
              publicKey: deviceKey.publicKeyBase64,
              signature,
              signedAt,
              nonce,
            },
          },
        });
        socket.send(connectReq);
        console.log("[Gateway] → OUT: connect request sent");
        broadcastMessage("out", connectReq);
        broadcastMessage("in", text);
        return;
      }

      // Step 2: Server responds to our connect request (match by id per protocol)
      if (msg?.type === "res" && msg?.id === pendingConnectId) {
        pendingConnectId = null;
        if (msg.ok) {
          const payload = msg.payload as
            | {
                type?: string;
                policy?: { tickIntervalMs?: number };
              }
            | undefined;
          console.log(
            "[Gateway] Connect response OK (hello-ok):",
            JSON.stringify(payload).slice(0, 200)
          );
          setStatus("connected");
          broadcastMessage("system", "Gateway authenticated and connected");
          // Start keepalive tick per gateway policy (default 15s)
          const tickMs = payload?.policy?.tickIntervalMs ?? 15_000;
          startGatewayTick(socket, tickMs);
        } else {
          console.error(
            "[Gateway] Connect response ERROR:",
            JSON.stringify(msg.error)
          );
          setStatus(
            "error",
            msg.error?.message ?? "Gateway authentication failed"
          );
          broadcastMessage(
            "system",
            `Auth failed: ${msg.error?.message ?? "unknown error"}`
          );
        }
        broadcastMessage("in", text);
        return;
      }

      // Other res (e.g. status, tick response) — forward to UI only
      if (msg?.type === "res") {
        broadcastMessage("in", text);
        return;
      }
    } catch {
      // Not JSON, pass through
    }

    broadcastMessage("in", text);
  };

  if (typeof socket.addEventListener === "function") {
    socket.addEventListener("open", handleOpen);
    socket.addEventListener("message", handleMessage);
    socket.addEventListener("close", handleClose);
    socket.addEventListener("error", handleError);
    return;
  }

  if (typeof socket.on === "function") {
    socket.on("open", handleOpen);
    socket.on("message", handleMessage);
    socket.on("close", handleClose);
    socket.on("error", handleError);
  }
}

function connectGateway(): OpenClawStatusPayload {
  if (wsStatus === "connected" || wsStatus === "connecting") {
    return getStatusPayload();
  }

  const url = buildGatewayUrl();
  if (!url) {
    setStatus("error", "Missing OPENCLAW_GATEWAY_TOKEN");
    return getStatusPayload();
  }

  const WebSocketCtor = (globalThis as Record<string, unknown>).WebSocket as
    | (new (url: string) => WebSocketLike)
    | undefined;
  if (!WebSocketCtor) {
    setStatus("error", "WebSocket not available in main process");
    return getStatusPayload();
  }

  console.log("[Gateway] Connecting to", OPENCLAW_GATEWAY_URL);
  setStatus("connecting");
  try {
    ws = new WebSocketCtor(url);
    attachSocketHandlers(ws);
    broadcastMessage("system", "Connecting to OpenClaw gateway...");
  } catch (err) {
    console.error("[Gateway] Failed to connect:", err);
    setStatus("error", "Failed to start connection");
  }

  return getStatusPayload();
}

function disconnectGateway(): OpenClawStatusPayload {
  pendingConnectId = null;
  stopGatewayTick();
  if (ws) {
    try {
      ws.close();
    } catch {
      // best-effort close
    }
    ws = null;
  }

  if (wsStatus !== "disconnected") {
    setStatus("disconnected");
  }

  return getStatusPayload();
}

function sendGateway(payload: unknown): { ok: boolean; error?: string } {
  if (!ws || wsStatus !== "connected") {
    console.log(
      "[Gateway] Cannot send — not connected (status:",
      wsStatus,
      ")"
    );
    return { ok: false, error: "Gateway not connected" };
  }

  const data = typeof payload === "string" ? payload : JSON.stringify(payload);
  console.log("[Gateway] → OUT:", data.slice(0, 200));
  try {
    ws.send(data);
    broadcastMessage("out", data);
    return { ok: true };
  } catch (err) {
    console.error("[Gateway] Send failed:", err);
    return { ok: false, error: "Failed to send message" };
  }
}

// ── Window Creation ───────────────────────────────────────────────────────

function createWindow() {
  const isKiosk =
    process.argv.includes("--kiosk") || process.env.KIOSK === "true";

  win = new BrowserWindow({
    width: 320,
    height: 480,
    kiosk: isKiosk,
    alwaysOnTop: isKiosk,
    frame: !isKiosk,
    resizable: false,
    title: "kiosk",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  // Auto-grant microphone permission (required for getUserMedia in Electron)
  win.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      if (permission === "media") {
        callback(true);
        return;
      }
      callback(false);
    }
  );

  if (isKiosk) {
    win.setMenu(null);
  }

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }

  win.webContents.once("did-finish-load", () => {
    win?.webContents.send("openclaw:status", getStatusPayload());
  });
}

// ── IPC Handlers ──────────────────────────────────────────────────────────

// OpenClaw gateway
ipcMain.handle("openclaw:connect", () => connectGateway());
ipcMain.handle("openclaw:disconnect", () => disconnectGateway());
ipcMain.handle("openclaw:get-status", () => getStatusPayload());
ipcMain.handle("openclaw:send", (_event, payload) => sendGateway(payload));

// AssemblyAI streaming STT
ipcMain.handle("openclaw:start-listening", () => startTranscriber());
ipcMain.handle("openclaw:stop-listening", () => stopTranscriber());
ipcMain.on("openclaw:audio-chunk", (_event, pcmData: ArrayBuffer) => {
  if (transcriber) {
    const buf = Buffer.from(pcmData);
    transcriber.sendAudio(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    );
  }
});

// ── App Lifecycle ─────────────────────────────────────────────────────────

app.on("before-quit", () => {
  disconnectGateway();
  stopTranscriber();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.whenReady().then(() => createWindow());
