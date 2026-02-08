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

    // Abort the current run on the gateway
    const abortReq = {
      type: "req",
      id: `abort-${Date.now()}`,
      method: "chat.abort",
      params: { sessionKey: "main" },
    };
    window.openclaw.send(abortReq).catch(() => {
      // best-effort abort
    });

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

      // If OpenClaw never responds, resume after a timeout so we don't stay stuck
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

      // Send as a proper OpenClaw RPC request (chat.send)
      const chatReq = {
        type: "req",
        id: `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        method: "chat.send",
        params: {
          sessionKey: "main",
          message: text,
          idempotencyKey: `kiosk-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        },
      };
      console.log("[Molty] Sending chat.send to OpenClaw:", JSON.stringify(chatReq).slice(0, 200));
      try {
        const result = await window.openclaw.send(chatReq);
        console.log("[Molty] Send result:", JSON.stringify(result));
      } catch (err) {
        console.error("[Molty] chat.send failed:", err);
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

  // ── Listen for OpenClaw chat events (streamed response) ───────────────

  useEffect(() => {
    // Accumulate streamed text across delta events for the current run
    let currentRunId: string | null = null;
    let accumulated = "";

    const off = window.openclaw.onMessage(async (payload) => {
      if (payload.direction !== "in") return;

      let msg: Record<string, unknown>;
      try {
        msg = JSON.parse(payload.data);
      } catch {
        return;
      }

      // Handle chat events (streamed response from agent)
      if (msg.type === "event" && msg.event === "chat") {
        const chatPayload = msg.payload as {
          runId?: string;
          sessionKey?: string;
          seq?: number;
          state?: string;
          message?: { role?: string; content?: string | unknown[] };
          errorMessage?: string;
        } | undefined;

        if (!chatPayload) return;

        const { runId, state } = chatPayload;

        // Extract text content from the message
        const messageContent = chatPayload.message;
        let textContent = "";
        if (typeof messageContent?.content === "string") {
          textContent = messageContent.content;
        } else if (Array.isArray(messageContent?.content)) {
          // Content blocks format: [{type: "text", text: "..."}]
          textContent = (messageContent.content as { type?: string; text?: string }[])
            .filter((b) => b.type === "text" && b.text)
            .map((b) => b.text)
            .join("");
        }

        if (state === "delta") {
          // Streaming delta — accumulate text (send succeeded)
          setIsSending(false);
          if (runId && runId !== currentRunId) {
            currentRunId = runId;
            accumulated = "";
          }
          if (textContent) {
            accumulated = textContent; // delta sends full text so far
            // Strip markdown and face directives so captions stay readable during streaming
            const stripped = stripMarkdown(accumulated);
            const { cleaned, face: streamFace } = parseFaceDirectives(stripped);
            // Apply face directive as soon as it arrives during streaming (skip if thinking lock is active)
            if (streamFace && !thinkingLockRef.current) setFace(streamFace);
            const display = cleaned.length > 200 ? "..." + cleaned.slice(-200) : cleaned;
            setSubtitle(display);
          }
          return;
        }

        if (state === "final") {
          // If we were interrupted, ignore the final event
          if (interruptedRef.current) {
            console.log("[Molty] Chat final ignored (was interrupted)");
            currentRunId = null;
            accumulated = "";
            return;
          }

          // Final response — extract face directives, then speak cleaned text
          const rawFinal = textContent || accumulated;
          const strippedFinal = stripMarkdown(rawFinal);
          const { cleaned: finalText, face: agentFace } = parseFaceDirectives(strippedFinal);
          console.log("[Molty] Chat final:", finalText.slice(0, 120), agentFace ? `[face:${agentFace}]` : "");
          currentRunId = null;
          accumulated = "";

          if (!finalText.trim()) {
            // Empty response — resume listening
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

          // Release the thinking lock now that TTS is about to start,
          // then apply the agent's face directive
          thinkingLockRef.current = false;
          if (agentFace) {
            setFace(agentFace);
          }
          setSubtitle(finalText);
          setIsTalking(true);

          // Clear response timeout now — we got the response, don't let
          // the timer fire mid-playback and call resume().
          if (responseTimeoutRef.current) {
            clearTimeout(responseTimeoutRef.current);
            responseTimeoutRef.current = null;
          }

          // Mute mic while speaking to avoid picking up TTS audio (echo loop).
          // pause() may already be active from processTranscript, but the 30s
          // timeout could have called resume() in the meantime, so re-pause.
          pause();

          const result = await speak(finalText);

          // If interrupted, the interrupt() handler already reset everything
          if (result === "interrupted") {
            return;
          }

          // Normal completion — brief delay before resuming mic so residual
          // speaker audio doesn't get picked up as a new transcript (echo).
          setIsTalking(false);
          if (responseTimeoutRef.current) {
            clearTimeout(responseTimeoutRef.current);
            responseTimeoutRef.current = null;
          }
          setFace("listening");
          await new Promise((r) => setTimeout(r, 300));
          // Clear any stale transcript that arrived during TTS
          setTranscript(null);
          processingRef.current = false;
          resume();

          setSubtitle("I'm listening...");
          setProcessTrigger((t) => t + 1);
          return;
        }

        if (state === "error" || state === "aborted") {
          // If we triggered the abort ourselves, don't show an error
          if (interruptedRef.current) {
            console.log("[Molty] Chat aborted (user-initiated interrupt)");
            currentRunId = null;
            accumulated = "";
            return;
          }

          // Ignore stale error/aborted events that arrive when we're not processing
          if (!processingRef.current) {
            console.log("[Molty] Ignoring stale chat error/aborted (not processing)");
            currentRunId = null;
            accumulated = "";
            return;
          }

          const errMsg = chatPayload.errorMessage ?? state;
          console.error("[Molty] Chat error/aborted:", errMsg);
          currentRunId = null;
          accumulated = "";
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
          return;
        }
      }
    });
    return off;
  }, [speak, pause, resume, interrupt, setTranscript]);

  // Listen for connection status changes
  useEffect(() => {
    const off = window.openclaw.onStatus((status) => {
      console.log("[Molty] OpenClaw status:", status.status, status.error ?? "");
      setIsConnected(status.status === "connected");
    });
    return off;
  }, []);

  // Auto-connect to OpenClaw and wait for successful connection before enabling voice
  useEffect(() => {
    async function init() {
      console.log("[Molty] Connecting to OpenClaw...");
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
      console.log("[Molty] OpenClaw connected — starting voice");
      setIsReady(true);
      setFace("listening");
      setSubtitle("I'm listening...");
    }
  }, [isConnected, isReady]);

  return {
    face, isTalking, isSending, subtitle, isReady, isListening, isConnected,
  };
}
