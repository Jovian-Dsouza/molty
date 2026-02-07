/**
 * OpenClaw gateway device attestation: keypair + sign connect.challenge nonce.
 * Persists key in userData so the same device identity is used across restarts.
 */

import {
  createHash,
  createPrivateKey,
  generateKeyPairSync,
  sign as cryptoSign,
} from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

const KEY_FILE = "openclaw-device-key.json";

export type DeviceKey = {
  publicKeyBase64: string;
  privateKeyPem: string;
  deviceId: string;
};

function getKeyPath(userDataPath: string): string {
  return path.join(userDataPath, KEY_FILE);
}

/** Load or create Ed25519 keypair; persist to userData. */
export function getOrCreateDeviceKey(userDataPath: string): DeviceKey {
  const keyPath = getKeyPath(userDataPath);
  if (existsSync(keyPath)) {
    try {
      const raw = readFileSync(keyPath, "utf-8");
      const data = JSON.parse(raw) as DeviceKey;
      if (data.publicKeyBase64 && data.privateKeyPem && data.deviceId) {
        return data;
      }
    } catch {
      // invalid or corrupted, regenerate
    }
  }

  const { publicKey, privateKey } = generateKeyPairSync("ed25519", {
    publicKeyEncoding: { format: "jwk" },
    privateKeyEncoding: { format: "pkcs8", type: "pkcs8" },
  });

  // JWK .x is raw 32-byte public key as base64url
  const rawPub = Buffer.from((publicKey as { x: string }).x, "base64url");
  const publicKeyBase64 = rawPub.toString("base64");
  const base64 = (privateKey as Buffer).toString("base64");
  const pem = `-----BEGIN PRIVATE KEY-----\n${base64
    .replace(/(.{64})/g, "$1\n")
    .trimEnd()}\n-----END PRIVATE KEY-----`;

  const deviceId =
    "molty-kiosk-" +
    createHash("sha256").update(rawPub).digest("hex").slice(0, 16);

  const deviceKey: DeviceKey = {
    publicKeyBase64,
    privateKeyPem: pem,
    deviceId,
  };

  try {
    mkdirSync(userDataPath, { recursive: true });
    writeFileSync(keyPath, JSON.stringify(deviceKey, null, 0), "utf-8");
  } catch (e) {
    console.warn("[deviceAttestation] Could not persist device key:", e);
  }

  return deviceKey;
}

/** Sign the challenge nonce; return signature (base64) and signedAt (ms). */
export function signChallenge(
  nonce: string,
  privateKeyPem: string
): { signature: string; signedAt: number } {
  const key = createPrivateKey({
    key: privateKeyPem,
    format: "pem",
  });
  const signedAt = Date.now();
  const payload = Buffer.from(nonce, "utf-8");
  const sig = cryptoSign(null, payload, key);
  return {
    signature: (sig as Buffer).toString("base64"),
    signedAt,
  };
}
