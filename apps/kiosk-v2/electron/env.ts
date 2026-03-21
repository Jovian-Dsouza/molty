import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Load .env into process.env (Vite only injects VITE_* into the renderer).
 * Does not overwrite existing env vars.
 */
export function loadEnv(appRoot: string): void {
  try {
    const envPath = path.join(appRoot, ".env");
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
}
