import { BrowserWindow } from "electron";
import { Buffer } from "node:buffer";
import { AssemblyAI } from "assemblyai";

// ── State ────────────────────────────────────────────────────────────────

let assemblyai: AssemblyAI | null = null;

type StreamingTranscriberInstance = ReturnType<
  AssemblyAI["streaming"]["transcriber"]
>;

let transcriber: StreamingTranscriberInstance | null = null;

function getClient(): AssemblyAI | null {
  if (assemblyai) return assemblyai;
  const key = process.env.ASSEMBLYAI_API_KEY;
  if (!key) return null;
  assemblyai = new AssemblyAI({ apiKey: key });
  return assemblyai;
}

// ── Public API ───────────────────────────────────────────────────────────

export async function startTranscriber(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const client = getClient();
  if (!client) {
    console.log("[STT] No ASSEMBLYAI_API_KEY set, skipping");
    return { ok: false, error: "Missing ASSEMBLYAI_API_KEY" };
  }
  if (transcriber) {
    console.log("[STT] Transcriber already running");
    return { ok: true };
  }

  try {
    console.log("[STT] Creating streaming transcriber...");
    transcriber = client.streaming.transcriber({
      sampleRate: 16_000,
      speechModel: "universal-streaming-english",
      formatTurns: true,
      endOfTurnConfidenceThreshold: 0.7,
      minEndOfTurnSilenceWhenConfident: 800,
      maxTurnSilence: 3600,
    });

    transcriber.on("turn", (turn) => {
      console.log(
        `[STT] Turn: end_of_turn=${turn.end_of_turn} transcript="${turn.transcript}"`,
      );
      if (turn.end_of_turn && turn.transcript.trim()) {
        for (const window of BrowserWindow.getAllWindows()) {
          window.webContents.send("picoclaw:transcript", turn.transcript);
        }
      }
    });

    transcriber.on("error", (err) => {
      console.error("[STT] Error event:", err.message ?? err);
    });

    transcriber.on("close", (code: number, reason: string) => {
      console.log("[STT] Transcriber closed, code:", code, "reason:", reason);
      transcriber = null;
    });

    console.log("[STT] Calling transcriber.connect()...");
    await transcriber.connect();
    console.log("[STT] Transcriber connected successfully");
    return { ok: true };
  } catch (err: unknown) {
    transcriber = null;
    const message = err instanceof Error ? err.message : String(err);
    console.error("[STT] Failed to start:", message);
    return { ok: false, error: message };
  }
}

export async function stopTranscriber(): Promise<{
  ok: boolean;
  error?: string;
}> {
  if (!transcriber) return { ok: true };
  try {
    await transcriber.close();
  } catch {
    // best-effort close
  }
  transcriber = null;
  return { ok: true };
}

let audioChunkCount = 0;

export function sendAudioChunk(pcmData: ArrayBuffer): void {
  audioChunkCount++;
  if (audioChunkCount % 100 === 1) {
    console.log(
      `[STT] Audio chunk #${audioChunkCount}, size=${pcmData.byteLength}, transcriber=${transcriber ? "active" : "null"}`,
    );
  }
  if (transcriber) {
    const buf = Buffer.from(pcmData);
    transcriber.sendAudio(
      buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    );
  }
}
