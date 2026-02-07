import { useCallback, useEffect, useMemo, useState } from 'react'

export type LogEntry = {
  id: string
  direction: 'in' | 'out' | 'system'
  data: string
  ts: number
}

const MAX_LOGS = 40
const DEFAULT_PAYLOAD = '{\n  "type": "ping"\n}'

export function useOpenClaw() {
  const [status, setStatus] = useState<OpenClawStatusPayload>({ status: 'disconnected' })
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [draft, setDraft] = useState(DEFAULT_PAYLOAD)
  const [isSending, setIsSending] = useState(false)

  const isConnected = status.status === 'connected'
  const isConnecting = status.status === 'connecting'

  const addLog = useCallback((entry: Omit<LogEntry, 'id'>) => {
    setLogs((prev) => {
      const next = [
        ...prev,
        {
          id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
          ...entry,
        },
      ]
      return next.slice(-MAX_LOGS)
    })
  }, [])

  useEffect(() => {
    let offStatus = () => {}
    let offMessage = () => {}

    if (window.openclaw) {
      window.openclaw
        .getStatus()
        .then(setStatus)
        .catch(() => {
          addLog({
            direction: 'system',
            data: 'Unable to read gateway status',
            ts: Date.now(),
          })
        })

      offStatus = window.openclaw.onStatus((payload) => {
        setStatus(payload)
        addLog({
          direction: 'system',
          data: `Status: ${payload.status}${payload.error ? ` - ${payload.error}` : ''}`,
          ts: Date.now(),
        })
      })

      offMessage = window.openclaw.onMessage((payload) => {
        addLog({
          direction: payload.direction,
          data: payload.data,
          ts: payload.ts,
        })
      })
    } else {
      addLog({
        direction: 'system',
        data: 'OpenClaw bridge unavailable',
        ts: Date.now(),
      })
    }

    return () => {
      offStatus()
      offMessage()
    }
  }, [addLog])

  const statusLabel = useMemo(() => {
    if (status.status === 'connecting') return 'Connecting'
    if (status.status === 'connected') return 'Connected'
    if (status.status === 'error') return 'Error'
    return 'Disconnected'
  }, [status.status])

  const handleConnect = async () => {
    try {
      const payload = await window.openclaw.connect()
      setStatus(payload)
    } catch {
      addLog({
        direction: 'system',
        data: 'Failed to start connection',
        ts: Date.now(),
      })
    }
  }

  const handleDisconnect = async () => {
    try {
      const payload = await window.openclaw.disconnect()
      setStatus(payload)
    } catch {
      addLog({
        direction: 'system',
        data: 'Failed to disconnect',
        ts: Date.now(),
      })
    }
  }

  const handleSend = async () => {
    if (!draft.trim()) return
    setIsSending(true)

    let payload: unknown = draft
    try {
      payload = JSON.parse(draft)
    } catch {
      payload = draft
    }

    try {
      const result = await window.openclaw.send(payload)
      if (!result.ok) {
        addLog({
          direction: 'system',
          data: result.error ?? 'Failed to send message',
          ts: Date.now(),
        })
      }
    } catch {
      addLog({
        direction: 'system',
        data: 'Send failed',
        ts: Date.now(),
      })
    } finally {
      setIsSending(false)
    }
  }

  const resetDraft = () => setDraft(DEFAULT_PAYLOAD)
  const clearLogs = () => setLogs([])

  return {
    status,
    statusLabel,
    logs,
    draft,
    setDraft,
    isSending,
    isConnected,
    isConnecting,
    handleConnect,
    handleDisconnect,
    handleSend,
    resetDraft,
    clearLogs,
  }
}
