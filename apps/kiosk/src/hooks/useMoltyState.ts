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

  // Process a transcript: send to OpenClaw, wait for response
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
      }, 15_000);

      const message = {
        type: "voice_input",
        text,
        timestamp: Date.now(),
      };
      console.log("[Molty] Sending to OpenClaw:", JSON.stringify(message));
      const result = await window.openclaw.send(message);
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

  // Listen for OpenClaw responses
  useEffect(() => {
    const off = window.openclaw.onMessage(async (payload) => {
      console.log(`[Molty] Message received: direction=${payload.direction} data=${payload.data.slice(0, 200)}`);

      if (payload.direction !== "in") return;
      if (!processingRef.current) {
        console.log("[Molty] Ignoring — not currently processing a transcript");
        return;
      }

      try {
        const msg = JSON.parse(payload.data) as ServerToKiosk;
        if (msg.type !== "response") {
          console.log("[Molty] Ignoring message type:", msg.type);
          return;
        }

        console.log("[Molty] Got response — face:", msg.face, "text:", msg.text?.slice(0, 80));

        // Update face expression from server
        if (msg.face) {
          setFace(msg.face);
        }

        // Show subtitle and speak the response
        setSubtitle(msg.text);
        setIsTalking(true);

        await speak(msg.text);

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
      } catch {
        // Not a valid ServerToKiosk message, ignore
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
