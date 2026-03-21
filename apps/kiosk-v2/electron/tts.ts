import { BrowserWindow } from "electron";

// ── Config ───────────────────────────────────────────────────────────────

const HUME_API_KEY = process.env.HUME_API_KEY;
const HUME_VOICE_NAME = process.env.HUME_VOICE_NAME || "";
const HUME_VOICE_DESCRIPTION =
  process.env.HUME_VOICE_DESCRIPTION ||
  "Upbeat, enthusiastic, and playful masculine voice with high energy. Speaks quickly and expressively, like an excited robot mascot. Occasionally dramatic.";

// ── State ────────────────────────────────────────────────────────────────

let humeAbortController: AbortController | null = null;

// ── Helpers ──────────────────────────────────────────────────────────────

function broadcast(channel: string, data?: string): void {
  for (const w of BrowserWindow.getAllWindows()) {
    w.webContents.send(channel, data);
  }
}

// ── Public API ───────────────────────────────────────────────────────────

export function isAvailable(): boolean {
  return !!HUME_API_KEY;
}

/**
 * Stream audio from Hume's TTS API. Each chunk is sent to the renderer
 * via IPC events for immediate playback.
 *
 * Emits: hume:audio-chunk, hume:audio-done, hume:audio-error
 */
export async function humeStreamSpeak(
  text: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!HUME_API_KEY) {
    broadcast("hume:audio-error", "Missing HUME_API_KEY");
    return { ok: false, error: "Missing HUME_API_KEY" };
  }

  // Abort any previous synthesis
  if (humeAbortController) {
    humeAbortController.abort();
  }
  humeAbortController = new AbortController();
  const { signal } = humeAbortController;

  try {
    console.log("[Hume TTS] Streaming:", text.slice(0, 100));

    const utterance: Record<string, unknown> = {
      text,
      description: HUME_VOICE_DESCRIPTION,
    };
    if (HUME_VOICE_NAME) {
      utterance.voice = { name: HUME_VOICE_NAME, provider: "HUME_AI" };
    }

    const body: Record<string, unknown> = {
      utterances: [utterance],
      format: { type: "mp3" },
      num_generations: 1,
      strip_headers: false,
      instant_mode: !!HUME_VOICE_NAME,
    };

    const response = await fetch("https://api.hume.ai/v0/tts/stream/json", {
      method: "POST",
      headers: {
        "X-Hume-Api-Key": HUME_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal,
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("[Hume TTS] API error:", response.status, errText.slice(0, 300));
      const errMsg = `Hume API error (${response.status}): ${errText.slice(0, 200)}`;
      broadcast("hume:audio-error", errMsg);
      return { ok: false, error: errMsg };
    }

    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    let jsonBuf = "";
    let chunkCount = 0;

    const processJson = (raw: string) => {
      try {
        const chunk = JSON.parse(raw) as { type?: string; audio?: string };
        if (chunk.type === "audio" && chunk.audio) {
          chunkCount++;
          broadcast("hume:audio-chunk", chunk.audio);
        }
      } catch {
        console.log(`[Hume TTS] Failed to parse line: ${raw.slice(0, 200)}`);
      }
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      jsonBuf += decoder.decode(value, { stream: true });
      const lines = jsonBuf.split("\n");
      jsonBuf = lines.pop()!;

      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed) processJson(trimmed);
      }
    }

    const remaining = jsonBuf.trim();
    if (remaining) processJson(remaining);

    if (chunkCount === 0) {
      console.warn("[Hume TTS] 0 chunks extracted");
    }

    console.log(`[Hume TTS] Stream complete — ${chunkCount} chunks sent`);
    broadcast("hume:audio-done");
    return { ok: true };
  } catch (err) {
    if ((err as Error).name === "AbortError") {
      console.log("[Hume TTS] Stream aborted (interrupted)");
      return { ok: false, error: "Aborted" };
    }
    const message =
      err instanceof Error ? err.message : "Hume TTS streaming failed";
    console.error("[Hume TTS] Stream error:", message);
    broadcast("hume:audio-error", message);
    return { ok: false, error: message };
  } finally {
    humeAbortController = null;
  }
}

export function humeStopSpeaking(): void {
  if (humeAbortController) {
    humeAbortController.abort();
    humeAbortController = null;
  }
}
