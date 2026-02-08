import { ipcRenderer, contextBridge } from 'electron'

type OpenClawStatusPayload = {
  status: 'disconnected' | 'connecting' | 'connected' | 'error'
  error?: string | null
}

type OpenClawMessagePayload = {
  direction: 'in' | 'out' | 'system'
  data: string
  ts: number
}

function subscribe<T>(channel: string, handler: (payload: T) => void) {
  const listener = (_event: Electron.IpcRendererEvent, payload: T) => handler(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.off(channel, listener)
}

contextBridge.exposeInMainWorld('ipcRenderer', {
  on: (...args: Parameters<typeof ipcRenderer.on>) => ipcRenderer.on(...args),
  off: (...args: Parameters<typeof ipcRenderer.off>) => ipcRenderer.off(...args),
  send: (...args: Parameters<typeof ipcRenderer.send>) => ipcRenderer.send(...args),
  invoke: (...args: Parameters<typeof ipcRenderer.invoke>) => ipcRenderer.invoke(...args),
})

contextBridge.exposeInMainWorld('hume', {
  // Start streaming TTS — audio arrives via onAudioChunk events
  speak: (text: string) =>
    ipcRenderer.invoke('hume:speak', text) as Promise<{ ok: boolean; error?: string }>,
  // Abort the current TTS stream
  stop: () =>
    ipcRenderer.invoke('hume:stop') as Promise<{ ok: boolean }>,
  // Streaming events
  onAudioChunk: (handler: (audioBase64: string) => void) =>
    subscribe<string>('hume:audio-chunk', handler),
  onAudioDone: (handler: () => void) => {
    const listener = () => handler()
    ipcRenderer.on('hume:audio-done', listener)
    return () => ipcRenderer.off('hume:audio-done', listener)
  },
  onAudioError: (handler: (error: string) => void) =>
    subscribe<string>('hume:audio-error', handler),
})

contextBridge.exposeInMainWorld('openclaw', {
  // OpenClaw gateway
  connect: () => ipcRenderer.invoke('openclaw:connect') as Promise<OpenClawStatusPayload>,
  disconnect: () => ipcRenderer.invoke('openclaw:disconnect') as Promise<OpenClawStatusPayload>,
  getStatus: () => ipcRenderer.invoke('openclaw:get-status') as Promise<OpenClawStatusPayload>,
  send: (payload: unknown) => ipcRenderer.invoke('openclaw:send', payload) as Promise<{ ok: boolean; error?: string }>,
  onStatus: (handler: (payload: OpenClawStatusPayload) => void) =>
    subscribe<OpenClawStatusPayload>('openclaw:status', handler),
  onMessage: (handler: (payload: OpenClawMessagePayload) => void) =>
    subscribe<OpenClawMessagePayload>('openclaw:message', handler),

  // AssemblyAI streaming STT
  startListening: () => ipcRenderer.invoke('openclaw:start-listening') as Promise<{ ok: boolean; error?: string }>,
  stopListening: () => ipcRenderer.invoke('openclaw:stop-listening') as Promise<{ ok: boolean; error?: string }>,
  sendAudioChunk: (pcmData: ArrayBuffer) => ipcRenderer.send('openclaw:audio-chunk', pcmData),
  onTranscript: (handler: (text: string) => void) =>
    subscribe<string>('openclaw:transcript', handler),
})

contextBridge.exposeInMainWorld('motors', {
  command: (cmd: Record<string, unknown>) =>
    ipcRenderer.invoke('motors:command', cmd) as Promise<{ ok: boolean; error?: string }>,
  setEmotion: (emotion: string) =>
    ipcRenderer.invoke('motors:set-emotion', emotion) as Promise<{ ok: boolean; error?: string }>,
  stop: () =>
    ipcRenderer.invoke('motors:stop') as Promise<{ ok: boolean; error?: string }>,
  onStatus: (handler: (status: { type: string; status: string; message: string }) => void) =>
    subscribe<{ type: string; status: string; message: string }>('motors:status', handler),
})
