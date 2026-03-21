import { ipcMain, app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { AssemblyAI } from "assemblyai";
import WebSocket from "ws";
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
const PICOCLAW_URL = process.env.PICOCLAW_URL ?? "ws://127.0.0.1:18790/pico/ws";
const PICOCLAW_TOKEN = process.env.PICOCLAW_TOKEN;
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
    console.log("[STT] API key length:", process.env.ASSEMBLYAI_API_KEY?.length ?? 0);
    transcriber = assemblyai.streaming.transcriber({
      sampleRate: 16e3,
      speechModel: "universal-streaming-english",
      formatTurns: true,
      endOfTurnConfidenceThreshold: 0.7,
      minEndOfTurnSilenceWhenConfident: 800,
      maxTurnSilence: 3600
    });
    let connectResolved = false;
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
      console.error("[STT] Error event:", err.message ?? err);
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send("openclaw:transcript-error", err.message);
      }
    });
    transcriber.on("close", (code, reason) => {
      console.log("[STT] Transcriber closed, code:", code, "reason:", reason, "hadConnected:", connectResolved);
      transcriber = null;
    });
    console.log("[STT] Calling transcriber.connect()...");
    await transcriber.connect();
    connectResolved = true;
    console.log("[STT] Transcriber connected successfully");
    return { ok: true };
  } catch (err) {
    transcriber = null;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[STT] Failed to start:", message, err);
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
const HUME_API_KEY = process.env.HUME_API_KEY;
const HUME_VOICE_NAME = process.env.HUME_VOICE_NAME || "";
const HUME_VOICE_DESCRIPTION = process.env.HUME_VOICE_DESCRIPTION || "Upbeat, enthusiastic, and playful masculine voice with high energy. Speaks quickly and expressively, like an excited robot mascot. Occasionally dramatic.";
let humeAbortController = null;
async function humeStreamSpeak(text) {
  if (!HUME_API_KEY) {
    console.log("[Hume TTS] No HUME_API_KEY set, skipping");
    broadcastHume("hume:audio-error", "Missing HUME_API_KEY");
    return { ok: false, error: "Missing HUME_API_KEY" };
  }
  if (humeAbortController) {
    humeAbortController.abort();
  }
  humeAbortController = new AbortController();
  const { signal } = humeAbortController;
  try {
    console.log("[Hume TTS] Streaming:", text.slice(0, 100));
    const utterance = {
      text,
      description: HUME_VOICE_DESCRIPTION
    };
    if (HUME_VOICE_NAME) {
      utterance.voice = { name: HUME_VOICE_NAME, provider: "HUME_AI" };
    }
    const body = {
      utterances: [utterance],
      format: { type: "mp3" },
      num_generations: 1,
      // Each chunk is its own complete MP3 file so the renderer can decode independently
      strip_headers: false
    };
    if (HUME_VOICE_NAME) {
      body.instant_mode = true;
    } else {
      body.instant_mode = false;
    }
    const response = await fetch("https://api.hume.ai/v0/tts/stream/json", {
      method: "POST",
      headers: {
        "X-Hume-Api-Key": HUME_API_KEY,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body),
      signal
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error("[Hume TTS] API error:", response.status, errText.slice(0, 300));
      const errMsg = `Hume API error (${response.status}): ${errText.slice(0, 200)}`;
      broadcastHume("hume:audio-error", errMsg);
      return { ok: false, error: errMsg };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let jsonBuf = "";
    let chunkCount = 0;
    const processJson = (raw) => {
      try {
        const chunk = JSON.parse(raw);
        if (chunk.type === "audio" && chunk.audio) {
          chunkCount++;
          console.log(`[Hume TTS] Chunk #${chunkCount}, base64 len=${chunk.audio.length}`);
          broadcastHume("hume:audio-chunk", chunk.audio);
        } else {
          console.log(`[Hume TTS] Non-audio chunk type=${chunk.type}`);
        }
      } catch {
        console.log(`[Hume TTS] Failed to parse line (len=${raw.length}): ${raw.slice(0, 200)}`);
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const decoded = decoder.decode(value, { stream: true });
      jsonBuf += decoded;
      const lines = jsonBuf.split("\n");
      jsonBuf = lines.pop();
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        processJson(trimmed);
      }
    }
    const remaining = jsonBuf.trim();
    if (remaining) {
      processJson(remaining);
    }
    if (chunkCount === 0) {
      console.warn(`[Hume TTS] 0 chunks extracted. Total buffered bytes: ${jsonBuf.length}`);
    }
    console.log(`[Hume TTS] Stream complete — ${chunkCount} chunks sent`);
    broadcastHume("hume:audio-done");
    return { ok: true };
  } catch (err) {
    if (err.name === "AbortError") {
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
function humeStopSpeaking() {
  if (humeAbortController) {
    humeAbortController.abort();
    humeAbortController = null;
  }
}
function broadcastHume(channel, data) {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(channel, data);
  }
}
function buildGatewayUrl() {
  if (!PICOCLAW_TOKEN) return null;
  const url = new URL(PICOCLAW_URL);
  url.searchParams.set("token", PICOCLAW_TOKEN);
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
    console.log("[Gateway] Pico WebSocket connected to", PICOCLAW_URL);
    setStatus("connected");
    broadcastMessage("system", "Connected to picoclaw gateway");
  };
  const handleClose = (...args) => {
    const ev = args[0];
    const code = typeof ev?.code === "number" ? ev.code : typeof args[0] === "number" ? args[0] : void 0;
    const reason = typeof ev?.reason === "string" ? ev.reason : typeof args[1] === "string" ? args[1] : void 0;
    console.log(
      "[Gateway] Disconnected",
      code != null ? `(code=${code})` : "",
      reason ? `reason=${reason}` : ""
    );
    const wasConnecting = wsStatus === "connecting";
    ws = null;
    if (wsStatus !== "error") {
      setStatus("disconnected");
    }
    broadcastMessage("system", "Gateway disconnected");
    if (wasConnecting && code === 1006) {
      console.error(
        "[Gateway] Connection rejected during handshake — check PICOCLAW_TOKEN value and that picoclaw config has allow_token_query: true"
      );
    }
  };
  const handleError = (...args) => {
    const err = args[0];
    const errDetail = err?.message ?? err?.code ?? "unknown";
    console.error("[Gateway] Connection error:", errDetail, err);
    setStatus("error", `Gateway connection failed: ${errDetail}`);
    broadcastMessage("system", `Gateway error: ${errDetail}`);
  };
  const handleMessage = (...args) => {
    const eventOrData = args[0];
    const data = eventOrData?.data ?? eventOrData;
    let text = toText(data);
    const jsonStart = text.indexOf("{");
    if (jsonStart > 0) {
      text = text.slice(jsonStart);
    }
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      console.log("[Gateway] ← IN (unparseable):", text.slice(0, 200));
      broadcastMessage("in", text);
      return;
    }
    const msgPayload = msg.payload;
    if (msg.type === "message.update" || msg.type === "message.create") {
      const content = msgPayload?.content ?? "";
      console.log(`[Gateway] ← Pico: ${msg.type} content="${content.slice(0, 150)}"`);
    } else {
      console.log("[Gateway] ← Pico:", msg.type);
    }
    if (msg?.type === "ping") {
      const pong = JSON.stringify({ type: "pong", id: msg.id ?? "" });
      try {
        socket.send(pong);
      } catch {
      }
      return;
    }
    broadcastMessage("in", JSON.stringify(msg));
  };
  if (typeof socket.on === "function") {
    socket.on("open", handleOpen);
    socket.on("message", handleMessage);
    socket.on("close", handleClose);
    socket.on("error", handleError);
  } else if (typeof socket.addEventListener === "function") {
    socket.addEventListener("open", handleOpen);
    socket.addEventListener("message", handleMessage);
    socket.addEventListener("close", handleClose);
    socket.addEventListener("error", handleError);
  }
}
function connectGateway() {
  if (wsStatus === "connected" || wsStatus === "connecting") {
    return getStatusPayload();
  }
  const url = buildGatewayUrl();
  if (!url) {
    setStatus("error", "Missing PICOCLAW_TOKEN");
    return getStatusPayload();
  }
  const maskedUrl = url.replace(/token=(.{8})[^&]*/, "token=$1...");
  console.log("[Gateway] Connecting to", maskedUrl);
  console.log("[Gateway] Token length:", PICOCLAW_TOKEN?.length ?? 0);
  setStatus("connecting");
  try {
    ws = new WebSocket(url);
    attachSocketHandlers(ws);
    broadcastMessage("system", "Connecting to picoclaw gateway...");
  } catch (err) {
    console.error("[Gateway] Failed to create WebSocket:", err);
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
    console.log(
      "[Gateway] Cannot send — not connected (status:",
      wsStatus,
      ")"
    );
    return { ok: false, error: "Gateway not connected" };
  }
  const isAlreadyPicoMsg = payload !== null && typeof payload === "object" && typeof payload.type === "string";
  const data = isAlreadyPicoMsg ? JSON.stringify(payload) : JSON.stringify({
    type: "message.send",
    id: `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    payload: {
      content: typeof payload === "string" ? payload : JSON.stringify(payload)
    }
  });
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
let motorProcess = null;
let motorReady = false;
function startMotorController() {
  const scriptPath = path.join(
    process.env.APP_ROOT,
    "..",
    "..",
    "scripts",
    "motor_controller.py"
  );
  console.log("[Motors] Starting motor controller:", scriptPath);
  try {
    motorProcess = spawn("python3", [scriptPath], {
      stdio: ["pipe", "pipe", "pipe"]
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
  let stdoutBuf = "";
  motorProcess.stdout.on("data", (chunk) => {
    stdoutBuf += chunk.toString();
    const lines = stdoutBuf.split("\n");
    stdoutBuf = lines.pop();
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const status = JSON.parse(trimmed);
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
  motorProcess.stderr.on("data", (chunk) => {
    console.error("[Motors] stderr:", chunk.toString().trim());
  });
}
function sendMotorCommand(cmd) {
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
function stopMotorController() {
  return new Promise((resolve) => {
    if (!motorProcess) {
      resolve();
      return;
    }
    try {
      motorProcess.stdin.write(JSON.stringify({ command: "shutdown" }) + "\n");
    } catch {
    }
    const timeout = setTimeout(() => {
      if (motorProcess) {
        console.log("[Motors] Sending SIGTERM after timeout");
        motorProcess.kill("SIGTERM");
      }
      resolve();
    }, 2e3);
    motorProcess.on("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
  });
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
ipcMain.handle("hume:speak", (_event, text) => {
  if (!HUME_API_KEY) {
    return { ok: false, error: "Missing HUME_API_KEY" };
  }
  humeStreamSpeak(text).catch((err) => {
    console.error("[Hume TTS] Unhandled stream error:", err);
  });
  return { ok: true };
});
ipcMain.handle("hume:stop", () => {
  humeStopSpeaking();
  return { ok: true };
});
ipcMain.handle("openclaw:start-listening", () => {
  console.log("[STT] start-listening IPC received");
  return startTranscriber();
});
ipcMain.handle("openclaw:stop-listening", () => stopTranscriber());
let audioChunkCount = 0;
ipcMain.on("openclaw:audio-chunk", (_event, pcmData) => {
  audioChunkCount++;
  if (audioChunkCount % 100 === 1) {
    console.log(`[STT] Audio chunk #${audioChunkCount} received, size=${pcmData.byteLength}, transcriber=${transcriber ? "active" : "null"}`);
  }
  if (transcriber) {
    const buf = Buffer.from(pcmData);
    transcriber.sendAudio(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)
    );
  }
});
ipcMain.handle("motors:command", (_event, cmd) => sendMotorCommand(cmd));
ipcMain.handle(
  "motors:set-emotion",
  (_event, emotion) => sendMotorCommand({ command: "set_emotion", emotion })
);
ipcMain.handle("motors:stop", () => sendMotorCommand({ command: "stop" }));
ipcMain.handle(
  "motors:set-servos",
  (_event, angle1, angle2) => sendMotorCommand({ command: "set_servos", angle1, angle2 })
);
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
app.whenReady().then(() => {
  startMotorController();
  createWindow();
});
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
