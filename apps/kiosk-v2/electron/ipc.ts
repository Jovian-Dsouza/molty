import { ipcMain } from "electron";
import {
  connectGateway,
  disconnectGateway,
  getStatusPayload,
  sendGateway,
} from "./picoclaw.ts";
import { startTranscriber, stopTranscriber, sendAudioChunk } from "./stt.ts";
import { isAvailable, humeStreamSpeak, humeStopSpeaking } from "./tts.ts";
import { sendMotorCommand } from "./motors.ts";

export function registerIpcHandlers(): void {
  // Picoclaw gateway
  ipcMain.handle("picoclaw:connect", () => connectGateway());
  ipcMain.handle("picoclaw:disconnect", () => disconnectGateway());
  ipcMain.handle("picoclaw:get-status", () => getStatusPayload());
  ipcMain.handle("picoclaw:send", (_event, payload) => sendGateway(payload));

  // Hume AI TTS (streaming)
  ipcMain.handle("hume:speak", (_event, text: string) => {
    if (!isAvailable()) {
      return { ok: false, error: "Missing HUME_API_KEY" };
    }
    humeStreamSpeak(text).catch((err: unknown) => {
      console.error("[Hume TTS] Unhandled stream error:", err);
    });
    return { ok: true };
  });
  ipcMain.handle("hume:stop", () => {
    humeStopSpeaking();
    return { ok: true };
  });

  // AssemblyAI streaming STT
  ipcMain.handle("picoclaw:start-listening", () => {
    console.log("[STT] start-listening IPC received");
    return startTranscriber();
  });
  ipcMain.handle("picoclaw:stop-listening", () => stopTranscriber());
  ipcMain.on("picoclaw:audio-chunk", (_event, pcmData: ArrayBuffer) => {
    sendAudioChunk(pcmData);
  });

  // Motor controller
  ipcMain.handle("motors:command", (_event, cmd: Record<string, unknown>) =>
    sendMotorCommand(cmd),
  );
  ipcMain.handle("motors:set-emotion", (_event, emotion: string) =>
    sendMotorCommand({ command: "set_emotion", emotion }),
  );
  ipcMain.handle("motors:stop", () =>
    sendMotorCommand({ command: "stop" }),
  );
  ipcMain.handle("motors:set-servos", (_event, angle1: number, angle2: number) =>
    sendMotorCommand({ command: "set_servos", angle1, angle2 }),
  );
}
