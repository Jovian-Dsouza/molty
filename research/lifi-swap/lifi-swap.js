#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════
 *  LI.FI — Real Swap on Base Mainnet
 * ═══════════════════════════════════════════════════════════════
 *
 *  Performs a REAL on-chain swap via LI.FI on Base mainnet:
 *    1. Check wallet balance
 *    2. Get swap quote (ETH → USDC on Base)
 *    3. Execute the swap transaction
 *    4. Poll status until complete
 *    5. Verify final balances
 *
 *  Usage: node lifi-swap.js
 *
 * ═══════════════════════════════════════════════════════════════
 */
import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  formatUnits,
  parseEther,
  encodeFunctionData,
} from 'viem';
import { base } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// ─── Config ───────────────────────────────────────────────────
const PRIVATE_KEY = '0xf801af3bdf7f4282d43d3ab70a0acea6df2b5d16528eb6680a923484149b02de';
const LIFI_API_KEY = '965d4d41-85ae-4e53-b997-08c174195693.b2f474c2-0223-42f3-b737-5c48ebb90723';
const LIFI_BASE = 'https://li.quest/v1';
const BASE_RPC = 'https://mainnet.base.org';

// Swap: tiny amount of ETH → USDC on Base (same-chain swap)
const SWAP_AMOUNT = '100000000000000'; // 0.0001 ETH (~$0.25) — keep it tiny
const FROM_TOKEN = '0x0000000000000000000000000000000000000000'; // Native ETH
const TO_TOKEN = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';   // USDC on Base
const CHAIN_ID = 8453; // Base

// USDC ABI for balance check
const ERC20_ABI = [{ inputs: [{ name: 'account', type: 'address' }], name: 'balanceOf', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' }];

// ─── Setup ────────────────────────────────────────────────────
const account = privateKeyToAccount(PRIVATE_KEY);
const publicClient = createPublicClient({ chain: base, transport: http(BASE_RPC) });
const walletClient = createWalletClient({ chain: base, transport: http(BASE_RPC), account });
const headers = { 'x-lifi-api-key': LIFI_API_KEY, 'Content-Type': 'application/json' };

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function hr(t) { console.log(`\n${'═'.repeat(60)}\n  ${t}\n${'═'.repeat(60)}`); }

// ─── Main ─────────────────────────────────────────────────────
async function main() {
  const t0 = Date.now();
  const elapsed = () => ((Date.now() - t0) / 1000).toFixed(1) + 's';

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║  LI.FI — Real Swap on Base Mainnet                        ║
╚═══════════════════════════════════════════════════════════╝
  Wallet: ${account.address}
  Chain:  Base (${CHAIN_ID})
  Swap:   ${formatEther(BigInt(SWAP_AMOUNT))} ETH → USDC
`);

  // ──────────────────────────────────────────────────────────
  // STEP 1: Check Balances
  // ──────────────────────────────────────────────────────────
  hr('STEP 1 — Check Wallet Balances');

  const ethBal = await publicClient.getBalance({ address: account.address });
  console.log(`  ETH:  ${formatEther(ethBal)} ETH`);

  let usdcBal;
  try {
    usdcBal = await publicClient.readContract({
      address: TO_TOKEN,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [account.address],
    });
    console.log(`  USDC: ${formatUnits(usdcBal, 6)} USDC`);
  } catch (_) {
    usdcBal = 0n;
    console.log(`  USDC: 0 USDC`);
  }

  if (ethBal < BigInt(SWAP_AMOUNT)) {
    console.error(`\n  ❌ Not enough ETH. Need ${formatEther(BigInt(SWAP_AMOUNT))}, have ${formatEther(ethBal)}`);
    process.exit(1);
  }
  console.log(`  ✅ Enough ETH for swap [${elapsed()}]`);

  // ──────────────────────────────────────────────────────────
  // STEP 2: Get LI.FI Quote
  // ──────────────────────────────────────────────────────────
  hr('STEP 2 — Get LI.FI Swap Quote');

  const quoteParams = new URLSearchParams({
    fromChain: CHAIN_ID.toString(),
    toChain: CHAIN_ID.toString(),
    fromToken: FROM_TOKEN,
    toToken: TO_TOKEN,
    fromAmount: SWAP_AMOUNT,
    fromAddress: account.address,
    slippage: '0.05',
  });

  console.log(`  📊 Requesting quote...`);
  console.log(`     ${formatEther(BigInt(SWAP_AMOUNT))} ETH → USDC on Base`);

  const quoteRes = await fetch(`${LIFI_BASE}/quote?${quoteParams}`, { headers });
  const quote = await quoteRes.json();

  if (!quoteRes.ok) {
    console.error(`  ❌ Quote error ${quoteRes.status}:`, JSON.stringify(quote).slice(0, 200));
    process.exit(1);
  }

  const estimatedOut = quote.estimate?.toAmount || quote.toAmount;
  const estimatedUSDC = estimatedOut ? formatUnits(BigInt(estimatedOut), 6) : '?';
  const gasCostUSD = quote.estimate?.gasCosts?.[0]?.amountUSD || '?';
  const tool = quote.tool || '?';
  const steps = quote.includedSteps?.length || 1;

  console.log(`  ✅ Quote received!`);
  console.log(`     Output:   ~${estimatedUSDC} USDC`);
  console.log(`     Gas cost: $${gasCostUSD}`);
  console.log(`     Tool:     ${tool}`);
  console.log(`     Steps:    ${steps}`);
  console.log(`  [${elapsed()}]`);

  if (!quote.transactionRequest) {
    console.error('  ❌ No transactionRequest in quote');
    process.exit(1);
  }

  // ──────────────────────────────────────────────────────────
  // STEP 3: Execute Swap Transaction
  // ──────────────────────────────────────────────────────────
  hr('STEP 3 — Execute Swap On-Chain');

  const tx = quote.transactionRequest;
  console.log(`  📤 Sending transaction...`);
  console.log(`     To:    ${tx.to}`);
  console.log(`     Value: ${formatEther(BigInt(tx.value || '0'))} ETH`);
  console.log(`     Data:  ${tx.data?.slice(0, 20)}...`);

  const hash = await walletClient.sendTransaction({
    to: tx.to,
    data: tx.data,
    value: BigInt(tx.value || '0'),
    gasLimit: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
  });

  console.log(`  ✅ Transaction sent!`);
  console.log(`     Hash: ${hash}`);
  console.log(`     Explorer: https://basescan.org/tx/${hash}`);
  console.log(`  [${elapsed()}]`);

  // ──────────────────────────────────────────────────────────
  // STEP 4: Wait for Confirmation
  // ──────────────────────────────────────────────────────────
  hr('STEP 4 — Wait for Confirmation');

  console.log(`  ⏳ Waiting for tx to be mined...`);
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  console.log(`  ✅ Transaction confirmed!`);
  console.log(`     Block:    ${receipt.blockNumber}`);
  console.log(`     Gas used: ${receipt.gasUsed.toString()}`);
  console.log(`     Status:   ${receipt.status === 'success' ? '✅ Success' : '❌ Reverted'}`);
  console.log(`  [${elapsed()}]`);

  if (receipt.status !== 'success') {
    console.error('  ❌ Transaction reverted!');
    process.exit(1);
  }

  // ──────────────────────────────────────────────────────────
  // STEP 5: Poll LI.FI Status
  // ──────────────────────────────────────────────────────────
  hr('STEP 5 — LI.FI Transfer Status');

  let attempt = 0;
  let statusResult = null;

  while (attempt < 10) {
    attempt++;
    await sleep(3000);

    try {
      const statusParams = new URLSearchParams({
        txHash: hash,
        fromChain: CHAIN_ID.toString(),
        toChain: CHAIN_ID.toString(),
      });
      const statusRes = await fetch(`${LIFI_BASE}/status?${statusParams}`, { headers });
      statusResult = await statusRes.json();
      const s = statusResult.status || 'PENDING';
      console.log(`  🔄 [${attempt}] Status: ${s}${statusResult.substatus ? ` (${statusResult.substatus})` : ''}`);

      if (s === 'DONE') {
        console.log(`  ✅ Transfer complete!`);
        break;
      }
      if (s === 'FAILED') {
        console.log(`  ❌ Transfer failed: ${JSON.stringify(statusResult).slice(0, 100)}`);
        break;
      }
    } catch (e) {
      console.log(`  ⚠️  Status check failed: ${e.message.slice(0, 50)}`);
    }
  }
  console.log(`  [${elapsed()}]`);

  // ──────────────────────────────────────────────────────────
  // STEP 6: Verify Final Balances
  // ──────────────────────────────────────────────────────────
  hr('STEP 6 — Final Balances');

  const finalEth = await publicClient.getBalance({ address: account.address });
  let finalUsdc = 0n;
  try {
    finalUsdc = await publicClient.readContract({
      address: TO_TOKEN,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [account.address],
    });
  } catch (_) {}

  const ethSpent = formatEther(ethBal - finalEth);
  const usdcGained = formatUnits(finalUsdc - usdcBal, 6);

  console.log(`  ETH:  ${formatEther(finalEth)} (spent ${ethSpent})`);
  console.log(`  USDC: ${formatUnits(finalUsdc, 6)} (gained ${usdcGained})`);

  // ──────────────────────────────────────────────────────────
  // DONE
  // ──────────────────────────────────────────────────────────
  const total = elapsed();
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                   SWAP COMPLETE                           ║
╠═══════════════════════════════════════════════════════════╣
║                                                           ║
║  Chain:      Base Mainnet                                 ║
║  Swap:       ${formatEther(BigInt(SWAP_AMOUNT)).padEnd(10)} ETH → ${formatUnits(finalUsdc - usdcBal, 6).padEnd(10)} USDC           ║
║  Tx hash:    ${hash.slice(0, 18)}...                      ║
║  Explorer:   basescan.org/tx/${hash.slice(0, 10)}...              ║
║  Gas used:   ${receipt.gasUsed.toString().padEnd(43)}║
║  Total time: ${total.padEnd(44)}║
║                                                           ║
╚═══════════════════════════════════════════════════════════╝
`);
}

// ─── Run ──────────────────────────────────────────────────────
main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error('\n  ❌ Error:', err.message);
    if (err.shortMessage) console.error('  Detail:', err.shortMessage);
    process.exit(1);
  });
