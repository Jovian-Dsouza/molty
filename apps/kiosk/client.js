#!/usr/bin/env node
/**
 * OpenClaw ACP gateway client (server-side, non-UI).
 * Connects as operator, performs handshake, sends one text command, prints response.
 * Token must be set via env OPENCLAW_GATEWAY_TOKEN (never logged).
 *
 * Usage:
 *   OPENCLAW_GATEWAY_TOKEN=... node client.js
 *   OPENCLAW_GATEWAY_TOKEN=... node client.js "Say hello"
 */

import WebSocket from "ws";

const GATEWAY_URL =
  process.env.OPENCLAW_GATEWAY_URL ?? "wss://molty.somehow.dev/";
const TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN;

function buildUrl() {
  if (!TOKEN) {
    console.error("Missing OPENCLAW_GATEWAY_TOKEN");
    process.exit(1);
  }
  const base = GATEWAY_URL.startsWith("http")
    ? GATEWAY_URL.replace(/^http/, "ws")
    : GATEWAY_URL;
  const url = new URL(base);
  url.searchParams.set("token", TOKEN);
  return url.toString();
}

function main() {
  const url = buildUrl();
  const textCommand =
    process.argv[2] ??
    "Hello, this is a proof-of-life from the Molty ACP client.";

  const ws = new WebSocket(url, {
    // No Origin header — server/operator client, not browser UI
  });

  let connected = false;
  let connectReqId = null;

  ws.on("open", () => {
    console.log("[open] WebSocket open, waiting for connect.challenge...");
  });

  ws.on("message", (raw) => {
    const text = raw.toString();
    if (text.length > 500) {
      console.log("[←]", text.slice(0, 500) + "...");
    } else {
      console.log("[←]", text);
    }

    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      return;
    }

    // Server sends connect.challenge → we reply with connect (operator mode, not UI)
    if (msg?.type === "event" && msg?.event === "connect.challenge") {
      const nonce = msg.payload?.nonce ?? "";
      connectReqId = `connect-${Date.now()}`;
      const connectReq = {
        type: "req",
        id: connectReqId,
        method: "connect",
        params: {
          minProtocol: 3,
          maxProtocol: 3,
          client: {
            id: "molty-acp-client",
            version: "1.0.0",
            platform: process.platform,
            mode: "operator",
          },
          role: "operator",
          scopes: ["operator.read", "operator.write"],
          caps: [],
          commands: [],
          permissions: {},
          auth: { token: TOKEN },
          locale: "en-US",
          userAgent: "molty-acp-client/1.0.0",
          // Minimal device identity (some gateways require it for non-UI clients)
          device: { id: "molty-acp-client-node" },
        },
      };
      ws.send(JSON.stringify(connectReq));
      console.log("[→] connect request sent (operator mode)");
      return;
    }

    // Connect response
    if (msg?.type === "res" && msg?.id === connectReqId) {
      if (msg.ok) {
        console.log("[handshake] OK:", JSON.stringify(msg.payload ?? {}));
        connected = true;

        // 1) Optional: send a status/ping-style RPC if the gateway supports it
        const pingId = `ping-${Date.now()}`;
        ws.send(
          JSON.stringify({
            type: "req",
            id: pingId,
            method: "status",
            params: {},
          })
        );
        console.log("[→] status request sent");

        // 2) Send text command (same shape as kiosk voice_input)
        const cmd = {
          type: "voice_input",
          text: textCommand,
          timestamp: Date.now(),
        };
        ws.send(JSON.stringify(cmd));
        console.log("[→] text command sent:", JSON.stringify(cmd));
      } else {
        console.error("[handshake] FAILED:", msg.error ?? "unknown");
        ws.close();
      }
      return;
    }

    // Any other res (e.g. status response) or events — print and maybe exit
    if (msg?.type === "res") {
      console.log(
        "[response]",
        msg.ok ? "OK" : "ERR",
        msg.payload ?? msg.error
      );
    }
    if (msg?.type === "event") {
      console.log("[event]", msg.event, msg.payload ?? "");
    }
  });

  ws.on("close", (code, reason) => {
    console.log("[close]", code, reason?.toString() || "");
    process.exit(connected ? 0 : 1);
  });

  ws.on("error", (err) => {
    console.error("[error]", err.message);
    process.exit(1);
  });

  // Exit after a short time if we got at least one response
  setTimeout(() => {
    if (connected) {
      ws.close();
    }
  }, 8000);
}

main();
