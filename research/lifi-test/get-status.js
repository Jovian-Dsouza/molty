#!/usr/bin/env node
/**
 * LI.FI API - Check transfer status
 * Usage: node get-status.js <txHash> [bridge] [fromChain] [toChain]
 */
const BASE_URL = 'https://li.quest/v1';

const [txHash, bridge, fromChain, toChain] = process.argv.slice(2);
if (!txHash) {
  console.error('Usage: node get-status.js <txHash> [bridge] [fromChain] [toChain]');
  process.exit(1);
}

const params = new URLSearchParams({ txHash });
if (bridge) params.set('bridge', bridge);
if (fromChain) params.set('fromChain', fromChain);
if (toChain) params.set('toChain', toChain);

const url = `${BASE_URL}/status?${params}`;

fetch(url)
  .then((r) => r.json())
  .then((data) => {
    console.log('Status:', data.status || data);
    if (data.substatus) console.log('Substatus:', data.substatus);
  })
  .catch(console.error);
