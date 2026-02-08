import { app, BrowserWindow, ipcMain } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { spawn, type ChildProcess } from "node:child_process";
import { AssemblyAI } from "assemblyai";
import {
  getOrCreateDeviceKey,
  signChallenge,
  publicKeyRawBase64Url,
} from "./deviceAttestation";

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
// Note: minimal device mode (id-only) is no longer supported by the gateway schema.
// The gateway requires publicKey, signature, signedAt when device is present.

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
      keyterms: ["Molty"],
      // Conservative turn detection — give users more time to pause/think
      // before the turn is considered complete (prevents premature sends).
      endOfTurnConfidenceThreshold: 0.7,
      minEndOfTurnSilenceWhenConfident: 800,
      maxTurnSilence: 3600,
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

// ── Hume AI TTS (Octave) — Streaming ─────────────────────────────────────

const HUME_API_KEY = process.env.HUME_API_KEY;
// Optional: set a named voice from Hume's Voice Library (e.g. "Dacher", "Ava Song").
// If empty, a dynamic voice is generated from HUME_VOICE_DESCRIPTION each request.
const HUME_VOICE_NAME = process.env.HUME_VOICE_NAME || "";
// Describes the voice character. Used as voice-design prompt (no voice name) or acting
// instructions (with a voice name). Molty is an enthusiastic lobster robot.
const HUME_VOICE_DESCRIPTION =
  process.env.HUME_VOICE_DESCRIPTION ||
  "Upbeat, enthusiastic, and playful masculine voice with high energy. Speaks quickly and expressively, like an excited robot mascot. Occasionally dramatic.";

/** Abort controller for the currently active Hume TTS stream. */
let humeAbortController: AbortController | null = null;

/**
 * Stream audio from Hume's TTS API and push each chunk to the renderer
 * via IPC events so playback can begin immediately.
 *
 * Sends:
 *   hume:audio-chunk (base64 string)  — one per audio snippet
 *   hume:audio-done                   — stream finished successfully
 *   hume:audio-error (string)         — stream failed
 */
async function humeStreamSpeak(text: string): Promise<{ ok: boolean; error?: string }> {
  if (!HUME_API_KEY) {
    console.log("[Hume TTS] No HUME_API_KEY set, skipping");
    broadcastHume("hume:audio-error", "Missing HUME_API_KEY");
    return { ok: false, error: "Missing HUME_API_KEY" };
  }

  // Abort any previous synthesis that may still be running
  if (humeAbortController) {
    humeAbortController.abort();
  }
  humeAbortController = new AbortController();
  const { signal } = humeAbortController;

  try {
    console.log("[Hume TTS] Streaming:", text.slice(0, 100));

    // Build utterance — optionally with a named voice
    const utterance: Record<string, unknown> = {
      text,
      description: HUME_VOICE_DESCRIPTION,
    };
    if (HUME_VOICE_NAME) {
      utterance.voice = { name: HUME_VOICE_NAME, provider: "HUME_AI" };
    }

    const body: Record<string, unknown> = {
      utterances: [utterance],
      format: { type: "mp3" },
      num_generations: 1,
      // Each chunk is its own complete MP3 file so the renderer can decode independently
      strip_headers: false,
    };

    // instant_mode is on by default and requires a named voice
    if (HUME_VOICE_NAME) {
      body.instant_mode = true;
    } else {
      body.instant_mode = false;
    }

    const response = await fetch("https://api.hume.ai/v0/tts/stream/json", {
      method: "POST",
      headers: {
        "X-Hume-Api-Key": HUME_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[Hume TTS] API error:", response.status, errText.slice(0, 300));
      const errMsg = `Hume API error (${response.status}): ${errText.slice(0, 200)}`;
      broadcastHume("hume:audio-error", errMsg);
      return { ok: false, error: errMsg };
    }

    // Read the streaming response — newline-delimited JSON
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let jsonBuf = "";
    let chunkCount = 0;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      jsonBuf += decoder.decode(value, { stream: true });

      // Split on newlines — each complete line is one JSON object
      const lines = jsonBuf.split("\n");
      jsonBuf = lines.pop()!; // keep incomplete trailing line

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const chunk = JSON.parse(trimmed) as { type?: string; audio?: string };
          if (chunk.type === "audio" && chunk.audio) {
            chunkCount++;
            console.log(`[Hume TTS] Chunk #${chunkCount}, base64 len=${chunk.audio.length}`);
            broadcastHume("hume:audio-chunk", chunk.audio);
          }
        } catch {
          // skip malformed lines
        }
      }
    }

    // Process any remaining data in the buffer
    if (jsonBuf.trim()) {
      try {
        const chunk = JSON.parse(jsonBuf.trim()) as { type?: string; audio?: string };
        if (chunk.type === "audio" && chunk.audio) {
          chunkCount++;
          console.log(`[Hume TTS] Chunk #${chunkCount} (final), base64 len=${chunk.audio.length}`);
          broadcastHume("hume:audio-chunk", chunk.audio);
        }
      } catch {
        // skip
      }
    }

    console.log(`[Hume TTS] Stream complete — ${chunkCount} chunks sent`);
    broadcastHume("hume:audio-done");
    return { ok: true };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      console.log("[Hume TTS] Stream aborted (interrupted)");
      return { ok: false, error: "Aborted" };
    }
    const message = err instanceof Error ? err.message : "Hume TTS streaming failed";
    console.error("[Hume TTS] Stream error:", message);
    broadcastHume("hume:audio-error", message);
    return { ok: false, error: message };
  } finally {
    humeAbortController = null;
  }
}

/** Abort the current Hume TTS stream (if any). */
function humeStopSpeaking() {
  if (humeAbortController) {
    humeAbortController.abort();
    humeAbortController = null;
  }
}

/** Broadcast an IPC event to all renderer windows. */
function broadcastHume(channel: string, data?: string) {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(channel, data);
  }
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

  const handleClose = (...args: unknown[]) => {
    const ev = args[0] as { code?: number; reason?: string } | undefined;
    const code =
      typeof ev?.code === "number"
        ? ev.code
        : typeof args[0] === "number"
        ? args[0]
        : undefined;
    const reason =
      typeof ev?.reason === "string"
        ? ev.reason
        : typeof args[1] === "string"
        ? args[1]
        : undefined;
    console.log(
      "[Gateway] Disconnected",
      code != null ? `(code=${code}` : "",
      reason ? ` reason=${reason})` : code != null ? ")" : ""
    );
    const wasConnecting = wsStatus === "connecting";
    ws = null;
    pendingConnectId = null;
    stopGatewayTick();
    if (wsStatus !== "error") {
      setStatus("disconnected");
    }
    broadcastMessage("system", "Gateway disconnected");
    // When server closes during handshake, device likely needs approval on gateway (openclaw devices list → approve)
    if (wasConnecting && wsStatus === "disconnected") {
      const instructions =
        "Device may need approval. On the gateway server run: openclaw devices list, then openclaw devices approve <requestId>. Then connect again.";
      setStatus("error", instructions);
      broadcastMessage("system", instructions);
    }
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
    let msg: Record<string, unknown> | undefined;
    try {
      msg = JSON.parse(text);
    } catch {
      // Not JSON — pass through to UI
      broadcastMessage("in", text);
      return;
    }

    // Step 1: Server sends connect.challenge → we reply with a "connect" RPC request (device attestation)
    if (msg?.type === "event" && msg?.event === "connect.challenge") {
      try {
        const nonce = String(
          (msg.payload as Record<string, unknown>)?.nonce ?? ""
        );
        const userData = app.getPath("userData");
        const deviceKey = getOrCreateDeviceKey(userData);

        // Client identity constants (must match OpenClaw's GATEWAY_CLIENT_IDS/MODES)
        const clientId = "cli";
        const clientMode = "cli";
        const role = "operator";
        const scopes = ["operator.read", "operator.write"];

        console.log(
          "[Gateway] Got connect.challenge, sending connect request (device attestation)..."
        );

        const { signature, signedAt } = signChallenge({
          nonce,
          privateKeyPem: deviceKey.privateKeyPem,
          deviceId: deviceKey.deviceId,
          clientId,
          clientMode,
          role,
          scopes,
          token: OPENCLAW_GATEWAY_TOKEN ?? null,
        });

        const connectReqId = `connect-${Date.now()}`;
        pendingConnectId = connectReqId;

        const deviceParams = {
          id: deviceKey.deviceId,
          publicKey: publicKeyRawBase64Url(deviceKey.publicKeyPem),
          signature,
          signedAt,
          nonce,
        };

        const connectReq = JSON.stringify({
          type: "req",
          id: connectReqId,
          method: "connect",
          params: {
            minProtocol: 3,
            maxProtocol: 3,
            client: {
              id: clientId,
              version: "1.0.0",
              platform: process.platform,
              mode: clientMode,
            },
            role,
            scopes,
            caps: ["voice"],
            auth: {
              token: OPENCLAW_GATEWAY_TOKEN,
            },
            locale: "en-US",
            userAgent: "openclaw-cli/1.0.0 molty-kiosk",
            device: deviceParams,
          },
        });
        socket.send(connectReq);
        console.log("[Gateway] → OUT: connect request sent");
        broadcastMessage("out", connectReq);
      } catch (err) {
        const errMsg =
          err instanceof Error ? err.message : String(err);
        console.error(
          "[Gateway] Failed to handle connect.challenge:",
          errMsg,
          err instanceof Error ? err.stack : ""
        );
        setStatus(
          "error",
          `Device attestation failed: ${errMsg}. Try deleting the device key and restarting.`
        );
        broadcastMessage(
          "system",
          `Device attestation error: ${errMsg}`
        );
      }
      broadcastMessage("in", text);
      return;
    }

    // Step 2: Server responds to our connect request (match by id per protocol)
    if (msg?.type === "res" && msg?.id === pendingConnectId) {
      pendingConnectId = null;
      const payload = msg.payload as
        | {
            type?: string;
            policy?: { tickIntervalMs?: number };
            requestId?: string;
          }
        | undefined;
      const errPayload = msg.error as
        | {
            message?: string;
            requestId?: string;
            details?: { requestId?: string };
          }
        | undefined;
      const requestId =
        payload?.requestId ??
        errPayload?.requestId ??
        errPayload?.details?.requestId ??
        (payload as Record<string, unknown>)?.pairingRequestId;

      if (msg.ok) {
        // hello-ok = connected; hello-pending = device pending approval (some gateways send this before closing)
        if (payload?.type === "hello-pending" && requestId) {
          const instructions = `Device pending approval. On the gateway server run: openclaw devices approve ${requestId}`;
          console.log("[Gateway]", instructions);
          setStatus("error", instructions);
          broadcastMessage("system", instructions);
        } else if (payload?.type === "hello-ok" || !payload?.type) {
          console.log(
            "[Gateway] Connect response OK (hello-ok):",
            JSON.stringify(payload).slice(0, 200)
          );
          setStatus("connected");
          broadcastMessage("system", "Gateway authenticated and connected");
          const tickMs = payload?.policy?.tickIntervalMs ?? 15_000;
          startGatewayTick(socket, tickMs);
        } else {
          setStatus("connected");
          broadcastMessage("system", "Gateway authenticated and connected");
          const tickMs = payload?.policy?.tickIntervalMs ?? 15_000;
          startGatewayTick(socket, tickMs);
        }
      } else {
        const err = msg.error as { message?: string } | undefined;
        const baseError = err?.message ?? "Gateway authentication failed";
        const instructions = requestId
          ? `On the gateway server run: openclaw devices list, then openclaw devices approve ${requestId}. Then connect again.`
          : "On the gateway server run: openclaw devices list (to see pending devices), then openclaw devices approve <requestId>. Then connect again.";
        const fullError = baseError + ". " + instructions;
        console.error(
          "[Gateway] Connect response ERROR:",
          baseError,
          requestId ? `requestId=${requestId}` : ""
        );
        setStatus("error", fullError);
        broadcastMessage("system", fullError);
      }
      broadcastMessage("in", text);
      return;
    }

    // Other res (e.g. status, tick response) — forward to UI only
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

// ── Motor Controller (Python subprocess) ──────────────────────────────────

let motorProcess: ChildProcess | null = null;
let motorReady = false;

function startMotorController() {
  const scriptPath = path.join(
    process.env.APP_ROOT!,
    "..",
    "..",
    "scripts",
    "motor_controller.py"
  );

  console.log("[Motors] Starting motor controller:", scriptPath);

  try {
    motorProcess = spawn("python3", [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err) {
    console.error("[Motors] Failed to spawn python3:", err);
    return;
  }

  motorProcess.on("error", (err) => {
    console.error("[Motors] Process error:", err.message);
    motorProcess = null;
    motorReady = false;
  });

  motorProcess.on("exit", (code, signal) => {
    console.log("[Motors] Process exited", code != null ? `code=${code}` : "", signal ?? "");
    motorProcess = null;
    motorReady = false;
  });

  // Parse stdout for status JSON lines
  let stdoutBuf = "";
  motorProcess.stdout!.on("data", (chunk: Buffer) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split("\n");
    stdoutBuf = lines.pop()!;

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const status = JSON.parse(trimmed) as { type: string; status: string; message: string };
        console.log(`[Motors] Status: ${status.status} ${status.message}`);
        if (status.status === "ready") {
          motorReady = true;
        }
        for (const w of BrowserWindow.getAllWindows()) {
          w.webContents.send("motors:status", status);
        }
      } catch {
        console.log("[Motors] stdout:", trimmed);
      }
    }
  });

  motorProcess.stderr!.on("data", (chunk: Buffer) => {
    console.error("[Motors] stderr:", chunk.toString().trim());
  });
}

function sendMotorCommand(cmd: Record<string, unknown>): { ok: boolean; error?: string } {
  if (!motorProcess || !motorProcess.stdin || !motorReady) {
    return { ok: false, error: "Motor controller not ready" };
  }
  try {
    motorProcess.stdin.write(JSON.stringify(cmd) + "\n");
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to send motor command";
    console.error("[Motors] Send error:", message);
    return { ok: false, error: message };
  }
}

function stopMotorController(): Promise<void> {
  return new Promise((resolve) => {
    if (!motorProcess) {
      resolve();
      return;
    }

    // Send shutdown command
    try {
      motorProcess.stdin!.write(JSON.stringify({ command: "shutdown" }) + "\n");
    } catch {
      // stdin may already be closed
    }

    // Give it 2s to exit gracefully, then SIGTERM
    const timeout = setTimeout(() => {
      if (motorProcess) {
        console.log("[Motors] Sending SIGTERM after timeout");
        motorProcess.kill("SIGTERM");
      }
      resolve();
    }, 2000);

    motorProcess.on("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
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

// Hume AI TTS (streaming)
ipcMain.handle("hume:speak", (_event, text: string) => {
  if (!HUME_API_KEY) {
    return { ok: false, error: "Missing HUME_API_KEY" };
  }
  // Start streaming in the background — return immediately so the renderer
  // can set up its event listeners before the first chunk arrives.
  humeStreamSpeak(text).catch((err: unknown) => {
    console.error("[Hume TTS] Unhandled stream error:", err);
  });
  return { ok: true };
});
ipcMain.handle("hume:stop", () => { humeStopSpeaking(); return { ok: true }; });

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

// Motor controller
ipcMain.handle("motors:command", (_event, cmd: Record<string, unknown>) => sendMotorCommand(cmd));
ipcMain.handle("motors:set-emotion", (_event, emotion: string) =>
  sendMotorCommand({ command: "set_emotion", emotion })
);
ipcMain.handle("motors:stop", () => sendMotorCommand({ command: "stop" }));
ipcMain.handle("motors:set-servos", (_event, angle1: number, angle2: number) =>
  sendMotorCommand({ command: "set_servos", angle1, angle2 })
);

// ── App Lifecycle ─────────────────────────────────────────────────────────

app.on("before-quit", () => {
  disconnectGateway();
  stopTranscriber();
  stopMotorController();
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

app.commandLine.appendSwitch('disable-features', 'AudioServiceSandbox')

app.whenReady().then(() => {
  startMotorController();
  createWindow();
});
