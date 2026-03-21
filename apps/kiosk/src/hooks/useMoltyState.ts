import { useState, useCallback, useEffect, useRef } from "react";
import { useVoice } from "./useVoice";

/** Strip common markdown formatting so captions and TTS read clean text. */
function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")        // code blocks (must come before inline)
    .replace(/#{1,6}\s+/g, "")             // headings
    .replace(/\*\*(.+?)\*\*/g, "$1")       // bold
    .replace(/__(.+?)__/g, "$1")           // bold alt
    .replace(/\*(.+?)\*/g, "$1")           // italic
    .replace(/_(.+?)_/g, "$1")             // italic alt
    .replace(/`(.+?)`/g, "$1")             // inline code
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")    // links
    .replace(/^[-*+]\s+/gm, "")            // list bullets
    .replace(/^\d+\.\s+/gm, "")            // numbered lists
    .replace(/\n{2,}/g, "\n")              // collapse blank lines
    .trim();
}

/** Detect picoclaw placeholder messages that should not be shown as subtitles. */
function isPlaceholder(text: string): boolean {
  return text.trim() === "Thinking... 💭";
}

const VALID_FACES = new Set<FaceExpression>([
  "idle", "listening", "thinking", "excited", "watching",
  "winning", "losing", "celebrating", "dying", "error",
]);

/** Extract [face:STATE] directives from agent text and return cleaned text + face. */
function parseFaceDirectives(text: string): { cleaned: string; face: FaceExpression | null } {
  const faceRegex = /\[face:(\w+)\]/g;
  let lastFace: FaceExpression | null = null;
  let match;
  while ((match = faceRegex.exec(text)) !== null) {
    if (VALID_FACES.has(match[1] as FaceExpression)) {
      lastFace = match[1] as FaceExpression;
    }
  }
  const cleaned = text.replace(/\[face:\w+\]/g, "").trim();
  return { cleaned, face: lastFace };
}

export function useMoltyState() {
  const [face, setFace] = useState<FaceExpression>("idle");
  const [isTalking, setIsTalking] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [subtitle, setSubtitle] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const processingRef = useRef(false);
  const interruptedRef = useRef(false);
  /** Active AudioContext for Hume streaming playback — closing it stops all queued sources. */
  const audioCtxRef = useRef<AudioContext | null>(null);
  /** Cleanup functions for Hume IPC event listeners during a streaming speak. */
  const humeCleanupRef = useRef<(() => void) | null>(null);
  const responseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorDisplayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [processTrigger, setProcessTrigger] = useState(0);
  /** While true, face is locked to "thinking" — prevents other code from changing it until TTS starts. */
  const thinkingLockRef = useRef(false);

  const { isListening, transcript, setTranscript, pause, resume } =
    useVoice(isReady);

  // Debug: log key state transitions
  useEffect(() => {
    console.log("[Molty] State: isConnected=%s isReady=%s isListening=%s face=%s",
      isConnected, isReady, isListening, face);
  }, [isConnected, isReady, isListening, face]);

  // Update face based on voice state
  useEffect(() => {
    if (!processingRef.current && !thinkingLockRef.current && isListening) {
      setFace("listening");
    }
  }, [isListening]);

  // Sync motors with face expression changes
  useEffect(() => {
    if (window.motors) {
      window.motors.setEmotion(face).catch((err) => {
        console.warn("[Molty] Motor setEmotion failed:", err);
      });
    }
  }, [face]);

  // ── Interrupt: cancel TTS, abort gateway run, reset state ─────────────

  const interrupt = useCallback(() => {
    console.log("[Molty] Interrupting current response");

    // Mark as interrupted first so in-flight handlers bail immediately
    interruptedRef.current = true;

    // Abort the Hume TTS HTTP stream in the main process
    window.hume.stop().catch(() => {});

    // Tear down streaming IPC listeners
    if (humeCleanupRef.current) {
      humeCleanupRef.current();
      humeCleanupRef.current = null;
    }

    // Close the AudioContext — stops all scheduled sources at once
    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close();
      } catch {
        // best-effort
      }
      audioCtxRef.current = null;
    }

    // Cancel browser TTS fallback if it was used
    if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
    }

    // Reset all processing state
    processingRef.current = false;
    thinkingLockRef.current = false;
    setIsTalking(false);
    setIsSending(false);
    if (responseTimeoutRef.current) {
      clearTimeout(responseTimeoutRef.current);
      responseTimeoutRef.current = null;
    }
    if (errorDisplayTimeoutRef.current) {
      clearTimeout(errorDisplayTimeoutRef.current);
      errorDisplayTimeoutRef.current = null;
    }
    setFace("listening");
    setSubtitle("");
  }, []);

  // ── Browser TTS fallback ─────────────────────────────────────────────

  const speakBrowser = useCallback((text: string): Promise<"done" | "interrupted"> => {
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window)) {
        console.log("[Molty] SpeechSynthesis not available, skipping TTS");
        resolve("done");
        return;
      }

      console.log("[Molty] Speaking (browser fallback):", text.slice(0, 80));
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.1;
      utterance.volume = 1.0;

      utterance.onend = () => {
        if (interruptedRef.current) {
          resolve("interrupted");
        } else {
          resolve("done");
        }
      };
      utterance.onerror = (e) => {
        if (e.error === "canceled" || interruptedRef.current) {
          resolve("interrupted");
        } else {
          console.error("[Molty] Browser TTS error:", e.error);
          resolve("done");
        }
      };

      speechSynthesis.speak(utterance);
    });
  }, []);

  // ── Speak with Hume AI TTS — streaming playback (falls back to browser TTS) ──

  const speak = useCallback(async (text: string): Promise<"done" | "interrupted"> => {
    interruptedRef.current = false;

    console.log("[Molty] Speaking (Hume TTS streaming):", text.slice(0, 80));

    try {
      // Fire-and-forget: main process starts streaming, sends chunks via IPC events
      const result = await window.hume.speak(text);

      if (interruptedRef.current) {
        return "interrupted";
      }

      if (!result.ok) {
        console.warn("[Molty] Hume TTS unavailable:", result.error, "— falling back to browser TTS");
        return speakBrowser(text);
      }

      // The main process is now streaming. Set up an AudioContext and listen
      // for chunks, decoding and scheduling them for gapless playback.
      const audioCtx = new AudioContext();
      audioCtxRef.current = audioCtx;

      return new Promise<"done" | "interrupted">((resolve) => {
        let nextStartTime = audioCtx.currentTime;
        let streamDone = false;
        let chunksScheduled = 0;
        let chunksFinished = 0;
        let resolved = false;
        // Serialize decoding so chunks are always scheduled in arrival order
        let decodeChain = Promise.resolve();

        const finish = (outcome: "done" | "interrupted") => {
          if (resolved) return;
          resolved = true;
          cleanup();
          audioCtxRef.current = null;
          try { audioCtx.close(); } catch { /* ignore */ }
          resolve(outcome);
        };

        const checkComplete = () => {
          if (streamDone && chunksFinished === chunksScheduled) {
            console.log("[Molty] Finished speaking (Hume TTS streaming)");
            finish(interruptedRef.current ? "interrupted" : "done");
          }
        };

        // ── IPC event handlers ──
        const offChunk = window.hume.onAudioChunk((audioBase64: string) => {
          if (interruptedRef.current || resolved) return;

          decodeChain = decodeChain.then(async () => {
            if (interruptedRef.current || resolved) return;

            try {
              // Decode base64 → binary → AudioBuffer
              const binaryStr = atob(audioBase64);
              const bytes = new Uint8Array(binaryStr.length);
              for (let i = 0; i < binaryStr.length; i++) {
                bytes[i] = binaryStr.charCodeAt(i);
              }

              // decodeAudioData detaches the buffer, so pass a copy
              const audioBuffer = await audioCtx.decodeAudioData(bytes.buffer.slice(0));
              if (interruptedRef.current || resolved) return;

              const source = audioCtx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(audioCtx.destination);

              // Schedule right after the previous chunk ends (gapless)
              const startAt = Math.max(nextStartTime, audioCtx.currentTime);
              source.start(startAt);
              nextStartTime = startAt + audioBuffer.duration;

              chunksScheduled++;
              source.onended = () => {
                chunksFinished++;
                checkComplete();
              };
            } catch (err) {
              console.error("[Molty] Failed to decode audio chunk:", err);
            }
          });
        });

        const offDone = window.hume.onAudioDone(() => {
          streamDone = true;
          if (chunksScheduled === 0) {
            // No audio chunks received — fall back to browser TTS and wait for it
            console.warn("[Molty] Hume stream ended with 0 chunks — falling back to browser TTS");
            cleanup();
            audioCtxRef.current = null;
            try { audioCtx.close(); } catch { /* ignore */ }
            speakBrowser(text).then((r) => {
              if (resolved) return;
              resolved = true;
              resolve(r);
            });
            return;
          }
          checkComplete();
        });

        const offError = window.hume.onAudioError((error: string) => {
          console.warn("[Molty] Hume TTS stream error:", error, "— falling back to browser TTS");
          cleanup();
          audioCtxRef.current = null;
          try { audioCtx.close(); } catch { /* ignore */ }
          speakBrowser(text).then((r) => {
            if (resolved) return;
            resolved = true;
            resolve(r);
          });
        });

        const cleanup = () => {
          offChunk();
          offDone();
          offError();
          humeCleanupRef.current = null;
        };

        // Store cleanup so interrupt() can tear down listeners
        humeCleanupRef.current = cleanup;
      });
    } catch (err) {
      console.error("[Molty] Hume TTS error:", err, "— falling back to browser TTS");
      audioCtxRef.current = null;
      return speakBrowser(text);
    }
  }, [speakBrowser]);

  // ── Process a transcript ──────────────────────────────────────────────

  const processTranscript = useCallback(
    async (text: string) => {
      if (processingRef.current) return;
      processingRef.current = true;
      interruptedRef.current = false;

      console.log("[Molty] Processing transcript:", text);

      // Cancel any stale error-display timer that would call resume() mid-processing
      if (errorDisplayTimeoutRef.current) {
        clearTimeout(errorDisplayTimeoutRef.current);
        errorDisplayTimeoutRef.current = null;
      }

      // Pause mic while waiting for response (avoid sending silence to transcriber)
      pause();
      thinkingLockRef.current = true;
      setFace("thinking");
      setSubtitle(`Sending: "${text}"`);
      setIsSending(true);

      // If picoclaw never responds, resume after a timeout so we don't stay stuck
      if (responseTimeoutRef.current) clearTimeout(responseTimeoutRef.current);
      responseTimeoutRef.current = setTimeout(() => {
        responseTimeoutRef.current = null;
        if (processingRef.current) {
          console.log("[Molty] Response timeout — resuming listening");
          processingRef.current = false;
          thinkingLockRef.current = false;
          setIsSending(false);
          setFace("listening");
          setSubtitle("");
          resume();
          setProcessTrigger((t) => t + 1);
        }
      }, 30_000);

      // Send as a Pico Protocol message.send request
      const chatReq = {
        type: "message.send",
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        payload: { content: text },
      };
      console.log("[Molty] Sending message.send to picoclaw:", JSON.stringify(chatReq).slice(0, 200));
      try {
        const result = await window.openclaw.send(chatReq);
        console.log("[Molty] Send result:", JSON.stringify(result));
      } catch (err) {
        console.error("[Molty] message.send failed:", err);
        // Recover immediately instead of waiting for the 30s timeout
        processingRef.current = false;
        thinkingLockRef.current = false;
        if (responseTimeoutRef.current) {
          clearTimeout(responseTimeoutRef.current);
          responseTimeoutRef.current = null;
        }
        setFace("error");
        setSubtitle("Failed to send message");
        errorDisplayTimeoutRef.current = setTimeout(() => {
          errorDisplayTimeoutRef.current = null;
          setFace("listening");
          setSubtitle("");
          resume();
          setProcessTrigger((t) => t + 1);
        }, 3000);
      }
      setIsSending(false);
    },
    [pause, resume]
  );

  // ── Handle new transcripts (always-on conversation mode) ─────────────

  useEffect(() => {
    if (!transcript) return;
    if (processingRef.current) {
      setTranscript(null);
      return; // ignore while busy
    }

    setTranscript(null);
    processTranscript(transcript);
  }, [transcript, processTrigger, processTranscript, setTranscript]);

  // ── Listen for Pico Protocol messages from picoclaw ──────────────────

  useEffect(() => {
    // Track the latest message content across create/update events
    let latestMessageId: string | null = null;
    let latestContent = "";
    let typingDone = false;

    const finalizeSpeech = async (rawContent: string) => {
      if (interruptedRef.current) {
        console.log("[Molty] typing.stop ignored (was interrupted)");
        latestMessageId = null;
        latestContent = "";
        return;
      }

      const strippedFinal = stripMarkdown(rawContent);
      const { cleaned: finalText, face: agentFace } = parseFaceDirectives(strippedFinal);
      console.log("[Molty] Final response:", finalText.slice(0, 120), agentFace ? `[face:${agentFace}]` : "");
      latestMessageId = null;
      latestContent = "";
      typingDone = false;

      if (!finalText.trim()) {
        processingRef.current = false;
        thinkingLockRef.current = false;
        if (responseTimeoutRef.current) {
          clearTimeout(responseTimeoutRef.current);
          responseTimeoutRef.current = null;
        }
        setFace("listening");
        setSubtitle("");
        resume();
        setProcessTrigger((t) => t + 1);
        return;
      }

      thinkingLockRef.current = false;
      if (agentFace) setFace(agentFace);
      setSubtitle(finalText);
      setIsTalking(true);

      if (responseTimeoutRef.current) {
        clearTimeout(responseTimeoutRef.current);
        responseTimeoutRef.current = null;
      }

      pause();
      const result = await speak(finalText);

      if (result === "interrupted") {
        return;
      }

      setIsTalking(false);
      if (responseTimeoutRef.current) {
        clearTimeout(responseTimeoutRef.current);
        responseTimeoutRef.current = null;
      }
      setFace("listening");
      await new Promise((r) => setTimeout(r, 300));
      setTranscript(null);
      processingRef.current = false;
      resume();
      setSubtitle("I'm listening...");
      setProcessTrigger((t) => t + 1);
    };

    const off = window.openclaw.onMessage(async (payload) => {
      if (payload.direction !== "in") return;

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(payload.data);
      } catch {
        return;
      }

      const msgType = msg.type as string | undefined;

      // typing.start — agent is thinking, show thinking state
      if (msgType === "typing.start") {
        setIsSending(false);
        return;
      }

      // typing.stop — agent finished generating; mark that we should finalize
      // after the next message.update (picoclaw often sends typing.stop before
      // the final message.update arrives)
      if (msgType === "typing.stop") {
        typingDone = true;
        // If we already have real (non-placeholder) content, finalize now
        if (latestContent && !isPlaceholder(latestContent)) {
          await finalizeSpeech(latestContent);
          typingDone = false;
        }
        return;
      }

      // message.create — new message (may be placeholder text or first chunk)
      if (msgType === "message.create") {
        const msgPayload = msg.payload as { content?: string; message_id?: string } | undefined;
        const content = msgPayload?.content ?? "";
        const messageId = msgPayload?.message_id ?? null;

        setIsSending(false);

        // Skip placeholder text (e.g. "Thinking... 💭") — just show thinking face
        if (messageId) {
          latestMessageId = messageId;
          latestContent = content;
        }

        if (content && !isPlaceholder(content)) {
          const stripped = stripMarkdown(content);
          const { cleaned, face: streamFace } = parseFaceDirectives(stripped);
          if (streamFace && !thinkingLockRef.current) setFace(streamFace);
          const display = cleaned.length > 200 ? "..." + cleaned.slice(-200) : cleaned;
          setSubtitle(display);
        }
        return;
      }

      // message.update — streaming update to existing message
      if (msgType === "message.update") {
        const msgPayload = msg.payload as { message_id?: string; content?: string } | undefined;
        const content = msgPayload?.content ?? "";
        const messageId = msgPayload?.message_id ?? null;

        if (messageId === latestMessageId || !latestMessageId) {
          latestMessageId = messageId;
          latestContent = content;
        }

        if (content) {
          const stripped = stripMarkdown(content);
          const { cleaned, face: streamFace } = parseFaceDirectives(stripped);
          if (streamFace && !thinkingLockRef.current) setFace(streamFace);
          const display = cleaned.length > 200 ? "..." + cleaned.slice(-200) : cleaned;
          setSubtitle(display);
        }

        // If typing.stop already arrived, finalize now with the real content
        if (typingDone && content && !isPlaceholder(content)) {
          typingDone = false;
          await finalizeSpeech(content);
        }
        return;
      }

      // error — gateway reported an error
      if (msgType === "error") {
        if (!processingRef.current) return;

        const errPayload = msg.payload as { message?: string; code?: string } | undefined;
        const errMsg = errPayload?.message ?? errPayload?.code ?? "Gateway error";
        console.error("[Molty] Pico error:", errMsg);
        latestMessageId = null;
        latestContent = "";
        processingRef.current = false;
        thinkingLockRef.current = false;
        setIsSending(false);
        if (responseTimeoutRef.current) {
          clearTimeout(responseTimeoutRef.current);
          responseTimeoutRef.current = null;
        }
        setFace("error");
        setSubtitle(errMsg);
        errorDisplayTimeoutRef.current = setTimeout(() => {
          errorDisplayTimeoutRef.current = null;
          setFace("listening");
          setSubtitle("");
          resume();
          setProcessTrigger((t) => t + 1);
        }, 3000);
      }
    });
    return off;
  }, [speak, pause, resume, setTranscript]);

  // Listen for connection status changes
  useEffect(() => {
    const off = window.openclaw.onStatus((status) => {
      console.log("[Molty] Picoclaw status:", status.status, status.error ?? "");
      setIsConnected(status.status === "connected");
    });
    return off;
  }, []);

  // Auto-connect to picoclaw and wait for successful connection before enabling voice
  useEffect(() => {
    async function init() {
      console.log("[Molty] Connecting to picoclaw...");
      try {
        const result = await window.openclaw.connect();
        console.log("[Molty] Connect result:", JSON.stringify(result));
        if (result.status === "connected") {
          setIsConnected(true);
          setIsReady(true);
        }
        // If connecting, we'll wait for the onStatus callback to confirm
      } catch (err) {
        console.error("[Molty] Connect error:", err);
      }
    }
    init();
  }, []);

  // Once connected, mark as ready for voice
  useEffect(() => {
    if (isConnected && !isReady) {
      console.log("[Molty] Picoclaw connected — starting voice");
      setIsReady(true);
      setFace("listening");
      setSubtitle("I'm listening...");
    }
  }, [isConnected, isReady]);

  return {
    face, isTalking, isSending, subtitle, isReady, isListening, isConnected,
  };
}
