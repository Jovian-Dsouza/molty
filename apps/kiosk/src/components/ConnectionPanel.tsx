const GATEWAY_URL = import.meta.env.VITE_OPENCLAW_GATEWAY_URL || 'wss://molty.somehow.dev/'

type ConnectionPanelProps = {
  status: OpenClawStatusPayload
  statusLabel: string
}

export function ConnectionPanel({ status, statusLabel }: ConnectionPanelProps) {
  return (
    <section className="panel">
      <div className="row">
        <span className="label">Status</span>
        <span className={`pill pill-${status.status}`}>{statusLabel}</span>
      </div>
      {status.error ? <div className="error">{status.error}</div> : null}
      <div className="row">
        <span className="label">Gateway</span>
        <span className="value">{GATEWAY_URL}</span>
      </div>
      <div className="row">
        <span className="label">Auth</span>
        <span className="value">Token via env (not shown)</span>
      </div>
    </section>
  )
}
