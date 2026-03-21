import { useState, useCallback, useEffect, useRef } from "react"
import { useVoice } from "./useVoice.ts"
import { useSpeech } from "./useSpeech.ts"

// ── Helpers ──────────────────────────────────────────────────────────────

function stripMarkdown(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/#{1,6}\s+/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/^[-*+]\s+/gm, "")
    .replace(/^\d+\.\s+/gm, "")
    .replace(/\n{2,}/g, "\n")
    .trim()
}

function isPlaceholder(text: string): boolean {
  return text.trim() === "Thinking... 💭"
}

const VALID_FACES = new Set<FaceExpression>([
  "idle", "listening", "thinking", "excited", "watching",
  "winning", "losing", "celebrating", "dying", "error",
])

function parseFaceDirectives(text: string): {
  cleaned: string
  face: FaceExpression | null
} {
  const faceRegex = /\[face:(\w+)\]/g
  let lastFace: FaceExpression | null = null
  let match
  while ((match = faceRegex.exec(text)) !== null) {
    if (VALID_FACES.has(match[1] as FaceExpression)) {
      lastFace = match[1] as FaceExpression
    }
  }
  const cleaned = text.replace(/\[face:\w+\]/g, "").trim()
  return { cleaned, face: lastFace }
}

// ── Hook ─────────────────────────────────────────────────────────────────

export function useMoltyState() {
  const [face, setFace] = useState<FaceExpression>("idle")
  const [isSending, setIsSending] = useState(false)
  const [subtitle, setSubtitle] = useState("")
  const [isConnected, setIsConnected] = useState(false)
  const [isReady, setIsReady] = useState(false)
  const processingRef = useRef(false)
  const thinkingLockRef = useRef(false)
  const responseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const errorDisplayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [processTrigger, setProcessTrigger] = useState(0)

  const { speak, interrupt, isTalking } = useSpeech()
  const { isListening, transcript, setTranscript, pause, resume } =
    useVoice(isReady)

  // Sync face → listening when idle
  useEffect(() => {
    if (!processingRef.current && !thinkingLockRef.current && isListening) {
      setFace("listening")
    }
  }, [isListening])

  // Sync face → motors
  useEffect(() => {
    if (window.motors) {
      window.motors.setEmotion(face).catch((err) => {
        console.warn("[Molty] Motor setEmotion failed:", err)
      })
    }
  }, [face])

  // ── Reset processing state ───────────────────────────────────────────

  const resetProcessing = useCallback(() => {
    processingRef.current = false
    thinkingLockRef.current = false
    setIsSending(false)
    if (responseTimeoutRef.current) {
      clearTimeout(responseTimeoutRef.current)
      responseTimeoutRef.current = null
    }
    if (errorDisplayTimeoutRef.current) {
      clearTimeout(errorDisplayTimeoutRef.current)
      errorDisplayTimeoutRef.current = null
    }
  }, [])

  // ── Interrupt handler ────────────────────────────────────────────────

  const handleInterrupt = useCallback(() => {
    interrupt()
    resetProcessing()
    setFace("listening")
    setSubtitle("")
  }, [interrupt, resetProcessing])

  // ── Process transcript ───────────────────────────────────────────────

  const processTranscript = useCallback(
    async (text: string) => {
      if (processingRef.current) return
      processingRef.current = true

      console.log("[Molty] Processing transcript:", text)

      if (errorDisplayTimeoutRef.current) {
        clearTimeout(errorDisplayTimeoutRef.current)
        errorDisplayTimeoutRef.current = null
      }

      pause()
      thinkingLockRef.current = true
      setFace("thinking")
      setSubtitle(`Sending: "${text}"`)
      setIsSending(true)

      // Timeout safety: resume after 30s if no response
      if (responseTimeoutRef.current) clearTimeout(responseTimeoutRef.current)
      responseTimeoutRef.current = setTimeout(() => {
        responseTimeoutRef.current = null
        if (processingRef.current) {
          console.log("[Molty] Response timeout — resuming listening")
          resetProcessing()
          setFace("listening")
          setSubtitle("")
          resume()
          setProcessTrigger((t) => t + 1)
        }
      }, 30_000)

      const chatReq = {
        type: "message.send",
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        payload: { content: text },
      }

      try {
        await window.picoclaw.send(chatReq)
      } catch (err) {
        console.error("[Molty] message.send failed:", err)
        resetProcessing()
        setFace("error")
        setSubtitle("Failed to send message")
        errorDisplayTimeoutRef.current = setTimeout(() => {
          errorDisplayTimeoutRef.current = null
          setFace("listening")
          setSubtitle("")
          resume()
          setProcessTrigger((t) => t + 1)
        }, 3000)
      }
      setIsSending(false)
    },
    [pause, resume, resetProcessing],
  )

  // ── Handle new transcripts ───────────────────────────────────────────

  useEffect(() => {
    if (!transcript) return
    if (processingRef.current) {
      setTranscript(null)
      return
    }
    setTranscript(null)
    processTranscript(transcript)
  }, [transcript, processTrigger, processTranscript, setTranscript])

  // ── Handle Pico Protocol messages ────────────────────────────────────

  useEffect(() => {
    let latestMessageId: string | null = null
    let latestContent = ""
    let typingDone = false

    const finalizeSpeech = async (rawContent: string) => {
      if (!processingRef.current) return

      const strippedFinal = stripMarkdown(rawContent)
      const { cleaned: finalText, face: agentFace } =
        parseFaceDirectives(strippedFinal)

      latestMessageId = null
      latestContent = ""
      typingDone = false

      if (!finalText.trim()) {
        resetProcessing()
        setFace("listening")
        setSubtitle("")
        resume()
        setProcessTrigger((t) => t + 1)
        return
      }

      thinkingLockRef.current = false
      if (agentFace) setFace(agentFace)
      setSubtitle(finalText)

      if (responseTimeoutRef.current) {
        clearTimeout(responseTimeoutRef.current)
        responseTimeoutRef.current = null
      }

      pause()
      const result = await speak(finalText)

      if (result === "interrupted") return

      if (responseTimeoutRef.current) {
        clearTimeout(responseTimeoutRef.current)
        responseTimeoutRef.current = null
      }
      setFace("listening")
      await new Promise((r) => setTimeout(r, 300))
      setTranscript(null)
      processingRef.current = false
      resume()
      setSubtitle("I'm listening...")
      setProcessTrigger((t) => t + 1)
    }

    const off = window.picoclaw.onMessage(async (payload) => {
      if (payload.direction !== "in") return

      let msg: Record<string, unknown>
      try {
        msg = JSON.parse(payload.data)
      } catch {
        return
      }

      const msgType = msg.type as string | undefined

      if (msgType === "typing.start") {
        setIsSending(false)
        return
      }

      if (msgType === "typing.stop") {
        typingDone = true
        if (latestContent && !isPlaceholder(latestContent)) {
          await finalizeSpeech(latestContent)
          typingDone = false
        }
        return
      }

      if (msgType === "message.create") {
        const msgPayload = msg.payload as
          | { content?: string; message_id?: string }
          | undefined
        const content = msgPayload?.content ?? ""
        const messageId = msgPayload?.message_id ?? null

        setIsSending(false)

        if (messageId) {
          latestMessageId = messageId
          latestContent = content
        }

        if (content && !isPlaceholder(content)) {
          const stripped = stripMarkdown(content)
          const { cleaned, face: streamFace } = parseFaceDirectives(stripped)
          if (streamFace && !thinkingLockRef.current) setFace(streamFace)
          const display =
            cleaned.length > 200 ? "..." + cleaned.slice(-200) : cleaned
          setSubtitle(display)
        }
        return
      }

      if (msgType === "message.update") {
        const msgPayload = msg.payload as
          | { message_id?: string; content?: string }
          | undefined
        const content = msgPayload?.content ?? ""
        const messageId = msgPayload?.message_id ?? null

        if (messageId === latestMessageId || !latestMessageId) {
          latestMessageId = messageId
          latestContent = content
        }

        if (content) {
          const stripped = stripMarkdown(content)
          const { cleaned, face: streamFace } = parseFaceDirectives(stripped)
          if (streamFace && !thinkingLockRef.current) setFace(streamFace)
          const display =
            cleaned.length > 200 ? "..." + cleaned.slice(-200) : cleaned
          setSubtitle(display)
        }

        if (typingDone && content && !isPlaceholder(content)) {
          typingDone = false
          await finalizeSpeech(content)
        }
        return
      }

      if (msgType === "error") {
        if (!processingRef.current) return

        const errPayload = msg.payload as
          | { message?: string; code?: string }
          | undefined
        const errMsg =
          errPayload?.message ?? errPayload?.code ?? "Gateway error"
        console.error("[Molty] Pico error:", errMsg)

        latestMessageId = null
        latestContent = ""
        resetProcessing()
        setFace("error")
        setSubtitle(errMsg)
        errorDisplayTimeoutRef.current = setTimeout(() => {
          errorDisplayTimeoutRef.current = null
          setFace("listening")
          setSubtitle("")
          resume()
          setProcessTrigger((t) => t + 1)
        }, 3000)
      }
    })
    return off
  }, [speak, pause, resume, setTranscript, resetProcessing])

  // ── Connection lifecycle ─────────────────────────────────────────────

  useEffect(() => {
    const off = window.picoclaw.onStatus((status) => {
      console.log("[Molty] Picoclaw status:", status.status, status.error ?? "")
      setIsConnected(status.status === "connected")
    })
    return off
  }, [])

  useEffect(() => {
    async function init() {
      console.log("[Molty] Connecting to picoclaw...")
      try {
        const result = await window.picoclaw.connect()
        if (result.status === "connected") {
          setIsConnected(true)
          setIsReady(true)
        }
      } catch (err) {
        console.error("[Molty] Connect error:", err)
      }
    }
    init()
  }, [])

  useEffect(() => {
    if (isConnected && !isReady) {
      setIsReady(true)
      setFace("listening")
      setSubtitle("I'm listening...")
    }
  }, [isConnected, isReady])

  return {
    face,
    isTalking,
    isSending,
    subtitle,
    isReady,
    isListening,
    isConnected,
    handleInterrupt,
  }
}
