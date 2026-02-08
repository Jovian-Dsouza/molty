#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  Setup Yellow demo on Sepolia — create state channels & off-chain bets
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  Does:
 *    1. Auth with Yellow sandbox (Sepolia)
 *    2. Create 3 prediction markets (each = app session + off-chain bet)
 *    3. Write state.json so the backend + dashboard can list and resolve them
 *
 *  Prereqs:
 *    - .env with PRIVATE_KEY (wallet with Sepolia ETH for gas if needed)
 *    - CHAIN_ID=11155111, RPC_URL=https://rpc.sepolia.org, YELLOW_WS_URL=wss://clearnet-sandbox.yellow.com/ws
 *
 *  Run from backend dir:
 *    cd apps/backend && node scripts/setup-demo-base-sepolia.js
 *
 *  Then demo:
 *    1. Start backend: npm run dev  (in apps/backend)
 *    2. Start dashboard: npm run dev (in apps/dashboard)
 *    3. Open http://localhost:3000 → Markets
 *    4. You’ll see 3 open markets (off-chain bets). Resolve any with "By price" or "WIN" / "LOSS"
 * ═══════════════════════════════════════════════════════════════════════════
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.join(__dirname, '..');
dotenv.config({ path: path.join(backendDir, '.env') });

// Ensure state is written to backend dir even if cwd is elsewhere
process.chdir(backendDir);

import { fetchCurrentPrice } from '../lib/price.js';
import { connectAndCreateMarket } from '../lib/yellow.js';
import { loadState, addMarket } from '../lib/store.js';

const CHAIN_ID = 11155111;
const RPC_URL = process.env.RPC_URL || 'https://0xrpc.io/sep';
const WS_URL = process.env.YELLOW_WS_URL || 'wss://clearnet-sandbox.yellow.com/ws';
const AMOUNT = process.env.DEFAULT_AMOUNT || '5000000'; // 0.5 USDC (6 decimals) for visibility
const EXPIRY_SECONDS = 86400; // 24h

const MARKETS = [
  {
    question: 'Will ETH be above $3,500 by tomorrow?',
    asset: 'ETHUSD',
    direction: 'LONG',
    targetMultiplier: 1.02, // 2% above current
  },
  {
    question: 'Will ETH drop below $3,200 by tomorrow?',
    asset: 'ETHUSD',
    direction: 'SHORT',
    targetMultiplier: 0.98,
  },
  {
    question: 'Will BTC be above $95,000 by tomorrow?',
    asset: 'BTCUSD',
    direction: 'LONG',
    targetMultiplier: 1.02,
  },
];

function log(msg) {
  console.log(msg);
}

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    log('\n  ❌ Set PRIVATE_KEY in apps/backend/.env\n');
    process.exit(1);
  }

  log('\n  ═══════════════════════════════════════════════════════════');
  log('  Yellow demo setup — Sepolia');
  log('  ═══════════════════════════════════════════════════════════');
  log('  Chain: Sepolia (11155111)');
  log('  Yellow: sandbox (state channels + off-chain bets)');
  log('  Creating ' + MARKETS.length + ' markets…\n');

  let state = loadState();

  for (let i = 0; i < MARKETS.length; i++) {
    const m = MARKETS[i];
    log('  ─── Market ' + (i + 1) + ': ' + m.question);

    const priceData = await fetchCurrentPrice(m.asset);
    const current = priceData?.price ?? (m.asset === 'BTCUSD' ? 94000 : 3400);
    const targetPrice = m.direction === 'LONG' ? current * m.targetMultiplier : current * (2 - m.targetMultiplier);
    log('       Current ~' + Math.round(current) + ' → Target ' + (m.direction === 'LONG' ? '≥' : '≤') + ' $' + Math.round(targetPrice));

    try {
      const result = await connectAndCreateMarket({
        privateKey,
        rpcUrl: RPC_URL,
        wsUrl: WS_URL,
        chainId: CHAIN_ID,
        sessionPrivateKey: undefined, // new session per market
        question: m.question,
        asset: m.asset,
        direction: m.direction,
        targetPrice: Math.round(targetPrice * 100) / 100,
        amount: AMOUNT,
        expirySeconds: EXPIRY_SECONDS,
        odds: 2.0,
      });

      const market = addMarket(state, {
        id: `m_${Date.now()}_${i}`,
        question: m.question,
        asset: result.prediction.asset,
        direction: result.prediction.direction,
        targetPrice: result.prediction.targetPrice,
        amount: result.prediction.amount,
        status: 'open',
        expiresAt: result.prediction.expiresAt,
        appSessionId: result.appSessionId,
        allocations: result.allocations,
        prediction: result.prediction,
        sessionPrivateKey: result.sessionPrivateKey,
      });

      state = loadState();
      log('       ✅ Created ' + market.id + ' (app session + off-chain bet)\n');
    } catch (err) {
      log('       ❌ Failed: ' + err.message + '\n');
      throw err;
    }
  }

  log('  ═══════════════════════════════════════════════════════════');
  log('  HOW TO DEMO');
  log('  ═══════════════════════════════════════════════════════════');
  log('  1. Start backend:     cd apps/backend && npm run dev');
  log('  2. Start dashboard:  cd apps/dashboard && npm run dev');
  log('  3. Open:             http://localhost:3000');
  log('  4. Go to Markets — you’ll see ' + MARKETS.length + ' open markets (off-chain bets).');
  log('  5. Resolve any row:  click "By price" (uses live price) or "WIN" / "LOSS" (manual).');
  log('  6. Transactions tab: select chain "Sepolia" to see custody activity.');
  log('  ═══════════════════════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
