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
