#!/usr/bin/env node
/**
 * LI.FI API - List supported chains
 */
const BASE_URL = 'https://li.quest/v1';

async function getChains() {
  const url = `${BASE_URL}/chains?chainTypes=EVM`;
  const res = await fetch(url);
  const data = await res.json();

  if (!res.ok) {
    console.error('Error:', res.status, data);
    process.exit(1);
  }

  console.log('🔗 LI.FI Supported Chains (EVM)\n');
  const chains = data.chains || data;
  (Array.isArray(chains) ? chains : Object.values(chains)).slice(0, 15).forEach((c) => {
    console.log(`  ${c.id}\t${c.key || c.name}\t${c.name}`);
  });
  console.log('  ...');
}

getChains().catch(console.error);
