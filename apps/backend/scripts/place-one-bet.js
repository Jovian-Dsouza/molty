#!/usr/bin/env node
/**
 * Place a single off-chain bet (create one prediction market) on Yellow Sepolia.
 * Reads PRIVATE_KEY from apps/backend/.env — do not put keys in this file.
 *
 * Run:  cd apps/backend && node scripts/place-one-bet.js
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.join(__dirname, '..');
dotenv.config({ path: path.join(backendDir, '.env') });
process.chdir(backendDir);

import { fetchCurrentPrice } from '../lib/price.js';
import { connectAndCreateMarket } from '../lib/yellow.js';
import { loadState, addMarket } from '../lib/store.js';

const CHAIN_ID = 11155111;
const RPC_URL = process.env.RPC_URL || 'https://0xrpc.io/sep';
const WS_URL = process.env.YELLOW_WS_URL || 'wss://clearnet-sandbox.yellow.com/ws';
const AMOUNT = process.env.DEFAULT_AMOUNT || '5000000'; // 0.5 USDC (6 decimals)
const EXPIRY_SECONDS = 86400;

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('\n  ❌ Set PRIVATE_KEY in apps/backend/.env (e.g. PRIVATE_KEY=0x...)\n');
    process.exit(1);
  }

  const pk = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey;
  console.log('\n  Placing one off-chain bet on Yellow (Sepolia)...\n');

  const priceData = await fetchCurrentPrice('ETHUSD');
  const current = priceData?.price ?? 3400;
  const targetPrice = Math.round((current * 1.02) * 100) / 100;
  const question = `Will ETH be above $${targetPrice} by tomorrow?`;

  console.log('  Question:', question);
  console.log('  Current ETH ~$' + current + ', target ≥ $' + targetPrice);
  console.log('  Amount:', Number(AMOUNT) / 1e6, 'USDC (6 decimals)\n');

  const state = loadState();
  const result = await connectAndCreateMarket({
    privateKey: pk,
    rpcUrl: RPC_URL,
    wsUrl: WS_URL,
    chainId: CHAIN_ID,
    sessionPrivateKey: undefined,
    question,
    asset: 'ETHUSD',
    direction: 'LONG',
    targetPrice,
    amount: AMOUNT,
    expirySeconds: EXPIRY_SECONDS,
    odds: 2.0,
  });

  const market = addMarket(state, {
    id: 'm_' + Date.now(),
    question,
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

  console.log('  ✅ Bet placed. Market id:', market.id);
  console.log('  App session:', String(market.appSessionId).slice(0, 24) + '...');
  console.log('\n  Resolve: start backend (npm run dev), open dashboard → Markets → Resolve this row.');
  console.log('  Or: curl -X POST "http://localhost:3999/api/markets/' + market.id + '/resolve"\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
