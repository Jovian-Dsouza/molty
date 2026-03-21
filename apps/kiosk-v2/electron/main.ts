import { app, BrowserWindow } from "electron";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { loadEnv } from "./env.ts";
import { registerIpcHandlers } from "./ipc.ts";
import { disconnectGateway, getStatusPayload } from "./picoclaw.ts";
import { stopTranscriber } from "./stt.ts";
import { startMotorController, stopMotorController } from "./motors.ts";

// ── Paths ────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.join(__dirname, "..");

process.env.APP_ROOT = APP_ROOT;
loadEnv(APP_ROOT);

const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const RENDERER_DIST = path.join(APP_ROOT, "dist");

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL
  ? path.join(APP_ROOT, "public")
  : RENDERER_DIST;

// ── Window ───────────────────────────────────────────────────────────────

let win: BrowserWindow | null;

function createWindow(): void {
  const isKiosk =
    process.argv.includes("--kiosk") || process.env.KIOSK === "true";

  win = new BrowserWindow({
    width: 320,
    height: 480,
    kiosk: isKiosk,
    alwaysOnTop: isKiosk,
    frame: !isKiosk,
    resizable: false,
    title: "Molty Kiosk",
    webPreferences: {
      preload: path.join(__dirname, "preload.mjs"),
    },
  });

  // Auto-grant microphone permission for getUserMedia
  win.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(permission === "media");
    },
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
    win?.webContents.send("picoclaw:status", getStatusPayload());
  });
}

// ── Lifecycle ────────────────────────────────────────────────────────────

registerIpcHandlers();

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
  startMotorController(APP_ROOT);
  createWindow();
});
