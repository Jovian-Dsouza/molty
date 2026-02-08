/**
 * Molty Arc — Autonomous Treasury Management on Arc Network
 *
 * Manages a USDC treasury on Arc, earns yield via USYC (US Treasury-backed),
 * sends USDC payments, and auto-rebalances based on Stork oracle signals.
 *
 * Environment variables:
 *   PRIVATE_KEY    — Wallet private key (required)
 *   STORK_API_KEY  — Stork API key (required for autoRebalance)
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  formatUnits,
  parseUnits,
  defineChain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// ─── Arc Testnet Chain Definition ────────────────────────────

const arcTestnet = defineChain({
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: {
    name: "USDC",
    symbol: "USDC",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: ["https://rpc.testnet.arc.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "ArcScan",
      url: "https://testnet.arcscan.app",
    },
  },
});

const ARC_RPC_URL = "https://rpc.testnet.arc.network";
const ARC_EXPLORER_URL = "https://testnet.arcscan.app";

// ─── Contract Addresses (Arc Testnet) ────────────────────────

/** USDC ERC-20 interface on Arc (6 decimals) */
const USDC_ADDRESS = "0x3600000000000000000000000000000000000000" as const;

/** USYC token — tokenized US Treasury money market fund (6 decimals) */
const USYC_ADDRESS = "0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C" as const;

/** USYC Teller — deposit USDC to get USYC, redeem USYC to get USDC */
const USYC_TELLER_ADDRESS = "0x9fdF14c5B14173D74C08Af27AebFf39240dC105A" as const;

// ─── ABIs ────────────────────────────────────────────────────

const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "transfer",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

const TELLER_ABI = [
  {
    inputs: [
      { name: "_assets", type: "uint256" },
      { name: "_receiver", type: "address" },
    ],
    name: "deposit",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "_shares", type: "uint256" },
      { name: "_receiver", type: "address" },
      { name: "_account", type: "address" },
    ],
    name: "redeem",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

// ─── Types ───────────────────────────────────────────────────

interface ArcBalance {
  address: string;
  usdcBalance: string;
  usycBalance: string;
  explorerUrl: string;
}

interface SendResult {
  txHash: string;
  recipient: string;
  amount: string;
  explorerUrl: string;
}

interface YieldPosition {
  usycBalance: string;
  estimatedAPY: string;
  estimatedDailyYield: string;
  estimatedMonthlyYield: string;
}

interface DepositResult {
  txHash: string;
  usdcDeposited: string;
  explorerUrl: string;
}

interface WithdrawResult {
  txHash: string;
  usycRedeemed: string;
  explorerUrl: string;
}

interface TreasuryStatus {
  address: string;
  usdcBalance: string;
  usycBalance: string;
  totalValueUSDC: string;
  usdcAllocationPct: string;
  usycAllocationPct: string;
  estimatedAPY: string;
  estimatedMonthlyYield: string;
  explorerUrl: string;
}

interface RebalanceResult {
  marketSignal: string;
  priceData: Array<{ asset: string; price: number }>;
  previousAllocation: { usdcPct: string; usycPct: string };
  targetAllocation: { usdcPct: string; usycPct: string };
  action: string;
  txHash?: string;
  explorerUrl?: string;
  explanation: string;
}

// ─── Helpers ─────────────────────────────────────────────────

function getAccount() {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY is not configured. Arc wallet is unavailable.");
  }
  const pk = (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as `0x${string}`;
  return privateKeyToAccount(pk);
}

function getPublicClient() {
  return createPublicClient({
    chain: arcTestnet,
    transport: http(ARC_RPC_URL),
  });
}

function getWalletClient() {
  const account = getAccount();
  return createWalletClient({
    chain: arcTestnet,
    transport: http(ARC_RPC_URL),
    account,
  });
}

function explorerTx(txHash: string): string {
  return `${ARC_EXPLORER_URL}/tx/${txHash}`;
}

function explorerAddress(address: string): string {
  return `${ARC_EXPLORER_URL}/address/${address}`;
}

// Estimated US Treasury yield — overnight federal funds rate
const ESTIMATED_APY = 0.045; // 4.5%

// ─── Stork Oracle Helper ─────────────────────────────────────

const STORK_BASE_URL = "https://rest.jp.stork-oracle.network";

interface StorkPriceResult {
  asset: string;
  price: number;
}

/**
 * Fetch prices from Stork oracle (same API as molty-events).
 * Used internally by autoRebalance for market signal calculation.
 */
async function fetchStorkPrices(assets: string): Promise<StorkPriceResult[]> {
  const apiKey = process.env.STORK_API_KEY;
  if (!apiKey) {
    throw new Error("STORK_API_KEY is not configured. Cannot fetch market data for rebalancing.");
  }

  const url = `${STORK_BASE_URL}/v1/prices/latest?assets=${encodeURIComponent(assets.toUpperCase())}`;
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Basic ${apiKey}` },
  });

  if (!response.ok) {
    throw new Error(`Stork API error: ${response.status} ${response.statusText}`);
  }

  const body = await response.json() as { data: Record<string, { price: string }> };
  if (!body.data || Object.keys(body.data).length === 0) {
    throw new Error(`No pricing data from Stork for: ${assets}`);
  }

  const results: StorkPriceResult[] = [];
  for (const [assetId, assetData] of Object.entries(body.data)) {
    const quantizedPrice = BigInt(assetData.price);
    const price = Number(quantizedPrice) / 1e18;
    results.push({
      asset: assetId,
      price: Math.round(price * 100) / 100,
    });
  }
  return results;
}

// ─── Reference Prices for Signal Calculation ─────────────────

/**
 * Simple in-memory reference price store.
 * In production, this would come from a database or time-series API.
 * For the hackathon demo, we use hardcoded reference points that
 * represent "yesterday's prices" for signal calculation.
 */
const REFERENCE_PRICES: Record<string, number> = {
  ETHUSD: 2500,
  BTCUSD: 95000,
  SOLUSD: 180,
};

// ─── API Functions ───────────────────────────────────────────

/**
 * Check USDC and USYC balances on Arc Testnet.
 *
 * @returns Wallet address, USDC balance, USYC balance, and explorer link
 *
 * @example
 *   const balance = await getArcBalance();
 *   // { address: "0x...", usdcBalance: "150.00", usycBalance: "200.00", explorerUrl: "..." }
 */
export async function getArcBalance(): Promise<ArcBalance> {
  const account = getAccount();
  const publicClient = getPublicClient();

  // Read USDC balance via ERC-20 interface (6 decimals)
  const usdcRaw = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "balanceOf",
    args: [account.address],
  });

  // Read USYC balance (6 decimals)
  let usycRaw = 0n;
  try {
    usycRaw = await publicClient.readContract({
      address: USYC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address],
    });
  } catch {
    // USYC may not be available if not allowlisted — return 0
  }

  return {
    address: account.address,
    usdcBalance: formatUnits(usdcRaw, 6),
    usycBalance: formatUnits(usycRaw, 6),
    explorerUrl: explorerAddress(account.address),
  };
}

/**
 * Send USDC to an address on Arc Network.
 *
 * Uses the USDC ERC-20 `transfer` function.
 *
 * @param recipient - Destination address (0x...)
 * @param amount - Human-readable USDC amount (e.g. "10" for 10 USDC)
 * @returns Transaction hash and explorer link
 *
 * @example
 *   const result = await sendUSDC("0x1234...", "10");
 *   // { txHash: "0x...", recipient: "0x1234...", amount: "10", explorerUrl: "..." }
 */
export async function sendUSDC(recipient: string, amount: string): Promise<SendResult> {
  const walletClient = getWalletClient();
  const publicClient = getPublicClient();

  const amountRaw = parseUnits(amount, 6);

  const hash = await walletClient.writeContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "transfer",
    args: [recipient as `0x${string}`, amountRaw],
  });

  await publicClient.waitForTransactionReceipt({ hash });

  return {
    txHash: hash,
    recipient,
    amount,
    explorerUrl: explorerTx(hash),
  };
}

/**
 * Get current USYC yield position with estimated returns.
 *
 * USYC earns yield from US Treasury reverse repo agreements
 * at approximately the overnight federal funds rate (~4.5% APY).
 *
 * @returns USYC balance and estimated yield figures
 *
 * @example
 *   const position = await getYieldPosition();
 *   // { usycBalance: "200.00", estimatedAPY: "4.50%", estimatedDailyYield: "0.025", ... }
 */
export async function getYieldPosition(): Promise<YieldPosition> {
  const account = getAccount();
  const publicClient = getPublicClient();

  let usycRaw = 0n;
  try {
    usycRaw = await publicClient.readContract({
      address: USYC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [account.address],
    });
  } catch {
    // USYC may not be available
  }

  const usycBalance = Number(formatUnits(usycRaw, 6));

  const dailyYield = (usycBalance * ESTIMATED_APY) / 365;
  const monthlyYield = (usycBalance * ESTIMATED_APY) / 12;

  return {
    usycBalance: usycBalance.toFixed(2),
    estimatedAPY: `${(ESTIMATED_APY * 100).toFixed(2)}%`,
    estimatedDailyYield: dailyYield.toFixed(4),
    estimatedMonthlyYield: monthlyYield.toFixed(2),
  };
}

/**
 * Deposit USDC into USYC via the Teller contract (earn yield on US Treasuries).
 *
 * 1. Approves USDC to the Teller contract (if needed)
 * 2. Calls Teller.deposit() to convert USDC → USYC
 *
 * @param amount - Human-readable USDC amount to deposit (e.g. "50")
 * @returns Transaction hash and explorer link
 *
 * @example
 *   const result = await depositToYield("50");
 *   // { txHash: "0x...", usdcDeposited: "50", explorerUrl: "..." }
 */
export async function depositToYield(amount: string): Promise<DepositResult> {
  const walletClient = getWalletClient();
  const publicClient = getPublicClient();
  const account = getAccount();

  const amountRaw = parseUnits(amount, 6);

  // Check current allowance
  const currentAllowance = await publicClient.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_ABI,
    functionName: "allowance",
    args: [account.address, USYC_TELLER_ADDRESS],
  });

  // Approve if needed
  if (currentAllowance < amountRaw) {
    const approveHash = await walletClient.writeContract({
      address: USDC_ADDRESS,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [USYC_TELLER_ADDRESS, amountRaw],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }

  // Deposit USDC to get USYC
  const depositHash = await walletClient.writeContract({
    address: USYC_TELLER_ADDRESS,
    abi: TELLER_ABI,
    functionName: "deposit",
    args: [amountRaw, account.address],
  });

  await publicClient.waitForTransactionReceipt({ hash: depositHash });

  return {
    txHash: depositHash,
    usdcDeposited: amount,
    explorerUrl: explorerTx(depositHash),
  };
}

/**
 * Redeem USYC back to USDC via the Teller contract (exit yield position).
 *
 * Calls Teller.redeem() to burn USYC and receive USDC.
 *
 * @param amount - Human-readable USYC amount to redeem (e.g. "50")
 * @returns Transaction hash and explorer link
 *
 * @example
 *   const result = await withdrawFromYield("50");
 *   // { txHash: "0x...", usycRedeemed: "50", explorerUrl: "..." }
 */
export async function withdrawFromYield(amount: string): Promise<WithdrawResult> {
  const walletClient = getWalletClient();
  const publicClient = getPublicClient();
  const account = getAccount();

  const amountRaw = parseUnits(amount, 6);

  const redeemHash = await walletClient.writeContract({
    address: USYC_TELLER_ADDRESS,
    abi: TELLER_ABI,
    functionName: "redeem",
    args: [amountRaw, account.address, account.address],
  });

  await publicClient.waitForTransactionReceipt({ hash: redeemHash });

  return {
    txHash: redeemHash,
    usycRedeemed: amount,
    explorerUrl: explorerTx(redeemHash),
  };
}

/**
 * Get full treasury status: USDC + USYC balances, allocation, and yield estimate.
 *
 * @returns Comprehensive treasury overview
 *
 * @example
 *   const status = await getTreasuryStatus();
 *   // { usdcBalance: "100.00", usycBalance: "250.00", totalValueUSDC: "350.00",
 *   //   usdcAllocationPct: "28.6%", usycAllocationPct: "71.4%", ... }
 */
export async function getTreasuryStatus(): Promise<TreasuryStatus> {
  const balance = await getArcBalance();

  const usdcVal = Number(balance.usdcBalance);
  const usycVal = Number(balance.usycBalance);
  const totalVal = usdcVal + usycVal;

  const usdcPct = totalVal > 0 ? ((usdcVal / totalVal) * 100).toFixed(1) : "0.0";
  const usycPct = totalVal > 0 ? ((usycVal / totalVal) * 100).toFixed(1) : "0.0";

  const monthlyYield = (usycVal * ESTIMATED_APY) / 12;

  return {
    address: balance.address,
    usdcBalance: usdcVal.toFixed(2),
    usycBalance: usycVal.toFixed(2),
    totalValueUSDC: totalVal.toFixed(2),
    usdcAllocationPct: `${usdcPct}%`,
    usycAllocationPct: `${usycPct}%`,
    estimatedAPY: `${(ESTIMATED_APY * 100).toFixed(2)}%`,
    estimatedMonthlyYield: monthlyYield.toFixed(2),
    explorerUrl: balance.explorerUrl,
  };
}

/**
 * Autonomous treasury rebalancing based on Stork oracle market signals.
 *
 * Decision logic:
 * 1. Fetches live crypto prices from Stork (ETH, BTC, SOL)
 * 2. Calculates average % change from reference prices
 * 3. Classifies market signal as BEARISH, NEUTRAL, or BULLISH
 * 4. Sets target allocation:
 *    - BEARISH  (avg change < -3%) → 70% USYC / 30% USDC (safe yield)
 *    - NEUTRAL  (avg change ±3%)  → 50% USYC / 50% USDC (balanced)
 *    - BULLISH  (avg change > +3%) → 20% USYC / 80% USDC (stay liquid)
 * 5. Executes deposit or withdrawal to reach target allocation
 *
 * @returns Full explanation of market signal, decision, and action taken
 *
 * @example
 *   const result = await autoRebalance();
 *   // { marketSignal: "BEARISH", explanation: "Market is bearish (ETH -4.2%, BTC -3.8%). Moving 70% to USYC.", ... }
 */
export async function autoRebalance(): Promise<RebalanceResult> {
  // 1. Fetch current prices from Stork oracle
  const prices = await fetchStorkPrices("ETHUSD,BTCUSD,SOLUSD");

  // 2. Calculate % change from reference prices
  const changes: Array<{ asset: string; price: number; changePct: number }> = [];

  for (const p of prices) {
    const ref = REFERENCE_PRICES[p.asset];
    if (ref) {
      const changePct = ((p.price - ref) / ref) * 100;
      changes.push({ asset: p.asset, price: p.price, changePct });
    }
  }

  // Average % change across tracked assets
  const avgChange = changes.length > 0
    ? changes.reduce((sum, c) => sum + c.changePct, 0) / changes.length
    : 0;

  // 3. Classify market signal
  let marketSignal: "BEARISH" | "NEUTRAL" | "BULLISH";
  let targetUsycPct: number;

  if (avgChange < -3) {
    marketSignal = "BEARISH";
    targetUsycPct = 70;
  } else if (avgChange > 3) {
    marketSignal = "BULLISH";
    targetUsycPct = 20;
  } else {
    marketSignal = "NEUTRAL";
    targetUsycPct = 50;
  }

  const targetUsdcPct = 100 - targetUsycPct;

  // 4. Get current balances
  const balance = await getArcBalance();
  const usdcVal = Number(balance.usdcBalance);
  const usycVal = Number(balance.usycBalance);
  const totalVal = usdcVal + usycVal;

  const currentUsdcPct = totalVal > 0 ? (usdcVal / totalVal) * 100 : 100;
  const currentUsycPct = totalVal > 0 ? (usycVal / totalVal) * 100 : 0;

  // 5. Calculate required action
  const targetUsycVal = (totalVal * targetUsycPct) / 100;
  const usycDiff = targetUsycVal - usycVal;

  // Build change descriptions
  const changeDescriptions = changes
    .map((c) => `${c.asset.replace("USD", "")} ${c.changePct >= 0 ? "+" : ""}${c.changePct.toFixed(1)}%`)
    .join(", ");

  let action = "NO_CHANGE";
  let txHash: string | undefined;
  let explorerUrl: string | undefined;

  // Only rebalance if the difference is meaningful (> 1 USDC)
  if (totalVal < 1) {
    action = "NO_FUNDS";
    return {
      marketSignal,
      priceData: prices,
      previousAllocation: {
        usdcPct: `${currentUsdcPct.toFixed(1)}%`,
        usycPct: `${currentUsycPct.toFixed(1)}%`,
      },
      targetAllocation: {
        usdcPct: `${targetUsdcPct}%`,
        usycPct: `${targetUsycPct}%`,
      },
      action,
      explanation: `Market is ${marketSignal.toLowerCase()} (${changeDescriptions}), but treasury has no funds to rebalance.`,
    };
  }

  if (Math.abs(usycDiff) < 1) {
    action = "ALREADY_BALANCED";
    return {
      marketSignal,
      priceData: prices,
      previousAllocation: {
        usdcPct: `${currentUsdcPct.toFixed(1)}%`,
        usycPct: `${currentUsycPct.toFixed(1)}%`,
      },
      targetAllocation: {
        usdcPct: `${targetUsdcPct}%`,
        usycPct: `${targetUsycPct}%`,
      },
      action,
      explanation: `Market is ${marketSignal.toLowerCase()} (${changeDescriptions}). Treasury is already near target allocation. No action needed.`,
    };
  }

  if (usycDiff > 0) {
    // Need to deposit more USDC into USYC
    const depositAmount = Math.min(usycDiff, usdcVal - 1).toFixed(2); // Keep at least 1 USDC liquid for gas
    if (Number(depositAmount) > 0) {
      try {
        const result = await depositToYield(depositAmount);
        txHash = result.txHash;
        explorerUrl = result.explorerUrl;
        action = `DEPOSITED_${depositAmount}_USDC_TO_USYC`;
      } catch (err) {
        action = `DEPOSIT_FAILED: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  } else {
    // Need to redeem USYC back to USDC
    const redeemAmount = Math.min(Math.abs(usycDiff), usycVal).toFixed(2);
    if (Number(redeemAmount) > 0) {
      try {
        const result = await withdrawFromYield(redeemAmount);
        txHash = result.txHash;
        explorerUrl = result.explorerUrl;
        action = `REDEEMED_${redeemAmount}_USYC_TO_USDC`;
      } catch (err) {
        action = `REDEEM_FAILED: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
  }

  // 6. Build explanation
  const directionWord = usycDiff > 0 ? "Moving more into USYC for safe yield" : "Moving back to liquid USDC for trading";

  return {
    marketSignal,
    priceData: prices,
    previousAllocation: {
      usdcPct: `${currentUsdcPct.toFixed(1)}%`,
      usycPct: `${currentUsycPct.toFixed(1)}%`,
    },
    targetAllocation: {
      usdcPct: `${targetUsdcPct}%`,
      usycPct: `${targetUsycPct}%`,
    },
    action,
    txHash,
    explorerUrl,
    explanation: `Market is ${marketSignal.toLowerCase()} (${changeDescriptions}). Target: ${targetUsycPct}% USYC / ${targetUsdcPct}% USDC. ${directionWord}.`,
  };
}
