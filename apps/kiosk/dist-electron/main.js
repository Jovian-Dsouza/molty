import { ipcMain, app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { AssemblyAI } from "assemblyai";
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
      console.log(`[STT] Turn: end_of_turn=${turn.end_of_turn} transcript="${turn.transcript}"`);
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
function toText(data) {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data))
    return Buffer.from(data.buffer).toString("utf8");
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}
function attachSocketHandlers(socket) {
  const handleOpen = () => {
    console.log("[Gateway] Connected");
    setStatus("connected");
    broadcastMessage("system", "Gateway connected");
  };
  const handleClose = () => {
    console.log("[Gateway] Disconnected");
    ws = null;
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
    console.log("[Gateway] Cannot send — not connected (status:", wsStatus, ")");
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
    const buf = Buffer.from(pcmData);
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
