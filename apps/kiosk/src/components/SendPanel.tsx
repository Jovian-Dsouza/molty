type SendPanelProps = {
  draft: string
  isSending: boolean
  isConnected: boolean
  onDraftChange: (value: string) => void
  onReset: () => void
  onSend: () => void
}

export function SendPanel({ draft, isSending, isConnected, onDraftChange, onReset, onSend }: SendPanelProps) {
  return (
    <section className="panel">
      <div className="row row-head">
        <h2>Send</h2>
        <button className="chip" onClick={onReset}>
          Reset
        </button>
      </div>
      <textarea
        className="payload"
        value={draft}
        onChange={(event) => onDraftChange(event.target.value)}
        rows={5}
        spellCheck={false}
      />
      <button
        className="primary"
        onClick={onSend}
        disabled={!isConnected || isSending}
      >
        {isSending ? 'Sending...' : 'Send to Gateway'}
      </button>
    </section>
  )
}
