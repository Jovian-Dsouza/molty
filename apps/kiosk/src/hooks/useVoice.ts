import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Captures mic audio as 16-bit PCM at 16kHz and streams chunks to
 * the Electron main process (which forwards to AssemblyAI).
 * Listens for completed transcript "turns" from the main process.
 */
export function useVoice(enabled: boolean) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState<string | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const pausedRef = useRef(false);

  const start = useCallback(async () => {
    if (streamRef.current) return;

    // Start the AssemblyAI transcriber in the main process
    const result = await window.openclaw.startListening();
    if (!result.ok) {
      console.error("[useVoice] Failed to start transcriber:", result.error);
      return;
    }

    // Capture mic audio
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    streamRef.current = stream;

    // Set up AudioContext to resample + extract PCM
    const audioCtx = new AudioContext({ sampleRate: 16000 });
    contextRef.current = audioCtx;

    const source = audioCtx.createMediaStreamSource(stream);

    // ScriptProcessorNode to get raw PCM frames
    // (AudioWorklet would be cleaner but ScriptProcessor is simpler for hackathon)
    const processor = audioCtx.createScriptProcessor(4096, 1, 1);
    processorRef.current = processor;

    processor.onaudioprocess = (event) => {
      if (pausedRef.current) return;

      const float32 = event.inputBuffer.getChannelData(0);

      // Convert float32 [-1,1] to int16 PCM
      const int16 = new Int16Array(float32.length);
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]));
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
      }

      window.openclaw.sendAudioChunk(int16.buffer);
    };

    source.connect(processor);
    processor.connect(audioCtx.destination); // required for ScriptProcessor to fire

    setIsListening(true);
  }, []);

  const stop = useCallback(async () => {
    // Stop mic
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (contextRef.current) {
      await contextRef.current.close();
      contextRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }

    // Stop the AssemblyAI transcriber
    await window.openclaw.stopListening();
    setIsListening(false);
  }, []);

  /** Pause audio streaming (e.g. while Molty is speaking to avoid echo) */
  const pause = useCallback(() => {
    pausedRef.current = true;
  }, []);

  /** Resume audio streaming (do not clear transcript so any sentence that arrived while paused can be processed) */
  const resume = useCallback(() => {
    pausedRef.current = false;
  }, []);

  // Auto-start/stop based on enabled prop
  useEffect(() => {
    if (enabled) {
      start();
    } else {
      stop();
    }
    return () => {
      stop();
    };
  }, [enabled, start, stop]);

  // Listen for transcript events from main process (accept even when paused so we don't drop later sentences)
  useEffect(() => {
    const off = window.openclaw.onTranscript((text) => {
      setTranscript(text);
    });
    return off;
  }, []);

  return { isListening, transcript, setTranscript, pause, resume };
}
