export {}

declare global {
  type PicoclawStatus = "disconnected" | "connecting" | "connected" | "error"

  type PicoclawStatusPayload = {
    status: PicoclawStatus
    error?: string | null
  }

  type PicoclawMessagePayload = {
    direction: "in" | "out" | "system"
    data: string
    ts: number
  }

  type FaceExpression =
    | "idle"
    | "listening"
    | "thinking"
    | "excited"
    | "watching"
    | "winning"
    | "losing"
    | "celebrating"
    | "dying"
    | "error"

  interface Window {
    hume: {
      speak: (text: string) => Promise<{ ok: boolean; error?: string }>
      stop: () => Promise<{ ok: boolean }>
      onAudioChunk: (handler: (audioBase64: string) => void) => () => void
      onAudioDone: (handler: () => void) => () => void
      onAudioError: (handler: (error: string) => void) => () => void
    }
    picoclaw: {
      connect: () => Promise<PicoclawStatusPayload>
      disconnect: () => Promise<PicoclawStatusPayload>
      getStatus: () => Promise<PicoclawStatusPayload>
      send: (payload: unknown) => Promise<{ ok: boolean; error?: string }>
      onStatus: (handler: (payload: PicoclawStatusPayload) => void) => () => void
      onMessage: (handler: (payload: PicoclawMessagePayload) => void) => () => void
      startListening: () => Promise<{ ok: boolean; error?: string }>
      stopListening: () => Promise<{ ok: boolean; error?: string }>
      sendAudioChunk: (pcmData: ArrayBuffer) => void
      onTranscript: (handler: (text: string) => void) => () => void
    }
    motors: {
      command: (cmd: Record<string, unknown>) => Promise<{ ok: boolean; error?: string }>
      setEmotion: (emotion: string) => Promise<{ ok: boolean; error?: string }>
      stop: () => Promise<{ ok: boolean; error?: string }>
      setServos: (angle1: number, angle2: number) => Promise<{ ok: boolean; error?: string }>
      onStatus: (handler: (status: { type: string; status: string; message: string }) => void) => () => void
    }
  }
}
