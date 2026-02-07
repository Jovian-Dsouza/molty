type StatusHeroProps = {
  status: OpenClawStatusPayload
  isConnected: boolean
  isConnecting: boolean
  onConnect: () => void
  onDisconnect: () => void
}

export function StatusHero({ status, isConnected, isConnecting, onConnect, onDisconnect }: StatusHeroProps) {
  return (
    <header className="hero">
      <div className="hero-top">
        <div className={`status-dot status-${status.status}`} />
        <div>
          <p className="eyebrow">Molty Kiosk</p>
          <h1>OpenClaw Gateway</h1>
        </div>
      </div>
      <p className="sub">Secure WebSocket link to the agent brain.</p>
      <div className="actions">
        <button
          className="primary"
          onClick={onConnect}
          disabled={isConnecting || isConnected}
        >
          {isConnected ? 'Connected' : isConnecting ? 'Connecting...' : 'Connect'}
        </button>
        <button
          className="ghost"
          onClick={onDisconnect}
          disabled={status.status === 'disconnected'}
        >
          Disconnect
        </button>
      </div>
    </header>
  )
}
