#!/usr/bin/env node
/**
 * Create one example prediction market and register it with the local API.
 * Run: npm run create-market
 * Or: node scripts/create-market.js
 *
 * Example: "Will ETH be above $3,500 by tomorrow?"
 */
import 'dotenv/config';
import { fetchCurrentPrice } from '../lib/price.js';
import { connectAndCreateMarket } from '../lib/yellow.js';
import { loadState, addMarket, saveState } from '../lib/store.js';

const QUESTION = process.env.MARKET_QUESTION || 'Will ETH be above $3,500 by end of day?';
const ASSET = process.env.MARKET_ASSET || 'ETHUSD';
const DIRECTION = process.env.MARKET_DIRECTION || 'LONG';
const AMOUNT = process.env.MARKET_AMOUNT || '1000000'; // 0.1 USDC (6 decimals)
const EXPIRY_SECONDS = parseInt(process.env.MARKET_EXPIRY_SECONDS || '86400', 10); // 24h

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('Set PRIVATE_KEY in .env');
    process.exit(1);
  }

  console.log('\n  Creating prediction market');
  console.log('  Question:', QUESTION);
  console.log('  Asset:', ASSET, '| Direction:', DIRECTION);
  console.log('  Amount:', Number(AMOUNT) / 1e6, 'USDC');
  console.log('  Expiry:', EXPIRY_SECONDS, 's\n');

  const priceData = await fetchCurrentPrice(ASSET);
  const currentPrice = priceData?.price ?? 3400;
  const targetPrice = DIRECTION === 'LONG' ? currentPrice * 1.02 : currentPrice * 0.98;
  console.log('  Current price:', currentPrice, '| Target:', targetPrice);

  const state = loadState();
  const result = await connectAndCreateMarket({
    privateKey,
    rpcUrl: process.env.RPC_URL || 'https://rpc.sepolia.org',
    wsUrl: process.env.YELLOW_WS_URL || 'wss://clearnet-sandbox.yellow.com/ws',
    sessionPrivateKey: state.sessionPrivateKey,
    question: QUESTION,
    asset: ASSET,
    direction: DIRECTION,
    targetPrice,
    amount: AMOUNT,
    expirySeconds: EXPIRY_SECONDS,
    odds: 2.0,
  });

  const market = addMarket(state, {
    id: `m_${Date.now()}`,
    question: QUESTION,
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

  console.log('\n  Market created:', market.id);
  console.log('  App session:', market.appSessionId?.slice(0, 20) + '...');
  console.log('  Resolve via: POST http://localhost:3999/api/markets/' + market.id + '/resolve');
  console.log('  Or use the Resolve button in the kiosk frontend.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
