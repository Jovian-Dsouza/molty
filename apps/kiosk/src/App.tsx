import './App.css'
import { StatusHero } from './components/StatusHero'
import { ConnectionPanel } from './components/ConnectionPanel'
import { SendPanel } from './components/SendPanel'
import { LogPanel } from './components/LogPanel'
import { useOpenClaw } from './hooks/useOpenClaw'

function App() {
  const {
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
  } = useOpenClaw()

  return (
    <div className="app">
      <StatusHero
        status={status}
        isConnected={isConnected}
        isConnecting={isConnecting}
        onConnect={handleConnect}
        onDisconnect={handleDisconnect}
      />

      <ConnectionPanel status={status} statusLabel={statusLabel} />

      <SendPanel
        draft={draft}
        isSending={isSending}
        isConnected={isConnected}
        onDraftChange={setDraft}
        onReset={resetDraft}
        onSend={handleSend}
      />

      <LogPanel logs={logs} onClear={clearLogs} />

      <footer className="hint">
        Set <code>OPENCLAW_GATEWAY_TOKEN</code> and optional{' '}
        <code>VITE_OPENCLAW_GATEWAY_URL</code> before launching.
      </footer>
    </div>
  )
}

export default App
