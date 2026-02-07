import { ipcMain, app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { Buffer as Buffer$1 } from "node:buffer";
import { AssemblyAI } from "assemblyai";
import { generateKeyPairSync, createHash, createPrivateKey, sign } from "node:crypto";
const KEY_FILE = "openclaw-device-key.json";
function getKeyPath(userDataPath) {
  return path.join(userDataPath, KEY_FILE);
}
function getOrCreateDeviceKey(userDataPath) {
  const keyPath = getKeyPath(userDataPath);
  if (existsSync(keyPath)) {
    try {
      const raw = readFileSync(keyPath, "utf-8");
      const data = JSON.parse(raw);
      if (data.publicKeyBase64 && data.privateKeyPem && data.deviceId) {
        return data;
      }
    } catch {
    }
  }
  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { format: "jwk" },
    privateKeyEncoding: { format: "pkcs8", type: "pkcs8" }
  });
  const rawPub = Buffer.from(publicKey.x, "base64url");
  const publicKeyBase64 = rawPub.toString("base64");
  const base64 = privateKey.toString("base64");
  const pem = `-----BEGIN PRIVATE KEY-----
${base64.replace(/(.{64})/g, "$1\n").trimEnd()}
-----END PRIVATE KEY-----`;
  const deviceId = "molty-kiosk-" + createHash("sha256").update(rawPub).digest("hex").slice(0, 16);
  const deviceKey = {
    publicKeyBase64,
    privateKeyPem: pem,
    deviceId
  };
  try {
    mkdirSync(userDataPath, { recursive: true });
    writeFileSync(keyPath, JSON.stringify(deviceKey, null, 0), "utf-8");
  } catch (e) {
    console.warn("[deviceAttestation] Could not persist device key:", e);
  }
  return deviceKey;
}
function signChallenge(nonce, privateKeyPem) {
  const key = createPrivateKey({
    key: privateKeyPem,
    format: "pem"
  });
  const signedAt = Date.now();
  const payload = Buffer.from(nonce, "utf-8");
  const sig = sign(null, payload, key);
  return {
    signature: sig.toString("base64"),
    signedAt
  };
}
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname$1, "..");
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
}
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
const OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL ?? "wss://molty.somehow.dev/";
const OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;
let ws = null;
let wsStatus = "disconnected";
let wsError = null;
let pendingConnectId = null;
let tickIntervalId = null;
let win;
const assemblyai = process.env.ASSEMBLYAI_API_KEY ? new AssemblyAI({ apiKey: process.env.ASSEMBLYAI_API_KEY }) : null;
let transcriber = null;
async function startTranscriber() {
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
      sampleRate: 16e3,
      formatTurns: true
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
  } catch (err) {
    transcriber = null;
    const message = err instanceof Error ? err.message : "Failed to start transcriber";
    console.error("[STT] Failed to start:", message);
    return { ok: false, error: message };
  }
}
async function stopTranscriber() {
  if (!transcriber) {
    return { ok: true };
  }
  try {
    await transcriber.close();
  } catch {
  }
  transcriber = null;
  return { ok: true };
}
function normalizeGatewayUrl(rawUrl) {
  if (rawUrl.startsWith("https://")) return `wss://${rawUrl.slice(8)}`;
  if (rawUrl.startsWith("http://")) return `ws://${rawUrl.slice(7)}`;
  return rawUrl;
}
function buildGatewayUrl() {
  if (!OPENCLAW_GATEWAY_TOKEN) return null;
  const url = new URL(normalizeGatewayUrl(OPENCLAW_GATEWAY_URL));
  url.searchParams.set("token", OPENCLAW_GATEWAY_TOKEN);
  return url.toString();
}
function getStatusPayload() {
  return { status: wsStatus, error: wsError };
}
function broadcastStatus() {
  const payload = getStatusPayload();
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("openclaw:status", payload);
  }
}
function broadcastMessage(direction, data) {
  const payload = {
    direction,
    data,
    ts: Date.now()
  };
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("openclaw:message", payload);
  }
}
function setStatus(next, error = null) {
  wsStatus = next;
  wsError = error;
  broadcastStatus();
}
function startGatewayTick(socket, intervalMs) {
  stopGatewayTick();
  tickIntervalId = setInterval(() => {
    if (ws !== socket || wsStatus !== "connected") return;
    try {
      const tickReq = JSON.stringify({
        type: "req",
        id: `tick-${Date.now()}`,
        method: "status",
        params: {}
      });
      socket.send(tickReq);
    } catch {
    }
  }, intervalMs);
}
function stopGatewayTick() {
  if (tickIntervalId !== null) {
    clearInterval(tickIntervalId);
    tickIntervalId = null;
  }
}
function toText(data) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer$1.from(data).toString("utf8");
  if (ArrayBuffer.isView(data))
    return Buffer$1.from(data.buffer).toString("utf8");
  if (Buffer$1.isBuffer(data)) return data.toString("utf8");
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}
function attachSocketHandlers(socket) {
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
  const handleMessage = (...args) => {
    const eventOrData = args[0];
    const data = eventOrData?.data ?? eventOrData;
    const text = toText(data);
    console.log("[Gateway] ← IN:", text.slice(0, 200));
    try {
      const msg = JSON.parse(text);
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
              mode: "operator"
            },
            role: "operator",
            scopes: ["operator.read", "operator.write"],
            caps: ["voice"],
            commands: [],
            permissions: {},
            auth: {
              token: OPENCLAW_GATEWAY_TOKEN
            },
            locale: "en-US",
            userAgent: "molty-kiosk/1.0.0",
            device: {
              id: deviceKey.deviceId,
              publicKey: deviceKey.publicKeyBase64,
              signature,
              signedAt,
              nonce
            }
          }
        });
        socket.send(connectReq);
        console.log("[Gateway] → OUT: connect request sent");
        broadcastMessage("out", connectReq);
        broadcastMessage("in", text);
        return;
      }
      if (msg?.type === "res" && msg?.id === pendingConnectId) {
        pendingConnectId = null;
        if (msg.ok) {
          const payload = msg.payload;
          console.log(
            "[Gateway] Connect response OK (hello-ok):",
            JSON.stringify(payload).slice(0, 200)
          );
          setStatus("connected");
          broadcastMessage("system", "Gateway authenticated and connected");
          const tickMs = payload?.policy?.tickIntervalMs ?? 15e3;
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
      if (msg?.type === "res") {
        broadcastMessage("in", text);
        return;
      }
    } catch {
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
function connectGateway() {
  if (wsStatus === "connected" || wsStatus === "connecting") {
    return getStatusPayload();
  }
  const url = buildGatewayUrl();
  if (!url) {
    setStatus("error", "Missing OPENCLAW_GATEWAY_TOKEN");
    return getStatusPayload();
  }
  const WebSocketCtor = globalThis.WebSocket;
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
function disconnectGateway() {
  pendingConnectId = null;
  stopGatewayTick();
  if (ws) {
    try {
      ws.close();
    } catch {
    }
    ws = null;
  }
  if (wsStatus !== "disconnected") {
    setStatus("disconnected");
  }
  return getStatusPayload();
}
function sendGateway(payload) {
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
function createWindow() {
  const isKiosk = process.argv.includes("--kiosk") || process.env.KIOSK === "true";
  win = new BrowserWindow({
    width: 320,
    height: 480,
    kiosk: isKiosk,
    alwaysOnTop: isKiosk,
    frame: !isKiosk,
    resizable: false,
    title: "kiosk",
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs")
    }
  });
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
ipcMain.handle("openclaw:connect", () => connectGateway());
ipcMain.handle("openclaw:disconnect", () => disconnectGateway());
ipcMain.handle("openclaw:get-status", () => getStatusPayload());
ipcMain.handle("openclaw:send", (_event, payload) => sendGateway(payload));
ipcMain.handle("openclaw:start-listening", () => startTranscriber());
ipcMain.handle("openclaw:stop-listening", () => stopTranscriber());
ipcMain.on("openclaw:audio-chunk", (_event, pcmData) => {
  if (transcriber) {
    const buf = Buffer$1.from(pcmData);
    transcriber.sendAudio(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    );
  }
});
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
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
