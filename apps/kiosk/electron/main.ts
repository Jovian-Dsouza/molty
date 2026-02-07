import { app, BrowserWindow, ipcMain } from 'electron'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

// Load .env into the Electron main process (Vite only injects VITE_* into the renderer)
try {
  const envPath = path.join(process.env.APP_ROOT, '.env')
  const envFile = readFileSync(envPath, 'utf-8')
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim()
    if (!process.env[key]) {
      process.env[key] = value
    }
  }
} catch {
  // .env file may not exist; that's fine
}
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

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

type WebSocketLike = {
  send: (data: string | ArrayBuffer | Buffer) => void
  close: () => void
  addEventListener?: (event: string, handler: (...args: any[]) => void) => void
  on?: (event: string, handler: (...args: any[]) => void) => void
}

const OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL ?? 'wss://molty.somehow.dev/'
const OPENCLAW_GATEWAY_TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN

let ws: WebSocketLike | null = null
let wsStatus: OpenClawStatus = 'disconnected'
let wsError: string | null = null

let win: BrowserWindow | null

function normalizeGatewayUrl(rawUrl: string) {
  if (rawUrl.startsWith('https://')) return `wss://${rawUrl.slice(8)}`
  if (rawUrl.startsWith('http://')) return `ws://${rawUrl.slice(7)}`
  return rawUrl
}

function buildGatewayUrl(): string | null {
  if (!OPENCLAW_GATEWAY_TOKEN) return null
  const url = new URL(normalizeGatewayUrl(OPENCLAW_GATEWAY_URL))
  url.searchParams.set('token', OPENCLAW_GATEWAY_TOKEN)
  return url.toString()
}

function getStatusPayload(): OpenClawStatusPayload {
  return { status: wsStatus, error: wsError }
}

function broadcastStatus() {
  const payload = getStatusPayload()
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('openclaw:status', payload)
  }
}

function broadcastMessage(direction: OpenClawMessagePayload['direction'], data: string) {
  const payload: OpenClawMessagePayload = {
    direction,
    data,
    ts: Date.now(),
  }
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send('openclaw:message', payload)
  }
}

function setStatus(next: OpenClawStatus, error: string | null = null) {
  wsStatus = next
  wsError = error
  broadcastStatus()
}

function toText(data: unknown) {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8')
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer).toString('utf8')
  if (Buffer.isBuffer(data)) return data.toString('utf8')
  try {
    return JSON.stringify(data)
  } catch {
    return String(data)
  }
}

function attachSocketHandlers(socket: WebSocketLike) {
  const handleOpen = () => {
    setStatus('connected')
    broadcastMessage('system', 'Gateway connected')
  }

  const handleClose = () => {
    ws = null
    if (wsStatus !== 'error') {
      setStatus('disconnected')
    }
    broadcastMessage('system', 'Gateway disconnected')
  }

  const handleError = () => {
    setStatus('error', 'Gateway connection failed')
    broadcastMessage('system', 'Gateway error')
  }

  const handleMessage = (eventOrData: any) => {
    const data = eventOrData?.data ?? eventOrData
    broadcastMessage('in', toText(data))
  }

  if (typeof socket.addEventListener === 'function') {
    socket.addEventListener('open', handleOpen)
    socket.addEventListener('message', handleMessage)
    socket.addEventListener('close', handleClose)
    socket.addEventListener('error', handleError)
    return
  }

  if (typeof socket.on === 'function') {
    socket.on('open', handleOpen)
    socket.on('message', handleMessage)
    socket.on('close', handleClose)
    socket.on('error', handleError)
  }
}

function connectGateway(): OpenClawStatusPayload {
  if (wsStatus === 'connected' || wsStatus === 'connecting') {
    return getStatusPayload()
  }

  const url = buildGatewayUrl()
  if (!url) {
    setStatus('error', 'Missing OPENCLAW_GATEWAY_TOKEN')
    return getStatusPayload()
  }

  const WebSocketCtor = (globalThis as any).WebSocket as (new (url: string) => WebSocketLike) | undefined
  if (!WebSocketCtor) {
    setStatus('error', 'WebSocket not available in main process')
    return getStatusPayload()
  }

  setStatus('connecting')
  try {
    ws = new WebSocketCtor(url)
    attachSocketHandlers(ws)
    broadcastMessage('system', 'Connecting to OpenClaw gateway...')
  } catch {
    setStatus('error', 'Failed to start connection')
  }

  return getStatusPayload()
}

function disconnectGateway(): OpenClawStatusPayload {
  if (ws) {
    try {
      ws.close()
    } catch {
      // best-effort close
    }
    ws = null
  }

  if (wsStatus !== 'disconnected') {
    setStatus('disconnected')
  }

  return getStatusPayload()
}

function sendGateway(payload: unknown): { ok: boolean; error?: string } {
  if (!ws || wsStatus !== 'connected') {
    return { ok: false, error: 'Gateway not connected' }
  }

  const data = typeof payload === 'string' ? payload : JSON.stringify(payload)
  try {
    ws.send(data)
    broadcastMessage('out', data)
    return { ok: true }
  } catch {
    return { ok: false, error: 'Failed to send message' }
  }
}

function createWindow() {
  const isKiosk = process.argv.includes('--kiosk') || process.env.KIOSK === 'true'

  win = new BrowserWindow({
    width: 320,
    height: 480,
    kiosk: isKiosk,
    alwaysOnTop: isKiosk,
    frame: !isKiosk,
    resizable: false,
    title: 'kiosk',
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  if (isKiosk) {
    win.setMenu(null)
  }

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }

  win.webContents.once('did-finish-load', () => {
    win?.webContents.send('openclaw:status', getStatusPayload())
  })
}

ipcMain.handle('openclaw:connect', () => connectGateway())
ipcMain.handle('openclaw:disconnect', () => disconnectGateway())
ipcMain.handle('openclaw:get-status', () => getStatusPayload())
ipcMain.handle('openclaw:send', (_event, payload) => sendGateway(payload))

app.on('before-quit', () => disconnectGateway())

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})

app.whenReady().then(() => createWindow())
