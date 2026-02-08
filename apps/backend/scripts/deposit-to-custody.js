#!/usr/bin/env node
/**
 * Deposit USDC into Yellow Custody on Sepolia.
 * This is the first step before off-chain betting.
 *
 * Uses PRIVATE_KEY from apps/backend/.env by default.
 * Pass --wallet-a to use WALLET_A_PRIVATE_KEY instead.
 *
 * Usage:
 *   cd apps/backend && node scripts/deposit-to-custody.js            # default wallet
 *   cd apps/backend && node scripts/deposit-to-custody.js --wallet-a # wallet A
 *   cd apps/backend && node scripts/deposit-to-custody.js 5          # deposit 5 USDC
 *   cd apps/backend && node scripts/deposit-to-custody.js --wallet-a 2  # wallet A, 2 USDC
 */
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
  parseUnits,
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
      { name: 'account', type: 'address' },
      { name: 'token', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'deposit',
    outputs: [],
    stateMutability: 'payable',
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
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'approve',
    outputs: [{ type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    name: 'allowance',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
];

async function main() {
  const args = process.argv.slice(2);
  const useWalletA = args.includes('--wallet-a');
  const amountArg = args.find(a => !a.startsWith('--') && !isNaN(Number(a)));

  const keyName = useWalletA ? 'WALLET_A_PRIVATE_KEY' : 'PRIVATE_KEY';
  const privateKey = process.env[keyName];
  if (!privateKey) {
    console.error(`\n  ❌ Set ${keyName} in apps/backend/.env\n`);
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

  console.log('\n  Deposit USDC into Yellow Custody (Sepolia)\n');
  console.log('  Wallet:', account.address, useWalletA ? '(Wallet A)' : '(default)');
  console.log('  Custody:', CUSTODY_SEPOLIA);
  console.log('  Token:  USDC', USDC_SEPOLIA);
  console.log('');

  // Check wallet USDC balance
  const usdcBal = await publicClient.readContract({
    address: USDC_SEPOLIA,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });
  console.log('  USDC in wallet:', formatUnits(usdcBal, 6));

  // Check current custody balance
  const custodyBalances = await publicClient.readContract({
    address: CUSTODY_SEPOLIA,
    abi: CUSTODY_ABI,
    functionName: 'getAccountsBalances',
    args: [[account.address], [USDC_SEPOLIA]],
  });
  const currentCustody = custodyBalances[0][0];
  console.log('  USDC in custody:', formatUnits(currentCustody, 6));

  // Determine deposit amount — default: deposit all wallet USDC, or use arg
  const depositAmount = amountArg ? parseUnits(amountArg, 6) : usdcBal;

  if (depositAmount === 0n) {
    console.log('\n  Nothing to deposit (0 USDC in wallet).\n');
    return;
  }
  if (depositAmount > usdcBal) {
    console.error(`\n  ❌ Not enough USDC. Want ${formatUnits(depositAmount, 6)}, have ${formatUnits(usdcBal, 6)}\n`);
    process.exit(1);
  }

  console.log(`\n  Depositing ${formatUnits(depositAmount, 6)} USDC...\n`);

  // Check allowance
  const allowance = await publicClient.readContract({
    address: USDC_SEPOLIA,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [account.address, CUSTODY_SEPOLIA],
  });

  if (allowance < depositAmount) {
    console.log('  Approving USDC spend...');
    const approveHash = await walletClient.writeContract({
      address: USDC_SEPOLIA,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [CUSTODY_SEPOLIA, depositAmount],
    });
    console.log('  Approve tx:', approveHash);
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
    console.log('  ✅ Approved\n');
  }

  // Deposit
  const hash = await walletClient.writeContract({
    address: CUSTODY_SEPOLIA,
    abi: CUSTODY_ABI,
    functionName: 'deposit',
    args: [account.address, USDC_SEPOLIA, depositAmount],
  });

  console.log('  ✅ Deposit tx:', hash);
  console.log('  Explorer: https://sepolia.etherscan.io/tx/' + hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log('  Confirmed in block', receipt.blockNumber);

  // Final custody balance
  const newCustody = await publicClient.readContract({
    address: CUSTODY_SEPOLIA,
    abi: CUSTODY_ABI,
    functionName: 'getAccountsBalances',
    args: [[account.address], [USDC_SEPOLIA]],
  });
  console.log('  Custody balance now:', formatUnits(newCustody[0][0], 6), 'USDC');
  console.log('  Done.\n');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
