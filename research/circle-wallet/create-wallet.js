#!/usr/bin/env node
/**
 * Create a Circle developer-controlled wallet
 * Run: node create-wallet.js  (requires CIRCLE_API_KEY in .env)
 */
import 'dotenv/config';
import crypto from 'crypto';
import {
  registerEntitySecretCiphertext,
  initiateDeveloperControlledWalletsClient,
} from '@circle-fin/developer-controlled-wallets';

let API_KEY = process.env.CIRCLE_API_KEY;
if (!API_KEY) {
  console.error('Missing CIRCLE_API_KEY in .env');
  process.exit(1);
}
// Circle expects 3 parts: ENV:ID:SECRET (e.g. TEST_API_KEY:xxx:yyy)
if (API_KEY.split(':').length === 2) {
  API_KEY = `TEST_API_KEY:${API_KEY}`;
  console.log('Note: Prefixed API key with TEST_API_KEY for testnet\n');
}

// Generate 32-byte hex entity secret (same format as Circle SDK)
function generateEntitySecret() {
  return crypto.randomBytes(32).toString('hex');
}

async function main() {
  console.log('🔵 Circle Developer Wallet Creation\n');

  // 1. Generate entity secret
  const entitySecret = generateEntitySecret();
  console.log('1. Generated entity secret (save this securely!)\n');

  // 2. Register entity secret with Circle
  console.log('2. Registering entity secret...');
  await registerEntitySecretCiphertext({
    apiKey: API_KEY,
    entitySecret,
  });
  console.log('   ✅ Entity secret registered\n');

  // 3. Initialize client
  const client = initiateDeveloperControlledWalletsClient({
    apiKey: API_KEY,
    entitySecret,
  });

  // 4. Create wallet set
  console.log('3. Creating wallet set...');
  const walletSetRes = await client.createWalletSet({
    name: 'Molty WalletSet',
  });
  const walletSetId = walletSetRes.data?.walletSet?.id;
  if (!walletSetId) {
    console.error('Failed to create wallet set:', walletSetRes);
    process.exit(1);
  }
  console.log('   ✅ Wallet set created:', walletSetId);

  // 5. Create wallet (SCA on Polygon Amoy testnet)
  console.log('\n4. Creating wallet...');
  const walletsRes = await client.createWallets({
    accountType: 'SCA',
    blockchains: ['MATIC-AMOY'],
    count: 1,
    walletSetId,
  });

  const wallets = walletsRes.data?.wallets;
  if (!wallets?.length) {
    console.error('Failed to create wallet:', walletsRes);
    process.exit(1);
  }

  const wallet = wallets[0];
  console.log('   ✅ Wallet created!\n');
  console.log('──────────────────────────────────────');
  console.log('Wallet ID:', wallet.id);
  console.log('Address:', wallet.address);
  console.log('Blockchain:', wallet.blockchain);
  console.log('Account Type:', wallet.accountType);
  console.log('State:', wallet.state);
  console.log('──────────────────────────────────────');
  console.log('\n⚠️  Save your entity secret securely! You need it for future API calls.');
  console.log('   Entity secret:', entitySecret);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
