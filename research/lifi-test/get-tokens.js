#!/usr/bin/env node
/**
 * LI.FI API - List tokens for chains
 * Usage: node get-tokens.js [chainIds]  e.g. node get-tokens.js 1,137,42161
 */
const BASE_URL = 'https://li.quest/v1';
const chains = process.argv[2] || '1,137,42161';  // Ethereum, Polygon, Arbitrum

async function getTokens() {
  const url = `${BASE_URL}/tokens?chains=${chains}`;
  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) {
    console.error('Error:', res.status, data);
    process.exit(1);
  }

  console.log('🔗 LI.FI Tokens for chains', chains, '\n');
  const tokens = data.tokens || data;
  const entries = typeof tokens === 'object' && !Array.isArray(tokens)
    ? Object.entries(tokens)
    : [['all', tokens]];

  for (const [chainId, list] of entries) {
    console.log(`Chain ${chainId}:`);
    (list || []).slice(0, 5).forEach((t) => {
      console.log(`  - ${t.symbol} (${t.address?.slice(0, 10)}...)`);
    });
    console.log('');
  }
}

getTokens().catch(console.error);
