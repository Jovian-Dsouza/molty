import type { LogEntry } from '../hooks/useOpenClaw'

type LogPanelProps = {
  logs: LogEntry[]
  onClear: () => void
}

export function LogPanel({ logs, onClear }: LogPanelProps) {
  return (
    <section className="panel log">
      <div className="row row-head">
        <h2>Live Log</h2>
        <button className="ghost small" onClick={onClear}>
          Clear
        </button>
      </div>
      <div className="log-list">
        {logs.length === 0 ? (
          <div className="placeholder">No messages yet.</div>
        ) : (
          logs.map((entry) => (
            <div key={entry.id} className={`log-entry log-${entry.direction}`}>
              <span className="log-time">
                {new Date(entry.ts).toLocaleTimeString()}
              </span>
              <span className="log-dir">{entry.direction.toUpperCase()}</span>
              <span className="log-data">{entry.data}</span>
            </div>
          ))
        )}
      </div>
    </section>
  )
}
