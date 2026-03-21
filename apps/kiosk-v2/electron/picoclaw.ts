import { BrowserWindow } from "electron";
import { Buffer } from "node:buffer";
import WebSocket from "ws";

// ── Types ────────────────────────────────────────────────────────────────

export type PicoclawStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "error";

export type PicoclawStatusPayload = {
  status: PicoclawStatus;
  error?: string | null;
};

export type PicoclawMessagePayload = {
  direction: "in" | "out" | "system";
  data: string;
  ts: number;
};

// ── State ────────────────────────────────────────────────────────────────

let ws: WebSocket | null = null;
let wsStatus: PicoclawStatus = "disconnected";
let wsError: string | null = null;

// ── Helpers ──────────────────────────────────────────────────────────────

export function getStatusPayload(): PicoclawStatusPayload {
  return { status: wsStatus, error: wsError };
}

function setStatus(next: PicoclawStatus, error: string | null = null): void {
  wsStatus = next;
  wsError = error;
  broadcastStatus();
}

function broadcastStatus(): void {
  const payload = getStatusPayload();
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("picoclaw:status", payload);
  }
}

export function broadcastMessage(
  direction: PicoclawMessagePayload["direction"],
  data: string,
): void {
  const payload: PicoclawMessagePayload = { direction, data, ts: Date.now() };
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send("picoclaw:message", payload);
  }
}

function toText(data: unknown): string {
  if (typeof data === "string") return data;
  if (data instanceof ArrayBuffer)
    return Buffer.from(data).toString("utf8");
  if (ArrayBuffer.isView(data))
    return Buffer.from(data.buffer as ArrayBuffer).toString("utf8");
  if (Buffer.isBuffer(data)) return data.toString("utf8");
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}

// ── Socket ───────────────────────────────────────────────────────────────

function attachSocketHandlers(socket: WebSocket, url: string): void {
  socket.on("open", () => {
    console.log("[Picoclaw] WebSocket connected to", url);
    setStatus("connected");
    broadcastMessage("system", "Connected to picoclaw gateway");
  });

  socket.on("message", (raw) => {
    let text = toText(raw);

    // Strip leading binary framing bytes before the first '{'
    const jsonStart = text.indexOf("{");
    if (jsonStart > 0) {
      text = text.slice(jsonStart);
    }

    let msg: Record<string, unknown> | undefined;
    try {
      msg = JSON.parse(text);
    } catch {
      console.log("[Picoclaw] <- IN (unparseable):", text.slice(0, 200));
      broadcastMessage("in", text);
      return;
    }

    const msgPayload = msg.payload as Record<string, unknown> | undefined;
    if (msg.type === "message.update" || msg.type === "message.create") {
      const content = (msgPayload?.content as string) ?? "";
      console.log(
        `[Picoclaw] <- ${msg.type} content="${content.slice(0, 150)}"`,
      );
    } else {
      console.log("[Picoclaw] <-", msg.type);
    }

    // Respond to application-level pings
    if (msg.type === "ping") {
      try {
        socket.send(JSON.stringify({ type: "pong", id: msg.id ?? "" }));
      } catch {
        // best-effort
      }
      return;
    }

    broadcastMessage("in", JSON.stringify(msg));
  });

  socket.on("close", (code, reason) => {
    const reasonStr = reason?.toString() || "";
    console.log("[Picoclaw] Disconnected", code, reasonStr);
    const wasConnecting = wsStatus === "connecting";
    ws = null;
    if (wsStatus !== "error") {
      setStatus("disconnected");
    }
    broadcastMessage("system", "Gateway disconnected");
    if (wasConnecting && code === 1006) {
      console.error(
        "[Picoclaw] Connection rejected — check PICOCLAW_TOKEN and picoclaw config",
      );
    }
  });

  socket.on("error", (err) => {
    const detail = err.message ?? "unknown";
    console.error("[Picoclaw] Connection error:", detail);
    setStatus("error", `Gateway connection failed: ${detail}`);
    broadcastMessage("system", `Gateway error: ${detail}`);
  });
}

// ── Public API ───────────────────────────────────────────────────────────

export function connectGateway(): PicoclawStatusPayload {
  if (wsStatus === "connected" || wsStatus === "connecting") {
    return getStatusPayload();
  }

  const picoUrl = process.env.PICOCLAW_URL ?? "ws://127.0.0.1:18790/pico/ws";
  const token = process.env.PICOCLAW_TOKEN;

  if (!token) {
    setStatus("error", "Missing PICOCLAW_TOKEN");
    return getStatusPayload();
  }

  const url = new URL(picoUrl);
  url.searchParams.set("token", token);
  const fullUrl = url.toString();

  const maskedUrl = fullUrl.replace(/token=(.{8})[^&]*/, "token=$1...");
  console.log("[Picoclaw] Connecting to", maskedUrl);

  setStatus("connecting");
  try {
    ws = new WebSocket(fullUrl);
    attachSocketHandlers(ws, picoUrl);
    broadcastMessage("system", "Connecting to picoclaw gateway...");
  } catch (err) {
    console.error("[Picoclaw] Failed to create WebSocket:", err);
    setStatus("error", "Failed to start connection");
  }

  return getStatusPayload();
}

export function disconnectGateway(): PicoclawStatusPayload {
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

export function sendGateway(
  payload: unknown,
): { ok: boolean; error?: string } {
  if (!ws || wsStatus !== "connected") {
    console.log("[Picoclaw] Cannot send — not connected (status:", wsStatus, ")");
    return { ok: false, error: "Gateway not connected" };
  }

  // If it already looks like a Pico Protocol message, send as-is
  const isAlreadyPicoMsg =
    payload !== null &&
    typeof payload === "object" &&
    typeof (payload as Record<string, unknown>).type === "string";

  const data = isAlreadyPicoMsg
    ? JSON.stringify(payload)
    : JSON.stringify({
        type: "message.send",
        id: `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        payload: {
          content:
            typeof payload === "string" ? payload : JSON.stringify(payload),
        },
      });

  console.log("[Picoclaw] -> OUT:", data.slice(0, 200));
  try {
    ws.send(data);
    broadcastMessage("out", data);
    return { ok: true };
  } catch (err) {
    console.error("[Picoclaw] Send failed:", err);
    return { ok: false, error: "Failed to send message" };
  }
}
