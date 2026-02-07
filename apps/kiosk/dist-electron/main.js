import { ipcMain as h, app as v, BrowserWindow as S } from "electron";
import { fileURLToPath as q } from "node:url";
import d from "node:path";
import { existsSync as x, readFileSync as C, mkdirSync as F, writeFileSync as V } from "node:fs";
import { Buffer as T } from "node:buffer";
import { AssemblyAI as J } from "assemblyai";
import { generateKeyPairSync as U, createHash as H, createPrivateKey as z, sign as Q } from "node:crypto";
const X = "openclaw-device-key.json";
function Z(e) {
  return d.join(e, X);
}
function ee(e) {
  const n = Z(e);
  if (x(n))
    try {
      const a = C(n, "utf-8"), y = JSON.parse(a);
      if (y.publicKeyBase64 && y.privateKeyPem && y.deviceId)
        return y;
    } catch {
    }
  const { publicKey: t, privateKey: o } = U("ed25519", {
    publicKeyEncoding: { format: "jwk" },
    privateKeyEncoding: { format: "pkcs8", type: "pkcs8" }
  }), i = Buffer.from(t.x, "base64url"), m = i.toString("base64"), _ = `-----BEGIN PRIVATE KEY-----
${o.toString("base64").replace(/(.{64})/g, `$1
`).trimEnd()}
-----END PRIVATE KEY-----`, p = "molty-kiosk-" + H("sha256").update(i).digest("hex").slice(0, 16), r = {
    publicKeyBase64: m,
    privateKeyPem: _,
    deviceId: p
  };
  try {
    F(e, { recursive: !0 }), V(n, JSON.stringify(r, null, 0), "utf-8");
  } catch (a) {
    console.warn("[deviceAttestation] Could not persist device key:", a);
  }
  return r;
}
function ne(e, n) {
  const t = z({
    key: n,
    format: "pem"
  }), o = Date.now(), i = Buffer.from(e, "utf-8");
  return {
    signature: Q(null, i, t).toString("base64"),
    signedAt: o
  };
}
const W = d.dirname(q(import.meta.url));
process.env.APP_ROOT = d.join(W, "..");
try {
  const e = d.join(process.env.APP_ROOT, ".env"), n = C(e, "utf-8");
  for (const t of n.split(`
`)) {
    const o = t.trim();
    if (!o || o.startsWith("#")) continue;
    const i = o.indexOf("=");
    if (i === -1) continue;
    const m = o.slice(0, i).trim(), E = o.slice(i + 1).trim();
    process.env[m] || (process.env[m] = E);
  }
} catch {
}
const k = process.env.VITE_DEV_SERVER_URL, he = d.join(process.env.APP_ROOT, "dist-electron"), L = d.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = k ? d.join(process.env.APP_ROOT, "public") : L;
const N = process.env.OPENCLAW_GATEWAY_URL ?? "wss://molty.somehow.dev/", P = process.env.OPENCLAW_GATEWAY_TOKEN;
let u = null, f = "disconnected", B = null, b = null, A = null, g;
const R = process.env.ASSEMBLYAI_API_KEY ? new J({ apiKey: process.env.ASSEMBLYAI_API_KEY }) : null;
let s = null;
async function te() {
  if (!R)
    return console.log("[STT] No ASSEMBLYAI_API_KEY set, skipping"), { ok: !1, error: "Missing ASSEMBLYAI_API_KEY" };
  if (s)
    return console.log("[STT] Transcriber already running"), { ok: !0 };
  try {
    return console.log("[STT] Creating streaming transcriber..."), s = R.streaming.transcriber({
      sampleRate: 16e3,
      formatTurns: !0
    }), s.on("turn", (e) => {
      if (console.log(
        `[STT] Turn: end_of_turn=${e.end_of_turn} transcript="${e.transcript}"`
      ), e.end_of_turn && e.transcript.trim())
        for (const n of S.getAllWindows())
          n.webContents.send("openclaw:transcript", e.transcript);
    }), s.on("error", (e) => {
      console.error("[STT] Error:", e.message);
      for (const n of S.getAllWindows())
        n.webContents.send("openclaw:transcript-error", e.message);
    }), s.on("close", () => {
      console.log("[STT] Transcriber closed"), s = null;
    }), await s.connect(), console.log("[STT] Transcriber connected successfully"), { ok: !0 };
  } catch (e) {
    s = null;
    const n = e instanceof Error ? e.message : "Failed to start transcriber";
    return console.error("[STT] Failed to start:", n), { ok: !1, error: n };
  }
}
async function Y() {
  if (!s)
    return { ok: !0 };
  try {
    await s.close();
  } catch {
  }
  return s = null, { ok: !0 };
}
function oe(e) {
  return e.startsWith("https://") ? `wss://${e.slice(8)}` : e.startsWith("http://") ? `ws://${e.slice(7)}` : e;
}
function re() {
  if (!P) return null;
  const e = new URL(oe(N));
  return e.searchParams.set("token", P), e.toString();
}
function w() {
  return { status: f, error: B };
}
function se() {
  const e = w();
  for (const n of S.getAllWindows())
    n.webContents.send("openclaw:status", e);
}
function c(e, n) {
  const t = {
    direction: e,
    data: n,
    ts: Date.now()
  };
  for (const o of S.getAllWindows())
    o.webContents.send("openclaw:message", t);
}
function l(e, n = null) {
  f = e, B = n, se();
}
function ce(e, n) {
  G(), A = setInterval(() => {
    if (!(u !== e || f !== "connected"))
      try {
        const t = JSON.stringify({
          type: "req",
          id: `tick-${Date.now()}`,
          method: "status",
          params: {}
        });
        e.send(t);
      } catch {
      }
  }, n);
}
function G() {
  A !== null && (clearInterval(A), A = null);
}
function ie(e) {
  if (typeof e == "string") return e;
  if (e instanceof ArrayBuffer) return T.from(e).toString("utf8");
  if (ArrayBuffer.isView(e))
    return T.from(e.buffer).toString("utf8");
  if (T.isBuffer(e)) return e.toString("utf8");
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
function ae(e) {
  const n = () => {
    console.log("[Gateway] WebSocket open, waiting for challenge..."), c("system", "WebSocket open, authenticating...");
  }, t = () => {
    console.log("[Gateway] Disconnected"), u = null, b = null, G(), f !== "error" && l("disconnected"), c("system", "Gateway disconnected");
  }, o = () => {
    console.error("[Gateway] Connection error"), l("error", "Gateway connection failed"), c("system", "Gateway error");
  }, i = (...m) => {
    const E = m[0], _ = E?.data ?? E, p = ie(_);
    console.log("[Gateway] ← IN:", p.slice(0, 200));
    try {
      const r = JSON.parse(p);
      if (r?.type === "event" && r?.event === "connect.challenge") {
        const a = String(r.payload?.nonce ?? "");
        console.log(
          "[Gateway] Got connect.challenge, sending connect request (device attestation)..."
        );
        const y = v.getPath("userData"), O = ee(y), { signature: j, signedAt: $ } = ne(
          a,
          O.privateKeyPem
        ), I = `connect-${Date.now()}`;
        b = I;
        const K = JSON.stringify({
          type: "req",
          id: I,
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
              token: P
            },
            locale: "en-US",
            userAgent: "molty-kiosk/1.0.0",
            device: {
              id: O.deviceId,
              publicKey: O.publicKeyBase64,
              signature: j,
              signedAt: $,
              nonce: a
            }
          }
        });
        e.send(K), console.log("[Gateway] → OUT: connect request sent"), c("out", K), c("in", p);
        return;
      }
      if (r?.type === "res" && r?.id === b) {
        if (b = null, r.ok) {
          const a = r.payload;
          console.log(
            "[Gateway] Connect response OK (hello-ok):",
            JSON.stringify(a).slice(0, 200)
          ), l("connected"), c("system", "Gateway authenticated and connected");
          const y = a?.policy?.tickIntervalMs ?? 15e3;
          ce(e, y);
        } else
          console.error(
            "[Gateway] Connect response ERROR:",
            JSON.stringify(r.error)
          ), l(
            "error",
            r.error?.message ?? "Gateway authentication failed"
          ), c(
            "system",
            `Auth failed: ${r.error?.message ?? "unknown error"}`
          );
        c("in", p);
        return;
      }
      if (r?.type === "res") {
        c("in", p);
        return;
      }
    } catch {
    }
    c("in", p);
  };
  if (typeof e.addEventListener == "function") {
    e.addEventListener("open", n), e.addEventListener("message", i), e.addEventListener("close", t), e.addEventListener("error", o);
    return;
  }
  typeof e.on == "function" && (e.on("open", n), e.on("message", i), e.on("close", t), e.on("error", o));
}
function le() {
  if (f === "connected" || f === "connecting")
    return w();
  const e = re();
  if (!e)
    return l("error", "Missing OPENCLAW_GATEWAY_TOKEN"), w();
  const n = globalThis.WebSocket;
  if (!n)
    return l("error", "WebSocket not available in main process"), w();
  console.log("[Gateway] Connecting to", N), l("connecting");
  try {
    u = new n(e), ae(u), c("system", "Connecting to OpenClaw gateway...");
  } catch (t) {
    console.error("[Gateway] Failed to connect:", t), l("error", "Failed to start connection");
  }
  return w();
}
function D() {
  if (b = null, G(), u) {
    try {
      u.close();
    } catch {
    }
    u = null;
  }
  return f !== "disconnected" && l("disconnected"), w();
}
function ue(e) {
  if (!u || f !== "connected")
    return console.log(
      "[Gateway] Cannot send — not connected (status:",
      f,
      ")"
    ), { ok: !1, error: "Gateway not connected" };
  const n = typeof e == "string" ? e : JSON.stringify(e);
  console.log("[Gateway] → OUT:", n.slice(0, 200));
  try {
    return u.send(n), c("out", n), { ok: !0 };
  } catch (t) {
    return console.error("[Gateway] Send failed:", t), { ok: !1, error: "Failed to send message" };
  }
}
function M() {
  const e = process.argv.includes("--kiosk") || process.env.KIOSK === "true";
  g = new S({
    width: 320,
    height: 480,
    kiosk: e,
    alwaysOnTop: e,
    frame: !e,
    resizable: !1,
    title: "kiosk",
    webPreferences: {
      preload: d.join(W, "preload.mjs")
    }
  }), g.webContents.session.setPermissionRequestHandler(
    (n, t, o) => {
      if (t === "media") {
        o(!0);
        return;
      }
      o(!1);
    }
  ), e && g.setMenu(null), k ? g.loadURL(k) : g.loadFile(d.join(L, "index.html")), g.webContents.once("did-finish-load", () => {
    g?.webContents.send("openclaw:status", w());
  });
}
h.handle("openclaw:connect", () => le());
h.handle("openclaw:disconnect", () => D());
h.handle("openclaw:get-status", () => w());
h.handle("openclaw:send", (e, n) => ue(n));
h.handle("openclaw:start-listening", () => te());
h.handle("openclaw:stop-listening", () => Y());
h.on("openclaw:audio-chunk", (e, n) => {
  if (s) {
    const t = T.from(n);
    s.sendAudio(
      t.buffer.slice(t.byteOffset, t.byteOffset + t.byteLength)
    );
  }
});
v.on("before-quit", () => {
  D(), Y();
});
v.on("window-all-closed", () => {
  process.platform !== "darwin" && (v.quit(), g = null);
});
v.on("activate", () => {
  S.getAllWindows().length === 0 && M();
});
v.whenReady().then(() => M());
export {
  he as MAIN_DIST,
  L as RENDERER_DIST,
  k as VITE_DEV_SERVER_URL
};
