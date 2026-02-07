#!/usr/bin/env node
/**
 * Request ytest.usd tokens from Yellow Network Sandbox Faucet
 * Run: node request-faucet.js
 */
import 'dotenv/config';
import { privateKeyToAccount } from 'viem/accounts';

const PRIVATE_KEY = process.env.PRIVATE_KEY;
if (!PRIVATE_KEY) {
  console.error('Missing PRIVATE_KEY in .env');
  process.exit(1);
}

const pk = PRIVATE_KEY.startsWith('0x') ? PRIVATE_KEY : `0x${PRIVATE_KEY}`;
const account = privateKeyToAccount(pk);

console.log('Wallet address:', account.address);
console.log('Requesting tokens from Yellow Sandbox Faucet...');

const res = await fetch('https://clearnet-sandbox.yellow.com/faucet/requestTokens', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ userAddress: account.address }),
});

const data = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error('Faucet error:', res.status, data);
  process.exit(1);
}
console.log('Faucet response:', JSON.stringify(data, null, 2));
console.log('Done. Tokens should land in your Unified Balance (Off-Chain).');
