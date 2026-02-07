import { useState, useCallback, useEffect, useRef } from 'react'
import { useVoice } from './useVoice'

export function useMoltyState() {
  const [face, setFace] = useState<FaceExpression>('idle')
  const [isTalking, setIsTalking] = useState(false)
  const [subtitle, setSubtitle] = useState('')
  const [isReady, setIsReady] = useState(false)
  const processingRef = useRef(false)

  const { isListening, transcript, setTranscript, pause, resume } = useVoice(isReady)

  // Update face based on voice state
  useEffect(() => {
    if (!processingRef.current && isListening) {
      setFace('idle')
    }
  }, [isListening])

  // Speak text using browser SpeechSynthesis
  const speak = useCallback((text: string): Promise<void> => {
    return new Promise((resolve) => {
      if (!('speechSynthesis' in window)) {
        resolve()
        return
      }

      const utterance = new SpeechSynthesisUtterance(text)
      utterance.rate = 1.0
      utterance.pitch = 1.1
      utterance.volume = 1.0

      utterance.onend = () => resolve()
      utterance.onerror = () => resolve()

      speechSynthesis.speak(utterance)
    })
  }, [])

  // Process a transcript: send to OpenClaw, wait for response
  const processTranscript = useCallback(async (text: string) => {
    if (processingRef.current) return
    processingRef.current = true

    // Pause mic to avoid echo
    pause()
    setFace('thinking')
    setSubtitle(text)

    // Send to OpenClaw gateway
    const message = {
      type: 'voice_input',
      text,
      timestamp: Date.now(),
    }
    await window.openclaw.send(message)

    // Response will come via onMessage listener (set up in useEffect below)
  }, [pause])

  // When a new transcript arrives, process it
  useEffect(() => {
    if (transcript && !processingRef.current) {
      processTranscript(transcript)
      setTranscript(null)
    }
  }, [transcript, processTranscript, setTranscript])

  // Listen for OpenClaw responses
  useEffect(() => {
    const off = window.openclaw.onMessage(async (payload) => {
      if (payload.direction !== 'in') return
      if (!processingRef.current) return

      try {
        const msg = JSON.parse(payload.data) as ServerToKiosk
        if (msg.type !== 'response') return

        // Update face expression from server
        if (msg.face) {
          setFace(msg.face)
        }

        // Show subtitle and speak the response
        setSubtitle(msg.text)
        setIsTalking(true)

        await speak(msg.text)

        setIsTalking(false)
        processingRef.current = false
        setFace('idle')
        setSubtitle('')

        // Resume mic listening
        resume()
      } catch {
        // Not a valid ServerToKiosk message, ignore
      }
    })
    return off
  }, [speak, resume])

  // Auto-connect to OpenClaw and start
  useEffect(() => {
    async function init() {
      try {
        await window.openclaw.connect()
      } catch {
        // Connection may already be established
      }
      setIsReady(true)
    }
    init()
  }, [])

  return { face, isTalking, subtitle, isReady, isListening }
}
