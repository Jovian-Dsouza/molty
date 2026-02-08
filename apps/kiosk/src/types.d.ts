export {}

declare global {
  type OpenClawStatus = 'disconnected' | 'connecting' | 'connected' | 'error'

  type OpenClawStatusPayload = {
    status: OpenClawStatus
    error?: string | null
  }

  type OpenClawMessagePayload = {
    direction: 'in' | 'out' | 'system'
    data: string
    ts: number
  }

  type FaceExpression =
    | 'idle'
    | 'listening'
    | 'thinking'
    | 'excited'
    | 'watching'
    | 'winning'
    | 'losing'
    | 'celebrating'
    | 'dying'
    | 'error'

  type ServerToKiosk = {
    type: 'response'
    text: string
    face: FaceExpression
    motors?: {
      action: string
      params?: Record<string, number>
    }
  }

  interface Window {
    hume: {
      speak: (text: string) => Promise<{ ok: boolean; error?: string }>
      stop: () => Promise<{ ok: boolean }>
      onAudioChunk: (handler: (audioBase64: string) => void) => () => void
      onAudioDone: (handler: () => void) => () => void
      onAudioError: (handler: (error: string) => void) => () => void
    }
    openclaw: {
      connect: () => Promise<OpenClawStatusPayload>
      disconnect: () => Promise<OpenClawStatusPayload>
      getStatus: () => Promise<OpenClawStatusPayload>
      send: (payload: unknown) => Promise<{ ok: boolean; error?: string }>
      onStatus: (handler: (payload: OpenClawStatusPayload) => void) => () => void
      onMessage: (handler: (payload: OpenClawMessagePayload) => void) => () => void
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
