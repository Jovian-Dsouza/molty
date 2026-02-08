import { useState, useEffect, useCallback } from 'react'

const API_URL = import.meta.env.VITE_PREDICTION_API_URL ?? 'http://localhost:3999'

type Market = {
  id: string
  question: string
  asset: string
  direction: string
  targetPrice: number
  amount: string
  status: string
  outcome?: string
  finalPrice?: number
  expiresAt?: number
}

export function PredictionPanel() {
  const [markets, setMarkets] = useState<Market[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resolvingId, setResolvingId] = useState<string | null>(null)

  const fetchMarkets = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`${API_URL}/api/markets`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setMarkets(data.markets ?? [])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load markets')
      setMarkets([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchMarkets()
    const t = setInterval(fetchMarkets, 10000)
    return () => clearInterval(t)
  }, [fetchMarkets])

  const handleResolve = async (id: string) => {
    setResolvingId(id)
    try {
      const res = await fetch(`${API_URL}/api/markets/${id}/resolve`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      await fetchMarkets()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Resolve failed')
    } finally {
      setResolvingId(null)
    }
  }

  return (
    <section className="prediction-panel">
      <div className="hero-top">
        <div className="status-dot status-ready" />
        <div>
          <p className="eyebrow">Our market</p>
          <h2 className="prediction-title">Prediction Market</h2>
        </div>
      </div>
      <p className="sub">Create markets via script; resolve here with one click.</p>

      {loading && <p className="prediction-muted">Loading markets…</p>}
      {error && <p className="prediction-error">{error}</p>}

      {!loading && markets.length === 0 && !error && (
        <p className="prediction-muted">No markets yet. Run: <code>npm run create-market</code> in research/prediction-market</p>
      )}

      <ul className="market-list">
        {markets.map((m) => (
          <li key={m.id} className="market-card">
            <div className="market-question">{m.question}</div>
            <div className="market-meta">
              {m.asset} · {m.direction} · target ${m.targetPrice.toLocaleString()} · {(Number(m.amount) / 1e6).toFixed(2)} USDC
            </div>
            {m.status === 'resolved' ? (
              <div className="market-outcome">
                <span className={`outcome-badge outcome-${m.outcome?.toLowerCase()}`}>{m.outcome}</span>
                {m.finalPrice != null && <span>Final: ${m.finalPrice.toLocaleString()}</span>}
              </div>
            ) : (
              <button
                type="button"
                className="resolve-btn"
                onClick={() => handleResolve(m.id)}
                disabled={resolvingId !== null}
              >
                {resolvingId === m.id ? 'Resolving…' : 'Resolve'}
              </button>
            )}
          </li>
        ))}
      </ul>

      <button type="button" className="ghost" onClick={fetchMarkets}>
        Refresh
      </button>
    </section>
  )
}
