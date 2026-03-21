import { useCallback, useRef, useState } from "react"

/**
 * Hume AI TTS streaming with browser SpeechSynthesis fallback.
 * Manages AudioContext lifecycle and interrupt capability.
 */
export function useSpeech() {
  const [isTalking, setIsTalking] = useState(false)
  const interruptedRef = useRef(false)
  const audioCtxRef = useRef<AudioContext | null>(null)
  const humeCleanupRef = useRef<(() => void) | null>(null)

  // ── Browser TTS fallback ─────────────────────────────────────────────

  const speakBrowser = useCallback(
    (text: string): Promise<"done" | "interrupted"> => {
      return new Promise((resolve) => {
        if (!("speechSynthesis" in window)) {
          resolve("done")
          return
        }

        const utterance = new SpeechSynthesisUtterance(text)
        utterance.rate = 1.0
        utterance.pitch = 1.1
        utterance.volume = 1.0

        utterance.onend = () => {
          resolve(interruptedRef.current ? "interrupted" : "done")
        }
        utterance.onerror = (e) => {
          if (e.error === "canceled" || interruptedRef.current) {
            resolve("interrupted")
          } else {
            console.error("[Speech] Browser TTS error:", e.error)
            resolve("done")
          }
        }

        speechSynthesis.speak(utterance)
      })
    },
    [],
  )

  // ── Hume AI TTS streaming ────────────────────────────────────────────

  const speak = useCallback(
    async (text: string): Promise<"done" | "interrupted"> => {
      interruptedRef.current = false
      setIsTalking(true)

      try {
        const result = await window.hume.speak(text)

        if (interruptedRef.current) {
          setIsTalking(false)
          return "interrupted"
        }

        if (!result.ok) {
          console.warn("[Speech] Hume TTS unavailable:", result.error)
          const outcome = await speakBrowser(text)
          setIsTalking(false)
          return outcome
        }

        const audioCtx = new AudioContext()
        audioCtxRef.current = audioCtx

        return new Promise<"done" | "interrupted">((resolve) => {
          let nextStartTime = audioCtx.currentTime
          let streamDone = false
          let chunksScheduled = 0
          let chunksFinished = 0
          let resolved = false
          let decodeChain = Promise.resolve()

          const finish = (outcome: "done" | "interrupted") => {
            if (resolved) return
            resolved = true
            cleanup()
            audioCtxRef.current = null
            try {
              audioCtx.close()
            } catch {
              /* ignore */
            }
            setIsTalking(false)
            resolve(outcome)
          }

          const checkComplete = () => {
            if (streamDone && chunksFinished === chunksScheduled) {
              finish(interruptedRef.current ? "interrupted" : "done")
            }
          }

          const offChunk = window.hume.onAudioChunk((audioBase64: string) => {
            if (interruptedRef.current || resolved) return

            decodeChain = decodeChain.then(async () => {
              if (interruptedRef.current || resolved) return

              try {
                const binaryStr = atob(audioBase64)
                const bytes = new Uint8Array(binaryStr.length)
                for (let i = 0; i < binaryStr.length; i++) {
                  bytes[i] = binaryStr.charCodeAt(i)
                }

                const audioBuffer = await audioCtx.decodeAudioData(
                  bytes.buffer.slice(0),
                )
                if (interruptedRef.current || resolved) return

                const source = audioCtx.createBufferSource()
                source.buffer = audioBuffer
                source.connect(audioCtx.destination)

                const startAt = Math.max(nextStartTime, audioCtx.currentTime)
                source.start(startAt)
                nextStartTime = startAt + audioBuffer.duration

                chunksScheduled++
                source.onended = () => {
                  chunksFinished++
                  checkComplete()
                }
              } catch (err) {
                console.error("[Speech] Failed to decode audio chunk:", err)
              }
            })
          })

          const offDone = window.hume.onAudioDone(() => {
            streamDone = true
            if (chunksScheduled === 0) {
              console.warn("[Speech] Hume stream ended with 0 chunks — fallback")
              cleanup()
              audioCtxRef.current = null
              try {
                audioCtx.close()
              } catch {
                /* ignore */
              }
              speakBrowser(text).then((r) => {
                if (resolved) return
                resolved = true
                setIsTalking(false)
                resolve(r)
              })
              return
            }
            checkComplete()
          })

          const offError = window.hume.onAudioError((error: string) => {
            console.warn("[Speech] Hume TTS stream error:", error)
            cleanup()
            audioCtxRef.current = null
            try {
              audioCtx.close()
            } catch {
              /* ignore */
            }
            speakBrowser(text).then((r) => {
              if (resolved) return
              resolved = true
              setIsTalking(false)
              resolve(r)
            })
          })

          const cleanup = () => {
            offChunk()
            offDone()
            offError()
            humeCleanupRef.current = null
          }

          humeCleanupRef.current = cleanup
        })
      } catch (err) {
        console.error("[Speech] Hume TTS error:", err)
        audioCtxRef.current = null
        const outcome = await speakBrowser(text)
        setIsTalking(false)
        return outcome
      }
    },
    [speakBrowser],
  )

  // ── Interrupt ────────────────────────────────────────────────────────

  const interrupt = useCallback(() => {
    interruptedRef.current = true

    window.hume.stop().catch(() => {})

    if (humeCleanupRef.current) {
      humeCleanupRef.current()
      humeCleanupRef.current = null
    }

    if (audioCtxRef.current) {
      try {
        audioCtxRef.current.close()
      } catch {
        // best-effort
      }
      audioCtxRef.current = null
    }

    if ("speechSynthesis" in window) {
      speechSynthesis.cancel()
    }

    setIsTalking(false)
  }, [])

  return { speak, interrupt, isTalking }
}
