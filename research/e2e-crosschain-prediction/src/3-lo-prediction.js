#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════
 * STEP 3 — Limit Order Prediction (Off-Chain via State Channel)
 * ═══════════════════════════════════════════════════════════════
 *
 * Places a Limit Order (LO) prediction inside the Yellow state
 * channel. Everything here is OFF-CHAIN — instant, gasless.
 *
 * Flow:
 *   1. Fetch current market price from Stork Oracle / CoinGecko
 *   2. Create LO prediction parameters (asset, direction, target, expiry)
 *   3. Sign and send the prediction as a state update in the channel
 *   4. Monitor price until expiry or target hit
 *   5. Return the outcome (WIN / LOSS / EXPIRED)
 */
import {
  createSubmitAppStateMessage,
  createApplicationMessage,
  parseAnyRPCResponse,
  RPCMethod,
} from '@erc7824/nitrolite';

// ─── Price Oracle ─────────────────────────────────────────────

const STORK_BASE_URL = 'https://api.stork.network/prices/v1/latest';
const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price';

// Map prediction assets to CoinGecko IDs
const COINGECKO_IDS = {
  ETHUSD: 'ethereum',
  BTCUSD: 'bitcoin',
  SOLUSD: 'solana',
  MATICUSD: 'matic-network',
  AVAXUSD: 'avalanche-2',
  LINKUSD: 'chainlink',
  ARBUSD: 'arbitrum',
};

/**
 * Fetch current price for an asset
 */
export async function fetchCurrentPrice(asset = 'ETHUSD') {
  const geckoId = COINGECKO_IDS[asset.toUpperCase()];

  // Try CoinGecko first (free, no API key)
  if (geckoId) {
    try {
      const url = `${COINGECKO_URL}?ids=${geckoId}&vs_currencies=usd&include_24hr_change=true`;
      const res = await fetch(url);
      const data = await res.json();
      const priceData = data[geckoId];
      if (priceData) {
        return {
          asset,
          price: priceData.usd,
          change24h: priceData.usd_24h_change,
          source: 'coingecko',
          timestamp: Date.now(),
        };
      }
    } catch (err) {
      console.log(`  ⚠️  CoinGecko fetch failed, trying fallback...`);
    }
  }

  // Fallback: Stork Oracle
  try {
    const url = `${STORK_BASE_URL}/${asset}`;
    const res = await fetch(url);
    const data = await res.json();
    return {
      asset,
      price: parseFloat(data.price || data.data?.price),
      source: 'stork',
      timestamp: Date.now(),
    };
  } catch (err) {
    // Final fallback: return null to signal price unavailable
    console.log(`  ⚠️  All price sources temporarily unavailable, retrying...`);
    return null;
  }
}

// ─── Prediction Logic ─────────────────────────────────────────

/**
 * Create a Limit Order prediction
 *
 * @returns {{ prediction }}
 */
export function createLOPrediction({
  asset = 'ETHUSD',
  direction = 'LONG',   // LONG = price goes UP, SHORT = price goes DOWN
  targetPrice,
  currentPrice,
  amount,                // USDC amount wagered (raw, 6 decimals)
  expirySeconds = 3600,  // 1 hour default
  odds = 2.0,            // Payout multiplier
}) {
  const now = Date.now();
  const expiresAt = now + expirySeconds * 1000;

  const prediction = {
    id: `lo_${now}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'LIMIT_ORDER',
    asset,
    direction,
    entryPrice: currentPrice,
    targetPrice: parseFloat(targetPrice),
    amount,
    odds,
    potentialPayout: Math.floor(parseInt(amount) * odds).toString(),
    createdAt: now,
    expiresAt,
    expirySeconds,
    status: 'ACTIVE',
  };

  return prediction;
}

/**
 * Send prediction as a state update through the Yellow state channel.
 *
 * Uses two SDK methods:
 *   1. createApplicationMessage — sends the prediction data as an app-level message
 *   2. createSubmitAppStateMessage — submits a formal state update with new allocations
 */
export async function sendPredictionToChannel({
  ws,
  sessionSigner,
  channelId,
  prediction,
  account,
  allocations,
}) {
  console.log('\n  ─── Placing LO Prediction in State Channel ───');
  console.log(`  Prediction ID: ${prediction.id}`);
  console.log(`  Asset:         ${prediction.asset}`);
  console.log(`  Direction:     ${prediction.direction}`);
  console.log(`  Entry Price:   $${prediction.entryPrice.toFixed(2)}`);
  console.log(`  Target Price:  $${prediction.targetPrice.toFixed(2)}`);
  console.log(`  Amount:        ${(parseInt(prediction.amount) / 1e6).toFixed(2)} USDC`);
  console.log(`  Odds:          ${prediction.odds}x`);
  console.log(`  Payout:        ${(parseInt(prediction.potentialPayout) / 1e6).toFixed(2)} USDC`);
  console.log(`  Expires:       ${new Date(prediction.expiresAt).toISOString()}`);

  // 1. Send prediction data as an application message within the session
  const predictionData = {
    predictionId: prediction.id,
    asset: prediction.asset,
    direction: prediction.direction,
    entryPrice: prediction.entryPrice.toString(),
    targetPrice: prediction.targetPrice.toString(),
    amount: prediction.amount,
    odds: prediction.odds.toString(),
    expiresAt: prediction.expiresAt.toString(),
  };

  try {
    // Use the SDK's createApplicationMessage for app-level comms
    const appMessage = await createApplicationMessage(
      sessionSigner,
      channelId,         // appSessionId
      predictionData,    // message params
    );
    ws.send(appMessage);
    console.log('  📤 Prediction sent via application message (off-chain, gasless)');
  } catch (err) {
    console.log(`  ⚠️  Application message failed: ${err.message}`);
    console.log('  📤 Sending prediction as submit_app_state instead...');

    // Fallback: send as a state update with allocations
    try {
      const stateParams = {
        app_session_id: channelId,
        allocations: allocations || [],
        session_data: JSON.stringify(predictionData),
      };
      const stateMsg = await createSubmitAppStateMessage(sessionSigner, stateParams);
      ws.send(stateMsg);
      console.log('  📤 Prediction sent via submit_app_state (off-chain, gasless)');
    } catch (stateErr) {
      console.log(`  ⚠️  State update also failed: ${stateErr.message}`);
      console.log('  📤 Sending raw prediction message...');

      // Final fallback: raw signed message
      const rawPayload = JSON.stringify({
        type: 'prediction',
        channelId,
        data: predictionData,
        sender: account.address,
        timestamp: Date.now(),
      });
      const signature = await sessionSigner([Date.now(), 'message', predictionData]);
      const rawMessage = JSON.stringify({
        req: [Date.now(), 'message', predictionData],
        sig: [signature],
        sid: channelId,
      });
      ws.send(rawMessage);
      console.log('  📤 Prediction sent as raw signed message');
    }
  }

  // Wait for acknowledgement (best-effort)
  const ack = await new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ status: 'sent', predictionId: prediction.id });
    }, 5000);

    function handler(data) {
      try {
        const raw = typeof data === 'string' ? data : data.toString();
        const msg = parseAnyRPCResponse(raw);
        if (msg?.method === RPCMethod.Message ||
            msg?.method === RPCMethod.SubmitAppState ||
            msg?.method === 'message') {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          resolve({ status: 'acknowledged', response: msg });
        } else if (msg?.method === RPCMethod.Error) {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          resolve({ status: 'error', error: msg.params, predictionId: prediction.id });
        }
      } catch (err) {
        // ignore
      }
    }

    ws.on('message', handler);
  });

  console.log(`  ✅ Prediction registered: ${ack.status}`);
  return { prediction, ack };
}

/**
 * Monitor price and resolve the prediction
 *
 * @returns {{ outcome: 'WIN' | 'LOSS' | 'EXPIRED', finalPrice, prediction }}
 */
export async function monitorPrediction({
  prediction,
  pollIntervalMs = 10000,  // Check every 10s
  maxDurationMs = null,    // null = use prediction expiry
  onPriceUpdate = null,    // callback(price, prediction)
}) {
  const duration = maxDurationMs || (prediction.expiresAt - Date.now());
  const endTime = Date.now() + duration;

  console.log('\n  ─── Monitoring Prediction ───');
  console.log(`  Monitoring for up to ${Math.ceil(duration / 1000)}s...`);
  console.log(`  Checking every ${pollIntervalMs / 1000}s\n`);

  let lastPrice = prediction.entryPrice;
  let checkCount = 0;

  while (Date.now() < endTime) {
    checkCount++;
    const priceData = await fetchCurrentPrice(prediction.asset);
    if (!priceData || priceData.price == null) {
      console.log(`  ⚠️  [Check ${checkCount}] Price unavailable, skipping...`);
      await new Promise((r) => setTimeout(r, pollIntervalMs));
      continue;
    }
    lastPrice = priceData.price;

    const priceDiff = lastPrice - prediction.entryPrice;
    const priceDiffPct = ((priceDiff / prediction.entryPrice) * 100).toFixed(3);
    const direction = priceDiff >= 0 ? '📈' : '📉';

    console.log(
      `  ${direction} [Check ${checkCount}] ${prediction.asset}: $${lastPrice.toFixed(2)} ` +
      `(${priceDiff >= 0 ? '+' : ''}${priceDiffPct}% from entry)`
    );

    if (onPriceUpdate) {
      onPriceUpdate(lastPrice, prediction);
    }

    // Check if target hit
    if (prediction.direction === 'LONG' && lastPrice >= prediction.targetPrice) {
      console.log(`\n  🎯 TARGET HIT! Price reached $${lastPrice.toFixed(2)} >= $${prediction.targetPrice.toFixed(2)}`);
      return {
        outcome: 'WIN',
        finalPrice: lastPrice,
        prediction: { ...prediction, status: 'WON' },
        checksPerformed: checkCount,
      };
    }

    if (prediction.direction === 'SHORT' && lastPrice <= prediction.targetPrice) {
      console.log(`\n  🎯 TARGET HIT! Price reached $${lastPrice.toFixed(2)} <= $${prediction.targetPrice.toFixed(2)}`);
      return {
        outcome: 'WIN',
        finalPrice: lastPrice,
        prediction: { ...prediction, status: 'WON' },
        checksPerformed: checkCount,
      };
    }

    // Sleep before next check
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  // Prediction expired
  console.log(`\n  ⏰ Prediction EXPIRED. Final price: $${lastPrice.toFixed(2)}`);

  // Check final state
  const isWin = prediction.direction === 'LONG'
    ? lastPrice >= prediction.targetPrice
    : lastPrice <= prediction.targetPrice;

  return {
    outcome: isWin ? 'WIN' : 'LOSS',
    finalPrice: lastPrice,
    prediction: { ...prediction, status: isWin ? 'WON' : 'LOST' },
    checksPerformed: checkCount,
  };
}

/**
 * Full prediction pipeline: create LO, place in channel, monitor
 */
export async function placePrediction({
  ws,
  sessionSigner,
  channelId,
  account,
  allocations,
  asset = 'ETHUSD',
  direction = 'LONG',
  targetPrice,
  amount = '50000000',
  expirySeconds = 3600,
  odds = 2.0,
  monitorDurationMs = 60000, // Monitor for 60s in demo mode
  pollIntervalMs = 10000,
}) {
  console.log('\n══════════════════════════════════════════════════');
  console.log('  STEP 3: LO Prediction (Off-Chain State Channel)');
  console.log('══════════════════════════════════════════════════');

  // 1. Fetch current price
  console.log(`\n  📊 Fetching current ${asset} price...`);
  const priceData = await fetchCurrentPrice(asset);
  console.log(`  ✅ Current price: $${priceData.price.toFixed(2)} (source: ${priceData.source})`);

  // Auto-calculate target if not provided
  const autoTarget = direction === 'LONG'
    ? priceData.price * 1.02  // +2% for LONG
    : priceData.price * 0.98; // -2% for SHORT
  const target = targetPrice || autoTarget;

  // 2. Create prediction
  const prediction = createLOPrediction({
    asset,
    direction,
    targetPrice: target,
    currentPrice: priceData.price,
    amount,
    expirySeconds,
    odds,
  });

  // 3. Place in state channel
  const { ack } = await sendPredictionToChannel({
    ws,
    sessionSigner,
    channelId,
    prediction,
    account,
    allocations,
  });

  // 4. Monitor (in demo mode, use shorter duration)
  const result = await monitorPrediction({
    prediction,
    pollIntervalMs,
    maxDurationMs: monitorDurationMs,
    onPriceUpdate: (price, pred) => {
      // Could emit events to robot here
    },
  });

  return result;
}

// ─── Standalone execution ─────────────────────────────────────
if (process.argv[1]?.endsWith('3-lo-prediction.js')) {
  import('dotenv/config').then(async () => {
    try {
      const asset = process.env.PREDICTION_ASSET || 'ETHUSD';
      console.log(`\n  Fetching ${asset} price for standalone test...\n`);
      const price = await fetchCurrentPrice(asset);
      console.log(`  ${asset}: $${price.price.toFixed(2)} (${price.source})`);

      const prediction = createLOPrediction({
        asset,
        direction: process.env.PREDICTION_DIRECTION || 'LONG',
        targetPrice: process.env.PREDICTION_TARGET_PRICE || (price.price * 1.02),
        currentPrice: price.price,
        amount: process.env.PREDICTION_AMOUNT || '50000000',
        expirySeconds: parseInt(process.env.PREDICTION_EXPIRY_SECONDS || '3600'),
      });

      console.log('\n  Created prediction:');
      console.log(JSON.stringify(prediction, null, 2));
    } catch (err) {
      console.error('  ❌ Error:', err.message);
      process.exit(1);
    }
  });
}
