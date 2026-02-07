import { ipcMain, app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, chmodSync } from "node:fs";
import { Buffer as Buffer$1 } from "node:buffer";
import { AssemblyAI } from "assemblyai";
import { generateKeyPairSync, createPrivateKey, sign, createHash, createPublicKey } from "node:crypto";
const KEY_FILE = "openclaw-device-key.json";
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");
function getKeyPath(userDataPath) {
  return path.join(userDataPath, KEY_FILE);
}
function base64UrlEncode(buf) {
  return buf.toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}
function derivePublicKeyRaw(publicKeyPem) {
  const key = createPublicKey(publicKeyPem);
  const spki = key.export({ type: "spki", format: "der" });
  if (spki.length === ED25519_SPKI_PREFIX.length + 32 && spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}
function fingerprintPublicKey(publicKeyPem) {
  const raw = derivePublicKeyRaw(publicKeyPem);
  return createHash("sha256").update(raw).digest("hex");
}
function publicKeyRawBase64Url(publicKeyPem) {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}
function validateDeviceKey(data) {
  try {
    const key = createPrivateKey({ key: data.privateKeyPem, format: "pem" });
    const testSig = sign(null, Buffer.from("test", "utf-8"), key);
    return Buffer.isBuffer(testSig) || testSig instanceof Uint8Array;
  } catch {
    return false;
  }
}
function getOrCreateDeviceKey(userDataPath) {
  const keyPath = getKeyPath(userDataPath);
  if (existsSync(keyPath)) {
    try {
      const raw = readFileSync(keyPath, "utf-8");
      const data = JSON.parse(raw);
      if (data.publicKeyPem && data.privateKeyPem) {
        const derivedId = fingerprintPublicKey(data.publicKeyPem);
        if (validateDeviceKey({ ...data, deviceId: derivedId })) {
          if (data.deviceId !== derivedId) {
            console.log(
              "[deviceAttestation] Updating deviceId to match public key fingerprint"
            );
            const updated = {
              deviceId: derivedId,
              publicKeyPem: data.publicKeyPem,
              privateKeyPem: data.privateKeyPem
            };
            try {
              writeFileSync(keyPath, JSON.stringify(updated, null, 2), {
                mode: 384
              });
            } catch {
            }
          }
          return {
            deviceId: derivedId,
            publicKeyPem: data.publicKeyPem,
            privateKeyPem: data.privateKeyPem
          };
        }
        console.warn(
          "[deviceAttestation] Persisted key is corrupted, regenerating..."
        );
      }
    } catch {
    }
    try {
      unlinkSync(keyPath);
    } catch {
    }
  }
  console.log("[deviceAttestation] Generating new Ed25519 device keypair...");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const deviceId = fingerprintPublicKey(publicKeyPem);
  const deviceKey = {
    deviceId,
    publicKeyPem,
    privateKeyPem
  };
  try {
    mkdirSync(userDataPath, { recursive: true });
    writeFileSync(keyPath, JSON.stringify(deviceKey, null, 2), {
      mode: 384
    });
    try {
      chmodSync(keyPath, 384);
    } catch {
    }
    console.log("[deviceAttestation] Device key persisted to", keyPath);
    console.log("[deviceAttestation] Device ID:", deviceId);
  } catch (e) {
    console.warn("[deviceAttestation] Could not persist device key:", e);
  }
  return deviceKey;
}
function signChallenge(params) {
  const signedAt = Date.now();
  const scopesStr = params.scopes.join(",");
  const tokenStr = params.token ?? "";
  const compoundPayload = [
    "v2",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopesStr,
    String(signedAt),
    tokenStr,
    params.nonce
  ].join("|");
  const key = createPrivateKey({
    key: params.privateKeyPem,
    format: "pem"
  });
  const sig = sign(null, Buffer.from(compoundPayload, "utf-8"), key);
  return {
    signature: base64UrlEncode(sig),
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
      formatTurns: true,
      keyterms: ["Molty"]
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
  const handleClose = (...args) => {
    const ev = args[0];
    const code = typeof ev?.code === "number" ? ev.code : typeof args[0] === "number" ? args[0] : void 0;
    const reason = typeof ev?.reason === "string" ? ev.reason : typeof args[1] === "string" ? args[1] : void 0;
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
    if (wasConnecting && wsStatus === "disconnected") {
      const instructions = "Device may need approval. On the gateway server run: openclaw devices list, then openclaw devices approve <requestId>. Then connect again.";
      setStatus("error", instructions);
      broadcastMessage("system", instructions);
    }
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
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      broadcastMessage("in", text);
      return;
    }
    if (msg?.type === "event" && msg?.event === "connect.challenge") {
      try {
        const nonce = String(
          msg.payload?.nonce ?? ""
        );
        const userData = app.getPath("userData");
        const deviceKey = getOrCreateDeviceKey(userData);
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
          token: OPENCLAW_GATEWAY_TOKEN ?? null
        });
        const connectReqId = `connect-${Date.now()}`;
        pendingConnectId = connectReqId;
        const deviceParams = {
          id: deviceKey.deviceId,
          publicKey: publicKeyRawBase64Url(deviceKey.publicKeyPem),
          signature,
          signedAt,
          nonce
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
              mode: clientMode
            },
            role,
            scopes,
            caps: ["voice"],
            auth: {
              token: OPENCLAW_GATEWAY_TOKEN
            },
            locale: "en-US",
            userAgent: "openclaw-cli/1.0.0 molty-kiosk",
            device: deviceParams
          }
        });
        socket.send(connectReq);
        console.log("[Gateway] → OUT: connect request sent");
        broadcastMessage("out", connectReq);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
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
    if (msg?.type === "res" && msg?.id === pendingConnectId) {
      pendingConnectId = null;
      const payload = msg.payload;
      const errPayload = msg.error;
      const requestId = payload?.requestId ?? errPayload?.requestId ?? errPayload?.details?.requestId ?? payload?.pairingRequestId;
      if (msg.ok) {
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
          const tickMs = payload?.policy?.tickIntervalMs ?? 15e3;
          startGatewayTick(socket, tickMs);
        } else {
          setStatus("connected");
          broadcastMessage("system", "Gateway authenticated and connected");
          const tickMs = payload?.policy?.tickIntervalMs ?? 15e3;
          startGatewayTick(socket, tickMs);
        }
      } else {
        const err = msg.error;
        const baseError = err?.message ?? "Gateway authentication failed";
        const instructions = requestId ? `On the gateway server run: openclaw devices list, then openclaw devices approve ${requestId}. Then connect again.` : "On the gateway server run: openclaw devices list (to see pending devices), then openclaw devices approve <requestId>. Then connect again.";
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
