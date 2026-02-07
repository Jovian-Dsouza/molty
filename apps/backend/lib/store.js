/**
 * Simple file-backed store for markets and session key.
 * state.json: { sessionPrivateKey?, markets: [...] }
 */
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function getStatePath() {
  return process.env.STATE_FILE || join(process.cwd(), 'state.json');
}

export function loadState() {
  const path = getStatePath();
  if (!existsSync(path)) {
    return { markets: [] };
  }
  try {
    const raw = readFileSync(path, 'utf8');
    const data = JSON.parse(raw);
    return { markets: data.markets || [], sessionPrivateKey: data.sessionPrivateKey || null };
  } catch (err) {
    return { markets: [] };
  }
}

export function saveState(state) {
  const path = getStatePath();
  const toWrite = {
    markets: state.markets,
    ...(state.sessionPrivateKey ? { sessionPrivateKey: state.sessionPrivateKey } : {}),
  };
  writeFileSync(path, JSON.stringify(toWrite, null, 2), 'utf8');
}

export function addMarket(state, market) {
  const markets = [...(state.markets || []), { ...market, id: market.id || `m_${Date.now()}` }];
  saveState({ ...state, markets });
  return markets[markets.length - 1];
}

export function updateMarket(state, marketId, updates) {
  const markets = (state.markets || []).map((m) =>
    m.id === marketId ? { ...m, ...updates } : m
  );
  saveState({ ...state, markets });
  return markets.find((m) => m.id === marketId);
}

export function getMarket(state, marketId) {
  return (state.markets || []).find((m) => m.id === marketId);
}
