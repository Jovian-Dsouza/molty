#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════
 * STEP 1 — LI.FI Cross-Chain Swap
 * ═══════════════════════════════════════════════════════════════
 *
 * Swaps tokens cross-chain via LI.FI so the user's funds arrive
 * on the correct chain (Polygon / Arbitrum / Base) as USDC,
 * ready for deposit into the Yellow state channel.
 *
 * Flow:
 *   1. Fetch a cross-chain quote from LI.FI REST API
 *   2. Sign and broadcast the swap transaction via viem
 *   3. Poll LI.FI /status until the destination tx is confirmed
 *   4. Return the final USDC balance on the destination chain
 */
import { createWalletClient, createPublicClient, http, parseUnits, formatUnits } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { arbitrum, polygon, base, sepolia } from 'viem/chains';

// ─── Constants ────────────────────────────────────────────────
const LIFI_BASE_URL = 'https://li.quest/v1';

const CHAIN_MAP = {
  1:       { chain: undefined, name: 'Ethereum' },
  10:      { chain: undefined, name: 'Optimism' },
  137:     { chain: polygon,   name: 'Polygon' },
  42161:   { chain: arbitrum,  name: 'Arbitrum' },
  8453:    { chain: base,      name: 'Base' },
  11155111: { chain: sepolia,  name: 'Sepolia' },
};

// Common token addresses
const TOKENS = {
  USDC: {
    42161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // Arbitrum
    137:   '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359', // Polygon
    8453:  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // Base
  },
  DAI: {
    42161: '0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1', // Arbitrum
    137:   '0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063', // Polygon
  },
  USDT: {
    42161: '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // Arbitrum
    137:   '0xc2132D05D31c914a87C6611C10748AEb04B58e8F', // Polygon
  },
};

// ─── Helpers ──────────────────────────────────────────────────
function getHeaders(apiKey) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['x-lifi-api-key'] = apiKey;
  return headers;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Core Functions ───────────────────────────────────────────

/**
 * Fetch a cross-chain swap quote from LI.FI
 */
export async function getQuote({
  fromChainId,
  toChainId,
  fromToken,
  toToken,
  fromAmount,
  fromAddress,
  slippage = 0.03,
  apiKey,
}) {
  const params = new URLSearchParams({
    fromChain: fromChainId.toString(),
    toChain: toChainId.toString(),
    fromToken,
    toToken,
    fromAmount,
    fromAddress,
    slippage: slippage.toString(),
  });

  const url = `${LIFI_BASE_URL}/quote?${params}`;
  const res = await fetch(url, { headers: getHeaders(apiKey) });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(`LI.FI quote error ${res.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

/**
 * Execute the cross-chain swap on-chain
 */
export async function executeSwap(quote, privateKey, rpcUrl) {
  const txRequest = quote.transactionRequest;
  if (!txRequest) {
    throw new Error('Quote has no transactionRequest — cannot execute');
  }

  const chainId = Number(txRequest.chainId);
  const chainInfo = CHAIN_MAP[chainId];
  if (!chainInfo?.chain) {
    throw new Error(`Unsupported chain ID: ${chainId}`);
  }

  const account = privateKeyToAccount(privateKey);
  const walletClient = createWalletClient({
    chain: chainInfo.chain,
    transport: http(rpcUrl),
    account,
  });

  console.log(`  📤 Sending swap tx on ${chainInfo.name}...`);
  const hash = await walletClient.sendTransaction({
    to: txRequest.to,
    data: txRequest.data,
    value: txRequest.value ? BigInt(txRequest.value) : 0n,
    gasLimit: txRequest.gasLimit ? BigInt(txRequest.gasLimit) : undefined,
  });

  console.log(`  ✅ Tx sent: ${hash}`);
  return hash;
}

/**
 * Poll LI.FI /status endpoint until the transfer is complete
 */
export async function waitForCompletion(txHash, fromChainId, toChainId, apiKey, maxWaitMs = 300_000) {
  const startTime = Date.now();
  let attempt = 0;

  while (Date.now() - startTime < maxWaitMs) {
    attempt++;
    const params = new URLSearchParams({
      txHash,
      fromChain: fromChainId.toString(),
      toChain: toChainId.toString(),
    });

    const url = `${LIFI_BASE_URL}/status?${params}`;
    const res = await fetch(url, { headers: getHeaders(apiKey) });
    const data = await res.json();

    const status = data.status || 'UNKNOWN';
    console.log(`  🔄 [Attempt ${attempt}] Status: ${status}${data.substatus ? ` (${data.substatus})` : ''}`);

    if (status === 'DONE') {
      console.log(`  ✅ Cross-chain transfer complete!`);
      return data;
    }

    if (status === 'FAILED') {
      throw new Error(`Cross-chain transfer failed: ${JSON.stringify(data)}`);
    }

    // Exponential backoff: 3s, 6s, 12s, max 30s
    const waitTime = Math.min(3000 * Math.pow(2, attempt - 1), 30000);
    await sleep(waitTime);
  }

  throw new Error(`Cross-chain transfer timed out after ${maxWaitMs / 1000}s`);
}

/**
 * Full cross-chain funding pipeline
 *
 * @returns {{ quote, txHash, status, destinationAmount }}
 */
export async function crossChainFund({
  privateKey,
  fromChainId = 42161,   // Arbitrum
  toChainId = 137,        // Polygon
  fromToken = 'USDC',
  toToken = 'USDC',
  fromAmount,             // Raw amount string (e.g. '50000000' for 50 USDC)
  rpcUrl,
  apiKey,
  slippage = 0.03,
  dryRun = false,
}) {
  const pk = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  const account = privateKeyToAccount(pk);

  console.log('\n══════════════════════════════════════════════════');
  console.log('  STEP 1: LI.FI Cross-Chain Swap');
  console.log('══════════════════════════════════════════════════');
  console.log(`  Wallet:    ${account.address}`);
  console.log(`  From:      ${fromToken} on chain ${fromChainId}`);
  console.log(`  To:        ${toToken} on chain ${toChainId}`);
  console.log(`  Amount:    ${fromAmount}`);
  console.log('');

  // 1. Get quote
  console.log('  📊 Fetching cross-chain quote...');
  const quote = await getQuote({
    fromChainId,
    toChainId,
    fromToken,
    toToken,
    fromAmount,
    fromAddress: account.address,
    slippage,
    apiKey,
  });

  const estimatedOutput = quote.estimate?.toAmount || quote.toAmount;
  const estimatedOutputFormatted = estimatedOutput
    ? formatUnits(BigInt(estimatedOutput), quote.action?.toToken?.decimals || 6)
    : 'N/A';

  console.log(`  ✅ Quote received!`);
  console.log(`     Estimated output: ${estimatedOutputFormatted} ${toToken}`);
  console.log(`     Gas cost (USD):   ${quote.estimate?.gasCosts?.[0]?.amountUSD || 'N/A'}`);
  console.log(`     Tool used:        ${quote.tool || 'N/A'}`);
  console.log(`     Steps:            ${quote.includedSteps?.length || 1}`);

  if (dryRun) {
    console.log('\n  ⏸️  DRY RUN — skipping transaction execution');
    return {
      quote,
      txHash: null,
      status: 'DRY_RUN',
      destinationAmount: estimatedOutput,
    };
  }

  // 2. Execute swap
  console.log('\n  🔧 Executing cross-chain swap...');
  const txHash = await executeSwap(quote, pk, rpcUrl);

  // 3. Wait for completion
  console.log('\n  ⏳ Waiting for cross-chain completion...');
  const status = await waitForCompletion(txHash, fromChainId, toChainId, apiKey);

  const finalAmount = status.receiving?.amount || estimatedOutput;
  console.log(`\n  🏁 Final received: ${formatUnits(BigInt(finalAmount), 6)} ${toToken}`);

  return {
    quote,
    txHash,
    status,
    destinationAmount: finalAmount,
  };
}

// ─── Standalone execution ─────────────────────────────────────
if (process.argv[1]?.endsWith('1-lifi-crosschain.js')) {
  import('dotenv/config').then(async () => {
    try {
      const result = await crossChainFund({
        privateKey: process.env.PRIVATE_KEY,
        fromChainId: 42161,
        toChainId: 137,
        fromToken: 'USDC',
        toToken: 'USDC',
        fromAmount: process.env.PREDICTION_AMOUNT || '50000000',
        rpcUrl: process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc',
        apiKey: process.env.LIFI_API_KEY,
        dryRun: true, // Set to false for real execution
      });
      console.log('\n  ✅ Cross-chain funding result:', JSON.stringify(result, null, 2).slice(0, 500));
    } catch (err) {
      console.error('  ❌ Error:', err.message);
      process.exit(1);
    }
  });
}
