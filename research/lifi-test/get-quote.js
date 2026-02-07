#!/usr/bin/env node
/**
 * LI.FI API - Get a cross-chain quote
 * Run: node get-quote.js
 * No API key required (optional for higher rate limits)
 */
const BASE_URL = 'https://li.quest/v1';

// Example: DAI on Arbitrum -> USDC on Polygon (Molty funding flow)
const params = {
  fromChain: 42161,        // Arbitrum
  toChain: 137,            // Polygon
  fromToken: 'DAI',
  toToken: 'USDC',
  fromAmount: '50000000000000000000',  // 50 DAI (18 decimals)
  fromAddress: '0x0bde6B99a4AcDF900BbF7E85b79195bF2e0D80B3',
  slippage: 0.03,
};

async function getQuote() {
  const searchParams = new URLSearchParams(params);
  const url = `${BASE_URL}/quote?${searchParams}`;

  console.log('🔗 LI.FI Quote Request');
  console.log('─────────────────────');
  console.log('From: 50 DAI on Arbitrum');
  console.log('To:   USDC on Polygon');
  console.log('Address:', params.fromAddress);
  console.log('');

  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) {
    console.error('Error:', res.status, data);
    process.exit(1);
  }

  console.log('✅ Quote received!\n');
  console.log('Estimated output:', data.toAmount ? (Number(data.toAmount) / 1e6).toFixed(2) : 'N/A', 'USDC');
  console.log('Gas cost (USD):', data.gasCosts?.[0]?.amountUSD || 'N/A');
  console.log('Steps:', data.actions?.length || 0);
  console.log('');
  console.log('Transaction ready:', !!data.transactionRequest);
  if (data.transactionRequest) {
    console.log('  - Chain:', data.transactionRequest.chainId);
    console.log('  - To:', data.transactionRequest.to?.slice(0, 20) + '...');
  }
  console.log('');
  console.log('Full quote (truncated):', JSON.stringify(data, null, 2).slice(0, 500) + '...');
}

getQuote().catch((err) => {
  console.error(err);
  process.exit(1);
});
