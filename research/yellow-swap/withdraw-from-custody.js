#!/usr/bin/env node
/**
 * Withdraw USDC from Yellow Custody contract (Base) back to wallet.
 * Run: node withdraw-from-custody.js
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  formatUnits,
} from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

const PRIVATE_KEY = '0xf801af3bdf7f4282d43d3ab70a0acea6df2b5d16528eb6680a923484149b02de';
const BASE_RPC = 'https://mainnet.base.org';
const CUSTODY_ADDRESS = '0x490fb189DdE3a01B00be9BA5F41e3447FbC838b6';
const USDC_ADDRESS = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

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

const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: base, transport: http(BASE_RPC) });
const walletClient = createWalletClient({ chain: base, transport: http(BASE_RPC), account });

async function main() {
  console.log('Wallet:', account.address);
  console.log('Custody:', CUSTODY_ADDRESS);
  console.log('');

  const custodyBalances = await publicClient.readContract({
    address: CUSTODY_ADDRESS,
    abi: CUSTODY_ABI,
    functionName: 'getAccountsBalances',
    args: [[account.address], [USDC_ADDRESS]],
  });

  const amountInCustody = custodyBalances[0][0];
  console.log('USDC in Custody:', formatUnits(amountInCustody, 6));

  if (amountInCustody === 0n) {
    console.log('Nothing to withdraw.');
    return;
  }

  const walletBefore = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });
  console.log('USDC in wallet (before):', formatUnits(walletBefore, 6));
  console.log('');

  console.log('Sending withdraw tx...');
  const hash = await walletClient.writeContract({
    address: CUSTODY_ADDRESS,
    abi: CUSTODY_ABI,
    functionName: 'withdraw',
    args: [USDC_ADDRESS, amountInCustody],
  });
  console.log('Tx:', hash);
  console.log('https://basescan.org/tx/' + hash);

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log('Confirmed in block', receipt.blockNumber);

  const walletAfter = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: 'balanceOf',
    args: [account.address],
  });
  console.log('');
  console.log('USDC in wallet (after):', formatUnits(walletAfter, 6));
  console.log('Done.');
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
