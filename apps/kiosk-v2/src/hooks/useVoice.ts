import { useEffect, useRef, useState, useCallback } from "react"

/**
 * Captures mic audio as 16-bit PCM at 16kHz and streams chunks to
 * the Electron main process (which forwards to AssemblyAI).
 * Listens for completed transcript turns from the main process.
 */
export function useVoice(enabled: boolean) {
  const [isListening, setIsListening] = useState(false)
  const [transcript, setTranscript] = useState<string | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const pausedRef = useRef(false)

  const start = useCallback(async () => {
    if (streamRef.current) return

    console.log("[useVoice] Starting voice capture pipeline...")

    const result = await window.picoclaw.startListening()
    if (!result.ok) {
      console.error("[useVoice] Failed to start transcriber:", result.error)
      return
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    })
    streamRef.current = stream

    const audioCtx = new AudioContext({ sampleRate: 16000 })
    contextRef.current = audioCtx

    const source = audioCtx.createMediaStreamSource(stream)
    const processor = audioCtx.createScriptProcessor(4096, 1, 1)
    processorRef.current = processor

    processor.onaudioprocess = (event) => {
      if (pausedRef.current) return

      const float32 = event.inputBuffer.getChannelData(0)
      const int16 = new Int16Array(float32.length)
      for (let i = 0; i < float32.length; i++) {
        const s = Math.max(-1, Math.min(1, float32[i]))
        int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff
      }

      window.picoclaw.sendAudioChunk(int16.buffer)
    }

    source.connect(processor)
    processor.connect(audioCtx.destination)
    setIsListening(true)
  }, [])

  const stop = useCallback(async () => {
    if (processorRef.current) {
      processorRef.current.disconnect()
      processorRef.current = null
    }
    if (contextRef.current) {
      await contextRef.current.close()
      contextRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }

    await window.picoclaw.stopListening()
    setIsListening(false)
  }, [])

  const pause = useCallback(() => {
    pausedRef.current = true
  }, [])

  const resume = useCallback(() => {
    pausedRef.current = false
  }, [])

  useEffect(() => {
    if (enabled) {
      start()
    } else {
      stop()
    }
    return () => {
      stop()
    }
  }, [enabled, start, stop])

  useEffect(() => {
    const off = window.picoclaw.onTranscript((text) => {
      console.log("[useVoice] Transcript received:", text)
      setTranscript(text)
    })
    return off
  }, [])

  return { isListening, transcript, setTranscript, pause, resume }
}
