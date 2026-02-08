#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════════════
 *  MOLTY — End-to-End Cross-Chain Prediction Script
 * ═══════════════════════════════════════════════════════════════════════
 *
 *  Full pipeline:
 *    1. LI.FI  → Cross-chain swap (fund USDC on target chain)
 *    2. Yellow → Authenticate + open state channel
 *    3. LO     → Place limit order prediction (off-chain, gasless)
 *    4. Settle → Close channel + on-chain settlement
 *
 *  Usage:
 *    cp .env.example .env   # Fill in your keys
 *    npm install
 *    node main.js
 *
 *  Environment variables: see .env.example
 *
 * ═══════════════════════════════════════════════════════════════════════
 */
import 'dotenv/config';
import { crossChainFund } from './src/1-lifi-crosschain.js';
import { connectAndAuth, createPredictionChannel } from './src/2-yellow-channel.js';
import { placePrediction, fetchCurrentPrice } from './src/3-lo-prediction.js';
import { settleOnChain } from './src/4-settlement.js';

// ─── Config ───────────────────────────────────────────────────

const CONFIG = {
  // Wallet
  privateKey: process.env.PRIVATE_KEY,

  // LI.FI cross-chain
  lifi: {
    fromChainId: parseInt(process.env.LIFI_FROM_CHAIN || '42161'),  // Arbitrum
    toChainId: parseInt(process.env.LIFI_TO_CHAIN || '137'),        // Polygon
    fromToken: process.env.LIFI_FROM_TOKEN || 'USDC',
    toToken: process.env.LIFI_TO_TOKEN || 'USDC',
    fromAmount: process.env.PREDICTION_AMOUNT || '50000000',        // 50 USDC
    rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
    apiKey: process.env.LIFI_API_KEY || '',
    dryRun: process.env.LIFI_DRY_RUN !== 'false',                   // Default: dry run
  },

  // Yellow Network
  yellow: {
    wsUrl: process.env.YELLOW_WS_URL || 'wss://clearnet-sandbox.yellow.com/ws',
    faucetUrl: process.env.YELLOW_FAUCET_URL || 'https://clearnet-sandbox.yellow.com/faucet/requestTokens',
    rpcUrl: process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org',
    allowance: process.env.YELLOW_ALLOWANCE || '1000000000',
  },

  // Prediction
  prediction: {
    asset: process.env.PREDICTION_ASSET || 'ETHUSD',
    direction: process.env.PREDICTION_DIRECTION || 'LONG',
    targetPrice: process.env.PREDICTION_TARGET_PRICE ? parseFloat(process.env.PREDICTION_TARGET_PRICE) : null,
    amount: process.env.PREDICTION_AMOUNT || '50000000',
    expirySeconds: parseInt(process.env.PREDICTION_EXPIRY_SECONDS || '3600'),
    odds: parseFloat(process.env.PREDICTION_ODDS || '2.0'),
    // For demo: monitor for 60s instead of full expiry
    monitorDurationMs: parseInt(process.env.MONITOR_DURATION_MS || '60000'),
    pollIntervalMs: parseInt(process.env.POLL_INTERVAL_MS || '10000'),
  },

  // Settlement
  settlement: {
    chainId: parseInt(process.env.SETTLEMENT_CHAIN_ID || '11155111'), // Sepolia
    rpcUrl: process.env.SEPOLIA_RPC_URL || 'https://rpc.sepolia.org',
  },
};

// ─── Helpers ──────────────────────────────────────────────────

function printBanner() {
  console.log(`
  ╔═══════════════════════════════════════════════════════════════╗
  ║                                                               ║
  ║   🦞  MOLTY — Cross-Chain Prediction Pipeline                 ║
  ║                                                               ║
  ║   LI.FI Swap → Yellow Channel → LO Prediction → Settlement   ║
  ║                                                               ║
  ╚═══════════════════════════════════════════════════════════════╝
  `);
}

function printStepDivider(step, title) {
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`  STEP ${step}: ${title}`);
  console.log(`${'═'.repeat(60)}`);
}

function elapsed(start) {
  return ((Date.now() - start) / 1000).toFixed(1);
}

// ─── Main Pipeline ────────────────────────────────────────────

async function main() {
  const startTime = Date.now();
  printBanner();

  // Validate config
  if (!CONFIG.privateKey) {
    console.error('  ❌ Missing PRIVATE_KEY in .env file');
    console.error('     Copy .env.example to .env and fill in your private key');
    process.exit(1);
  }

  console.log('  Configuration:');
  console.log(`    Asset:       ${CONFIG.prediction.asset}`);
  console.log(`    Direction:   ${CONFIG.prediction.direction}`);
  console.log(`    Amount:      ${(parseInt(CONFIG.prediction.amount) / 1e6).toFixed(2)} USDC`);
  console.log(`    Target:      ${CONFIG.prediction.targetPrice || 'auto (entry + 2%)'}`);
  console.log(`    Expiry:      ${CONFIG.prediction.expirySeconds}s`);
  console.log(`    Monitor:     ${CONFIG.prediction.monitorDurationMs / 1000}s`);
  console.log(`    LI.FI:       ${CONFIG.lifi.dryRun ? 'DRY RUN' : 'LIVE'}`);
  console.log(`    ClearNet:    ${CONFIG.yellow.wsUrl}`);

  // ═══════════════════════════════════════════════════════════
  // STEP 1: Cross-Chain Swap via LI.FI
  // ═══════════════════════════════════════════════════════════
  printStepDivider(1, 'LI.FI Cross-Chain Swap');

  let crossChainResult;
  try {
    crossChainResult = await crossChainFund({
      privateKey: CONFIG.privateKey,
      fromChainId: CONFIG.lifi.fromChainId,
      toChainId: CONFIG.lifi.toChainId,
      fromToken: CONFIG.lifi.fromToken,
      toToken: CONFIG.lifi.toToken,
      fromAmount: CONFIG.lifi.fromAmount,
      rpcUrl: CONFIG.lifi.rpcUrl,
      apiKey: CONFIG.lifi.apiKey,
      dryRun: CONFIG.lifi.dryRun,
    });
    console.log(`\n  ✅ Step 1 complete [${elapsed(startTime)}s]`);
  } catch (err) {
    console.log(`\n  ⚠️  LI.FI swap failed/skipped: ${err.message}`);
    console.log('  Continuing with Yellow state channel...');
    crossChainResult = { status: 'skipped', reason: err.message };
  }

  // ═══════════════════════════════════════════════════════════
  // STEP 2: Yellow Network Auth + State Channel
  // ═══════════════════════════════════════════════════════════
  printStepDivider(2, 'Yellow Network — Auth & State Channel');

  const yellowCtx = await connectAndAuth({
    privateKey: CONFIG.privateKey,
    rpcUrl: CONFIG.yellow.rpcUrl,
    wsUrl: CONFIG.yellow.wsUrl,
    faucetUrl: CONFIG.yellow.faucetUrl,
    allowanceAmount: CONFIG.yellow.allowance,
  });

  const channel = await createPredictionChannel({
    ws: yellowCtx.ws,
    sessionSigner: yellowCtx.sessionSigner,
    account: yellowCtx.account,
    partnerAddress: yellowCtx.brokerAddress,
  });

  console.log(`\n  ✅ Step 2 complete [${elapsed(startTime)}s]`);
  console.log(`  Channel ID: ${channel.channelId}`);

  // ═══════════════════════════════════════════════════════════
  // STEP 3: LO Prediction (Off-Chain)
  // ═══════════════════════════════════════════════════════════
  printStepDivider(3, 'Limit Order Prediction (Off-Chain)');

  const predictionResult = await placePrediction({
    ws: yellowCtx.ws,
    sessionSigner: yellowCtx.sessionSigner,
    channelId: channel.channelId,
    account: yellowCtx.account,
    allocations: channel.allocations,
    asset: CONFIG.prediction.asset,
    direction: CONFIG.prediction.direction,
    targetPrice: CONFIG.prediction.targetPrice,
    amount: CONFIG.prediction.amount,
    expirySeconds: CONFIG.prediction.expirySeconds,
    odds: CONFIG.prediction.odds,
    monitorDurationMs: CONFIG.prediction.monitorDurationMs,
    pollIntervalMs: CONFIG.prediction.pollIntervalMs,
  });

  console.log(`\n  ✅ Step 3 complete [${elapsed(startTime)}s]`);
  console.log(`  Outcome: ${predictionResult.outcome}`);

  // ═══════════════════════════════════════════════════════════
  // STEP 4: On-Chain Settlement
  // ═══════════════════════════════════════════════════════════
  printStepDivider(4, 'On-Chain Settlement');

  const settlementResult = await settleOnChain({
    ws: yellowCtx.ws,
    sessionSigner: yellowCtx.sessionSigner,
    channelId: channel.channelId,
    appDefinition: channel.appDefinition,
    originalAllocations: channel.allocations,
    prediction: predictionResult.prediction,
    outcome: predictionResult.outcome,
    finalPrice: predictionResult.finalPrice,
    account: yellowCtx.account,
    rpcUrl: CONFIG.settlement.rpcUrl,
    chainId: CONFIG.settlement.chainId,
  });

  console.log(`\n  ✅ Step 4 complete [${elapsed(startTime)}s]`);

  // ═══════════════════════════════════════════════════════════
  // FINAL SUMMARY
  // ═══════════════════════════════════════════════════════════
  const totalTime = elapsed(startTime);

  console.log(`
  ╔═══════════════════════════════════════════════════════════════╗
  ║                    PIPELINE COMPLETE                          ║
  ╠═══════════════════════════════════════════════════════════════╣
  ║                                                               ║
  ║  Step 1 — LI.FI Cross-Chain:  ${(crossChainResult?.status || 'done').padEnd(32)}  ║
  ║  Step 2 — Yellow Channel:     ${channel.channelId.slice(0, 32).padEnd(32)}  ║
  ║  Step 3 — LO Prediction:      ${predictionResult.outcome.padEnd(32)}  ║
  ║  Step 4 — Settlement:         ${(settlementResult.settlement?.status || 'done').padEnd(32)}  ║
  ║                                                               ║
  ║  Asset:     ${CONFIG.prediction.asset.padEnd(47)}  ║
  ║  Direction: ${CONFIG.prediction.direction.padEnd(47)}  ║
  ║  P&L:       ${settlementResult.pnl.pnl.padEnd(47)}  ║
  ║  Total time: ${(totalTime + 's').padEnd(46)}  ║
  ║                                                               ║
  ║  ${predictionResult.outcome === 'WIN' ? '🎉 VICTORY! Molty dances!' : '💀 RIP Molty... falls off table'}${''.padEnd(predictionResult.outcome === 'WIN' ? 33 : 27)}  ║
  ║                                                               ║
  ╚═══════════════════════════════════════════════════════════════╝
  `);

  // Clean up
  yellowCtx.ws.close();
  return {
    crossChain: crossChainResult,
    channel,
    prediction: predictionResult,
    settlement: settlementResult,
    totalTimeSeconds: parseFloat(totalTime),
  };
}

// ─── Run ──────────────────────────────────────────────────────

main()
  .then((result) => {
    console.log('\n  Done. Exiting...');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n  ❌ Pipeline failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  });
