#!/usr/bin/env node
/**
 * Withdraw USDC from Yellow Custody on Sepolia back to your wallet.
 * Use when the dashboard Withdraw button doesn't work.
 *
 * Reads PRIVATE_KEY from apps/backend/.env (use the wallet that has custody balance).
 *
 * Run:  cd apps/backend && node scripts/withdraw-from-custody.js
 *
 * Prints the transaction hash and explorer link — you can paste the tx in the dashboard
 * or it will appear under My Bets → Trades once confirmed.
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
} from 'viem';
import { sepolia } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendDir = path.join(__dirname, '..');
dotenv.config({ path: path.join(backendDir, '.env') });
process.chdir(backendDir);

const RPC_URL = process.env.RPC_URL || 'https://0xrpc.io/sep';
const CUSTODY_SEPOLIA = '0x6F71a38d919ad713D0AfE0eB712b95064Fc2616f';
const USDC_SEPOLIA = '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238';

const CUSTODY_ABI = [
  {
    inputs: [
      { name: 'accounts', type: 'address[]' },
      { name: 'tokens', type: 'address[]' },
    ],
    name: 'getAccountsBalances',
    outputs: [{ type: 'uint256[][]' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'withdraw',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
];

const ERC20_ABI = [
  {
    inputs: [{ name: 'account', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

async function main() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    console.error('\n  ❌ Set PRIVATE_KEY in apps/backend/.env\n');
    process.exit(1);
  }

  const pk = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey;
  const account = privateKeyToAccount(pk);
  const publicClient = createPublicClient({
    chain: sepolia,
    transport: http(RPC_URL),
  });
  const walletClient = createWalletClient({
    chain: sepolia,
    transport: http(RPC_URL),
    account,
  });

  console.log('\n  Withdraw from Yellow Custody (Sepolia)\n');
  console.log('  Wallet:', account.address);
  console.log('  Custody:', CUSTODY_SEPOLIA);
  console.log('  Token:  USDC', USDC_SEPOLIA);
  console.log('');

  const custodyBalances = await publicClient.readContract({
    address: CUSTODY_SEPOLIA,
    abi: CUSTODY_ABI,
    functionName: 'getAccountsBalances',
    args: [[account.address], [USDC_SEPOLIA]],
  });

  const amountInCustody = custodyBalances[0][0];
  console.log('  USDC in custody:', formatUnits(amountInCustody, 6));

  if (amountInCustody === 0n) {
    console.log('  Nothing to withdraw.\n');
    return;
  }

  const walletBefore = await publicClient.readContract({
    address: USDC_SEPOLIA,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });
  console.log('  USDC in wallet (before):', formatUnits(walletBefore, 6));
  console.log('');

  console.log('  Sending withdraw tx...');
  const hash = await walletClient.writeContract({
    address: CUSTODY_SEPOLIA,
    abi: CUSTODY_ABI,
    functionName: 'withdraw',
    args: [USDC_SEPOLIA, amountInCustody],
  });

  console.log('');
  console.log('  ✅ Transaction hash:', hash);
  console.log('  Explorer: https://sepolia.etherscan.io/tx/' + hash);
  console.log('  (This will appear under My Bets → Trades once confirmed.)');
  console.log('');

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log('  Confirmed in block', receipt.blockNumber);

  const walletAfter = await publicClient.readContract({
    address: USDC_SEPOLIA,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });
  console.log('  USDC in wallet (after):', formatUnits(walletAfter, 6));
  console.log('  Done.\n');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
