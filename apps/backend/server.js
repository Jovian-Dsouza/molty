#!/usr/bin/env node
/**
 * Prediction Market API
 * - GET  /api/markets     → list markets
 * - POST /api/markets     → create market (Yellow app session + prediction state)
 * - POST /api/markets/:id/resolve → resolve by price (or optional ?outcome=WIN|LOSS)
 */
import 'dotenv/config';
import express from 'express';
import { connectAndCreateMarket, resolveMarket } from './lib/yellow.js';
import { fetchCurrentPrice } from './lib/price.js';
import { loadState, saveState, addMarket, updateMarket, getMarket } from './lib/store.js';

const PORT = parseInt(process.env.PORT || '3999', 10);
const app = express();
app.use(express.json());

// CORS for kiosk frontend
app.use((req, res, next) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// GET /api/markets
app.get('/api/markets', (req, res) => {
  try {
    const state = loadState();
    const markets = (state.markets || []).map((m) => ({
      id: m.id,
      question: m.question,
      asset: m.asset,
      direction: m.direction,
      targetPrice: m.targetPrice,
      amount: m.amount,
      status: m.status || 'open',
      outcome: m.outcome,
      finalPrice: m.finalPrice,
      expiresAt: m.expiresAt,
    }));
    res.json({ markets });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/markets — create market
app.post('/api/markets', async (req, res) => {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    return res.status(500).json({ error: 'PRIVATE_KEY not set' });
  }
  const state = loadState();
  const {
    question,
    asset = process.env.DEFAULT_ASSET || 'ETHUSD',
    direction = 'LONG',
    targetPrice: targetPriceParam,
    amount = process.env.DEFAULT_AMOUNT || '1000000',
    expirySeconds = 86400,
  } = req.body;

  let targetPrice = targetPriceParam;
  if (targetPrice == null) {
    const priceData = await fetchCurrentPrice(asset);
    targetPrice = priceData ? (direction === 'LONG' ? priceData.price * 1.02 : priceData.price * 0.98) : 3500;
  }

  try {
    const result = await connectAndCreateMarket({
      privateKey,
      rpcUrl: process.env.RPC_URL || 'https://rpc.sepolia.org',
      wsUrl: process.env.YELLOW_WS_URL || 'wss://clearnet-sandbox.yellow.com/ws',
      sessionPrivateKey: state.sessionPrivateKey,
      question: question || `Will ${asset} go ${direction === 'LONG' ? 'above' : 'below'} $${targetPrice}?`,
      asset,
      direction,
      targetPrice: Number(targetPrice),
      amount: String(amount),
      expirySeconds,
      odds: 2.0,
    });

    const market = addMarket(state, {
      id: `m_${Date.now()}`,
      question: question || `Will ${asset} go ${direction === 'LONG' ? 'above' : 'below'} $${targetPrice}?`,
      asset: result.prediction.asset,
      direction: result.prediction.direction,
      targetPrice: result.prediction.targetPrice,
      amount: result.prediction.amount,
      status: 'open',
      expiresAt: result.prediction.expiresAt,
      appSessionId: result.appSessionId,
      allocations: result.allocations,
      prediction: result.prediction,
    });

    if (result.sessionPrivateKey && !state.sessionPrivateKey) {
      saveState({ ...loadState(), sessionPrivateKey: result.sessionPrivateKey });
    }

    res.status(201).json({ market });
  } catch (err) {
    console.error('Create market error:', err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/markets/:id/resolve
app.post('/api/markets/:id/resolve', async (req, res) => {
  const privateKey = process.env.PRIVATE_KEY;
  const state = loadState();
  const sessionPrivateKey = state.sessionPrivateKey;
  if (!privateKey || !sessionPrivateKey) {
    return res.status(500).json({ error: 'PRIVATE_KEY or session key not set' });
  }

  const market = getMarket(state, req.params.id);
  if (!market) return res.status(404).json({ error: 'Market not found' });
  if (market.status === 'resolved') {
    return res.json({ market, message: 'Already resolved' });
  }

  const overrideOutcome = req.query.outcome || req.body?.outcome; // WIN | LOSS

  try {
    const result = await resolveMarket({
      privateKey,
      rpcUrl: process.env.RPC_URL || 'https://rpc.sepolia.org',
      wsUrl: process.env.YELLOW_WS_URL || 'wss://clearnet-sandbox.yellow.com/ws',
      sessionPrivateKey,
      appSessionId: market.appSessionId,
      allocations: market.allocations,
      prediction: market.prediction,
      overrideOutcome,
    });

    updateMarket(state, market.id, {
      status: 'resolved',
      outcome: result.outcome,
      finalPrice: result.finalPrice,
    });

    const updated = getMarket(loadState(), market.id);
    res.json({ market: updated, result: { outcome: result.outcome, finalPrice: result.finalPrice } });
  } catch (err) {
    console.error('Resolve error:', err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Prediction Market API http://localhost:${PORT}`);
  console.log(`  GET  /api/markets`);
  console.log(`  POST /api/markets (body: question, asset, direction, targetPrice?, amount?)`);
  console.log(`  POST /api/markets/:id/resolve (?outcome=WIN|LOSS optional)`);
});
