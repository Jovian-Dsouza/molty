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

export function useMoltyState() {
  const [face, setFace] = useState<FaceExpression>("idle");
  const [isTalking, setIsTalking] = useState(false);
  const [subtitle, setSubtitle] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const processingRef = useRef(false);
  const speakingRef = useRef(false);
  const interruptedRef = useRef(false);
  const responseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const awaitingQueryRef = useRef(false); // true after user says just "Molty" — next utterance is the query
  const awaitingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [processTrigger, setProcessTrigger] = useState(0);

  const { isListening, transcript, setTranscript, pause, resume } =
    useVoice(isReady);

  // Update face based on voice state
  useEffect(() => {
    if (!processingRef.current && isListening) {
      setFace("listening");
    }
  }, [isListening]);

  // ── Interrupt: cancel TTS, abort gateway run, reset state ─────────────

  const interrupt = useCallback(() => {
    console.log("[Molty] Interrupting current response");

    // Cancel browser TTS immediately
    if ("speechSynthesis" in window) {
      speechSynthesis.cancel();
    }

    // Mark as interrupted so the speak() caller knows to bail
    interruptedRef.current = true;

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
    speakingRef.current = false;
    setIsTalking(false);
    if (responseTimeoutRef.current) {
      clearTimeout(responseTimeoutRef.current);
      responseTimeoutRef.current = null;
    }
    setFace("listening");
    setSubtitle("");
  }, []);

  // ── Speak with interruption support ───────────────────────────────────

  const speak = useCallback((text: string): Promise<"done" | "interrupted"> => {
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window)) {
        console.log("[Molty] SpeechSynthesis not available, skipping TTS");
        resolve("done");
        return;
      }

      interruptedRef.current = false;
      speakingRef.current = true;

      console.log("[Molty] Speaking:", text.slice(0, 80));
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.1;
      utterance.volume = 1.0;

      utterance.onend = () => {
        speakingRef.current = false;
        if (interruptedRef.current) {
          console.log("[Molty] Speech ended (was interrupted)");
          resolve("interrupted");
        } else {
          console.log("[Molty] Finished speaking");
          resolve("done");
        }
      };
      utterance.onerror = (e) => {
        speakingRef.current = false;
        if (e.error === "canceled" || interruptedRef.current) {
          console.log("[Molty] Speech cancelled (interrupted)");
          resolve("interrupted");
        } else {
          console.error("[Molty] TTS error:", e.error);
          resolve("done");
        }
      };

      speechSynthesis.speak(utterance);
    });
  }, []);

  // ── Process a transcript ──────────────────────────────────────────────

  const processTranscript = useCallback(
    async (text: string) => {
      if (processingRef.current) return;
      processingRef.current = true;
      interruptedRef.current = false;

      console.log("[Molty] Processing transcript:", text);

      // Pause mic while waiting for response (avoid sending silence to transcriber)
      pause();
      setFace("thinking");
      setSubtitle(text);

      // If OpenClaw never responds, resume after a timeout so we don't stay stuck
      if (responseTimeoutRef.current) clearTimeout(responseTimeoutRef.current);
      responseTimeoutRef.current = setTimeout(() => {
        responseTimeoutRef.current = null;
        if (processingRef.current) {
          console.log("[Molty] Response timeout — resuming listening");
          processingRef.current = false;
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
      const result = await window.openclaw.send(chatReq);
      console.log("[Molty] Send result:", JSON.stringify(result));
    },
    [pause, resume]
  );

  // ── Handle new transcripts (wake-word gated) ─────────────────────────

  useEffect(() => {
    if (!transcript) return;
    if (processingRef.current) {
      setTranscript(null);
      return; // ignore while busy; user can press Stop
    }

    // If we're awaiting a follow-up query after user said just "Molty"
    if (awaitingQueryRef.current) {
      awaitingQueryRef.current = false;
      if (awaitingTimeoutRef.current) {
        clearTimeout(awaitingTimeoutRef.current);
        awaitingTimeoutRef.current = null;
      }
      setSubtitle("");
      processTranscript(transcript);
      setTranscript(null);
      return;
    }

    // Check for wake word "molty" or common mis-transcriptions (case-insensitive)
    const lower = transcript.toLowerCase();
    const wakeWords = ["molty", "malty", "molti", "malti", "multi", "moulty", "moulty", "melty"];
    let matchIdx = -1;
    let matchLen = 0;
    for (const w of wakeWords) {
      const i = lower.indexOf(w);
      if (i !== -1) {
        matchIdx = i;
        matchLen = w.length;
        break;
      }
    }
    if (matchIdx === -1) {
      // No wake word — ignore
      setTranscript(null);
      return;
    }

    // Extract everything after the wake word
    const query = transcript.slice(matchIdx + matchLen).trim();
    setTranscript(null);

    if (!query) {
      // User just said "Molty" — acknowledge and wait for the next utterance
      setFace("listening");
      setSubtitle("I'm listening...");
      awaitingQueryRef.current = true;
      // Auto-reset after 10 seconds if no follow-up comes
      awaitingTimeoutRef.current = setTimeout(() => {
        awaitingQueryRef.current = false;
        awaitingTimeoutRef.current = null;
        setSubtitle("");
        setFace("listening");
      }, 10_000);
      return;
    }

    processTranscript(query);
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
          // Streaming delta — accumulate text
          if (runId && runId !== currentRunId) {
            currentRunId = runId;
            accumulated = "";
          }
          if (textContent) {
            accumulated = textContent; // delta sends full text so far
            // Show last ~200 chars of stripped text during streaming so captions stay readable
            const cleaned = stripMarkdown(accumulated);
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

          // Final response — speak it
          const rawFinal = textContent || accumulated;
          const finalText = stripMarkdown(rawFinal);
          console.log("[Molty] Chat final:", finalText.slice(0, 120));
          currentRunId = null;
          accumulated = "";

          if (!finalText.trim()) {
            // Empty response — resume listening
            processingRef.current = false;
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

          setSubtitle(finalText);
          setIsTalking(true);

          // Keep mic paused while speaking to avoid picking up TTS audio.
          // The user can still interrupt via the Stop button.

          const result = await speak(finalText);

          // If interrupted, the interrupt() handler already reset everything
          if (result === "interrupted") {
            return;
          }

          // Normal completion — resume mic now that TTS is done
          setIsTalking(false);
          processingRef.current = false;
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
          if (responseTimeoutRef.current) {
            clearTimeout(responseTimeoutRef.current);
            responseTimeoutRef.current = null;
          }
          setFace("error");
          setSubtitle(errMsg);
          setTimeout(() => {
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
  }, [speak, resume, interrupt]);

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
    }
  }, [isConnected, isReady]);

  // ── Stop button handler ────────────────────────────────────────────────

  const stopAndResume = useCallback(() => {
    console.log("[Molty] Stop button pressed");
    interrupt();
    resume();

    // Tell the agent the user asked to stop
    const stopReq = {
      type: "req",
      id: `chat-stop-${Date.now()}`,
      method: "chat.send",
      params: {
        sessionKey: "main",
        message: "/stop",
        idempotencyKey: `kiosk-stop-${Date.now()}`,
      },
    };
    window.openclaw.send(stopReq).catch(() => {});
  }, [interrupt, resume]);

  // Derive "busy" from reactive state (face is "thinking" while waiting, isTalking while speaking)
  const isBusy = face === "thinking" || isTalking || (!!subtitle && face !== "idle" && face !== "error" && face !== "listening");

  return {
    face, isTalking, subtitle, isReady, isListening, isConnected,
    isBusy, stopAndResume,
  };
}
