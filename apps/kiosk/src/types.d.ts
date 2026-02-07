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
  }
}
