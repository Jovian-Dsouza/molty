import { useState } from "react"
import "./App.css"
import { MoltyFace } from "./components/MoltyFace.tsx"
import { useMoltyState } from "./hooks/useMoltyState.ts"
import { StatusHero } from "./components/StatusHero.tsx"
import { ConnectionPanel } from "./components/ConnectionPanel.tsx"
import { SendPanel } from "./components/SendPanel.tsx"
import { LogPanel } from "./components/LogPanel.tsx"
import { usePicoclaw } from "./hooks/usePicoclaw.ts"

function App() {
  const [showDebug, setShowDebug] = useState(false)
  const molty = useMoltyState()
  const debug = usePicoclaw()

  if (showDebug) {
    return (
      <div className="app">
        <button className="chip" onClick={() => setShowDebug(false)}>
          Back to Face
        </button>
        <StatusHero
          status={debug.status}
          isConnected={debug.isConnected}
          isConnecting={debug.isConnecting}
          onConnect={debug.handleConnect}
          onDisconnect={debug.handleDisconnect}
        />
        <ConnectionPanel
          status={debug.status}
          statusLabel={debug.statusLabel}
        />
        <SendPanel
          draft={debug.draft}
          isSending={debug.isSending}
          isConnected={debug.isConnected}
          onDraftChange={debug.setDraft}
          onReset={debug.resetDraft}
          onSend={debug.handleSend}
        />
        <LogPanel logs={debug.logs} onClear={debug.clearLogs} />
      </div>
    )
  }

  if (!molty.isConnected) {
    return (
      <div className="app-face" onDoubleClick={() => setShowDebug(true)}>
        <div className="connecting-screen">
          <div className="connecting-dot" />
          <p className="connecting-text">Connecting to picoclaw...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="app-face" onDoubleClick={() => setShowDebug(true)}>
      <MoltyFace
        expression={molty.face}
        isTalking={molty.isTalking}
        subtitle={molty.subtitle || undefined}
      />
    </div>
  )
}

export default App
