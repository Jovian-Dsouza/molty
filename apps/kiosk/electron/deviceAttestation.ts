/**
 * OpenClaw gateway device attestation.
 *
 * Matches the official OpenClaw device-identity protocol:
 *   - Ed25519 keypair persisted to userData
 *   - Device ID = sha256(rawPublicKey).hex()
 *   - Compound payload signing (v2): "v2|deviceId|clientId|clientMode|role|scopes|signedAtMs|token|nonce"
 *   - Signature + public key in base64url encoding
 *
 * Reference: https://github.com/openclaw/openclaw/blob/main/src/infra/device-identity.ts
 *            https://github.com/openclaw/openclaw/blob/main/src/gateway/device-auth.ts
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign as cryptoSign,
} from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  unlinkSync,
  chmodSync,
} from "node:fs";
import path from "node:path";

const KEY_FILE = "openclaw-device-key.json";

/** The fixed SPKI prefix for Ed25519 public keys (12 bytes). */
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type DeviceKey = {
  deviceId: string;
  publicKeyPem: string;
  privateKeyPem: string;
};

function getKeyPath(userDataPath: string): string {
  return path.join(userDataPath, KEY_FILE);
}

// ── Base64url helpers (match OpenClaw's encoding) ─────────────────────────

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/g, "");
}

// ── Public key helpers ────────────────────────────────────────────────────

/** Extract the raw 32-byte Ed25519 public key from a SPKI PEM. */
function derivePublicKeyRaw(publicKeyPem: string): Buffer {
  const key = createPublicKey(publicKeyPem);
  const spki = key.export({ type: "spki", format: "der" }) as Buffer;
  if (
    spki.length === ED25519_SPKI_PREFIX.length + 32 &&
    spki.subarray(0, ED25519_SPKI_PREFIX.length).equals(ED25519_SPKI_PREFIX)
  ) {
    return spki.subarray(ED25519_SPKI_PREFIX.length);
  }
  return spki;
}

/** SHA-256 hex fingerprint of the raw public key bytes → device ID. */
function fingerprintPublicKey(publicKeyPem: string): string {
  const raw = derivePublicKeyRaw(publicKeyPem);
  return createHash("sha256").update(raw).digest("hex");
}

/** Raw 32-byte public key → base64url (for connect.params.device.publicKey). */
export function publicKeyRawBase64Url(publicKeyPem: string): string {
  return base64UrlEncode(derivePublicKeyRaw(publicKeyPem));
}

// ── Key generation + persistence ──────────────────────────────────────────

/** Validate that a persisted key can actually produce signatures. */
function validateDeviceKey(data: DeviceKey): boolean {
  try {
    const key = createPrivateKey({ key: data.privateKeyPem, format: "pem" });
    const testSig = cryptoSign(null, Buffer.from("test", "utf-8"), key);
    return Buffer.isBuffer(testSig) || testSig instanceof Uint8Array;
  } catch {
    return false;
  }
}

/** Load or create Ed25519 keypair; persist to userData. */
export function getOrCreateDeviceKey(userDataPath: string): DeviceKey {
  const keyPath = getKeyPath(userDataPath);
  if (existsSync(keyPath)) {
    try {
      const raw = readFileSync(keyPath, "utf-8");
      const data = JSON.parse(raw) as DeviceKey & {
        publicKeyBase64?: string;
        publicKeyBase64Url?: string;
      };
      if (data.publicKeyPem && data.privateKeyPem) {
        // Re-derive deviceId from publicKey to match gateway expectations
        const derivedId = fingerprintPublicKey(data.publicKeyPem);
        if (validateDeviceKey({ ...data, deviceId: derivedId })) {
          // Update deviceId if it was wrong (e.g. had a prefix)
          if (data.deviceId !== derivedId) {
            console.log(
              "[deviceAttestation] Updating deviceId to match public key fingerprint"
            );
            const updated = {
              deviceId: derivedId,
              publicKeyPem: data.publicKeyPem,
              privateKeyPem: data.privateKeyPem,
            };
            try {
              writeFileSync(keyPath, JSON.stringify(updated, null, 2), {
                mode: 0o600,
              });
            } catch {
              // best-effort
            }
          }
          return {
            deviceId: derivedId,
            publicKeyPem: data.publicKeyPem,
            privateKeyPem: data.privateKeyPem,
          };
        }
        console.warn(
          "[deviceAttestation] Persisted key is corrupted, regenerating..."
        );
      }
    } catch {
      // invalid or corrupted, regenerate
    }
    // Remove corrupted key file before regenerating
    try {
      unlinkSync(keyPath);
    } catch {
      // best-effort
    }
  }

  console.log("[deviceAttestation] Generating new Ed25519 device keypair...");

  // Generate Ed25519 keypair (returns KeyObjects)
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");

  // Export both keys as PEM strings (matches official OpenClaw format)
  const publicKeyPem = (
    publicKey.export({ type: "spki", format: "pem" }) as string | Buffer
  ).toString();
  const privateKeyPem = (
    privateKey.export({ type: "pkcs8", format: "pem" }) as string | Buffer
  ).toString();

  // Device ID = sha256(raw 32-byte public key).hex()
  const deviceId = fingerprintPublicKey(publicKeyPem);

  const deviceKey: DeviceKey = {
    deviceId,
    publicKeyPem,
    privateKeyPem,
  };

  try {
    mkdirSync(userDataPath, { recursive: true });
    writeFileSync(keyPath, JSON.stringify(deviceKey, null, 2), {
      mode: 0o600,
    });
    try {
      chmodSync(keyPath, 0o600);
    } catch {
      // best-effort
    }
    console.log("[deviceAttestation] Device key persisted to", keyPath);
    console.log("[deviceAttestation] Device ID:", deviceId);
  } catch (e) {
    console.warn("[deviceAttestation] Could not persist device key:", e);
  }

  return deviceKey;
}

// ── Compound payload signing (v2 protocol) ────────────────────────────────

export type SignChallengeParams = {
  nonce: string;
  privateKeyPem: string;
  deviceId: string;
  clientId: string;
  clientMode: string;
  role: string;
  scopes: string[];
  token?: string | null;
};

/**
 * Build the compound payload and sign it with the device private key.
 *
 * Payload format (v2):
 *   v2|deviceId|clientId|clientMode|role|scope1,scope2|signedAtMs|token|nonce
 *
 * Returns { signature, signedAt } where signature is base64url-encoded.
 */
export function signChallenge(
  params: SignChallengeParams
): { signature: string; signedAt: number } {
  const signedAt = Date.now();
  const scopesStr = params.scopes.join(",");
  const tokenStr = params.token ?? "";

  // Build compound payload matching OpenClaw's buildDeviceAuthPayload (v2)
  const compoundPayload = [
    "v2",
    params.deviceId,
    params.clientId,
    params.clientMode,
    params.role,
    scopesStr,
    String(signedAt),
    tokenStr,
    params.nonce,
  ].join("|");

  const key = createPrivateKey({
    key: params.privateKeyPem,
    format: "pem",
  });
  const sig = cryptoSign(null, Buffer.from(compoundPayload, "utf-8"), key);

  return {
    signature: base64UrlEncode(sig as Buffer),
    signedAt,
  };
}
