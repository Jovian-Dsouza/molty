import { useState, useCallback, useEffect, useRef } from "react";
import { useVoice } from "./useVoice";

export function useMoltyState() {
  const [face, setFace] = useState<FaceExpression>("idle");
  const [isTalking, setIsTalking] = useState(false);
  const [subtitle, setSubtitle] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const processingRef = useRef(false);
  const responseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [processTrigger, setProcessTrigger] = useState(0);

  const { isListening, transcript, setTranscript, pause, resume } =
    useVoice(isReady);

  // Update face based on voice state
  useEffect(() => {
    if (!processingRef.current && isListening) {
      setFace("idle");
    }
  }, [isListening]);

  // Speak text using browser SpeechSynthesis
  const speak = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      if (!("speechSynthesis" in window)) {
        console.log("[Molty] SpeechSynthesis not available, skipping TTS");
        resolve();
        return;
      }

      console.log("[Molty] Speaking:", text.slice(0, 80));
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 1.0;
      utterance.pitch = 1.1;
      utterance.volume = 1.0;

      utterance.onend = () => {
        console.log("[Molty] Finished speaking");
        resolve();
      };
      utterance.onerror = (e) => {
        console.error("[Molty] TTS error:", e.error);
        resolve();
      };

      speechSynthesis.speak(utterance);
    });
  }, []);

  // Process a transcript: send to OpenClaw via chat.send RPC, wait for response
  const processTranscript = useCallback(
    async (text: string) => {
      if (processingRef.current) return;
      processingRef.current = true;

      console.log("[Molty] Processing transcript:", text);

      // Pause mic to avoid echo
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
          setFace("idle");
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

  // When a new transcript arrives (or we just finished handling one), process it
  useEffect(() => {
    if (transcript && !processingRef.current) {
      processTranscript(transcript);
      setTranscript(null);
    }
  }, [transcript, processTrigger, processTranscript, setTranscript]);

  // Listen for OpenClaw chat events (streamed response)
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
            setSubtitle(accumulated);
          }
          console.log(`[Molty] Chat delta (seq=${chatPayload.seq}): ${accumulated.slice(0, 80)}...`);
          return;
        }

        if (state === "final") {
          // Final response — speak it
          const finalText = textContent || accumulated;
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
            setFace("idle");
            setSubtitle("");
            resume();
            setProcessTrigger((t) => t + 1);
            return;
          }

          setSubtitle(finalText);
          setIsTalking(true);

          await speak(finalText);

          setIsTalking(false);
          processingRef.current = false;
          if (responseTimeoutRef.current) {
            clearTimeout(responseTimeoutRef.current);
            responseTimeoutRef.current = null;
          }
          setFace("idle");
          setSubtitle("");

          // Resume mic listening
          resume();
          setProcessTrigger((t) => t + 1);
          return;
        }

        if (state === "error" || state === "aborted") {
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
            setFace("idle");
            setSubtitle("");
            resume();
            setProcessTrigger((t) => t + 1);
          }, 3000);
          return;
        }
      }
    });
    return off;
  }, [speak, resume]);

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

  return { face, isTalking, subtitle, isReady, isListening, isConnected };
}
