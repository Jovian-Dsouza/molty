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

  interface Window {
    openclaw: {
      connect: () => Promise<OpenClawStatusPayload>
      disconnect: () => Promise<OpenClawStatusPayload>
      getStatus: () => Promise<OpenClawStatusPayload>
      send: (payload: unknown) => Promise<{ ok: boolean; error?: string }>
      onStatus: (handler: (payload: OpenClawStatusPayload) => void) => () => void
      onMessage: (handler: (payload: OpenClawMessagePayload) => void) => () => void
    }
  }
}
