/**
 * Molty Swap — On-Chain Token Swaps via LI.FI
 *
 * Executes real token swaps using the LI.FI aggregator API.
 * Supports same-chain and cross-chain swaps.
 *
 * Environment variables:
 *   PRIVATE_KEY  — Wallet private key (required)
 *   LIFI_API_KEY — LI.FI API key (required)
 */

import {
  createWalletClient,
  createPublicClient,
  http,
  formatUnits,
  formatEther,
  parseEther,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, arbitrum, polygon } from "viem/chains";

// ─── Constants ────────────────────────────────────────────────

const LIFI_BASE_URL = "https://li.quest/v1";

const CHAIN_MAP: Record<number, { chain: typeof base; name: string; rpcUrl: string }> = {
  8453: { chain: base, name: "Base", rpcUrl: "https://mainnet.base.org" },
  42161: { chain: arbitrum, name: "Arbitrum", rpcUrl: "https://arb1.arbitrum.io/rpc" },
  137: { chain: polygon, name: "Polygon", rpcUrl: "https://polygon-rpc.com" },
};

const NATIVE_TOKEN = "0x0000000000000000000000000000000000000000";

const TOKENS: Record<string, Record<number, string>> = {
  ETH: {
    8453: NATIVE_TOKEN,
  },
  USDC: {
    8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    42161: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    137: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
  },
  DAI: {
    42161: "0xDA10009cBd5D07dd0CeCc66161FC93D7c9000da1",
    137: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063",
  },
  USDT: {
    42161: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9",
    137: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
  },
};

const TOKEN_DECIMALS: Record<string, number> = {
  ETH: 18,
  USDC: 6,
  DAI: 18,
  USDT: 6,
};

// ─── Types ───────────────────────────────────────────────────

interface SwapParams {
  fromToken: string;
  toToken: string;
  amount: string;
  fromChainId?: number;
  toChainId?: number;
}

interface SwapResult {
  txHash: string;
  fromAmount: string;
  fromToken: string;
  toAmount: string;
  toToken: string;
  explorerUrl: string;
  status: string;
  gasCostUSD: string;
}

// ─── Helpers ─────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function resolveTokenAddress(symbol: string, chainId: number): string {
  const upper = symbol.toUpperCase();
  const addresses = TOKENS[upper];
  if (!addresses) {
    throw new Error(`Unknown token: ${symbol}. Supported: ${Object.keys(TOKENS).join(", ")}`);
  }
  const address = addresses[chainId];
  if (!address) {
    throw new Error(`${symbol} is not available on chain ${chainId}`);
  }
  return address;
}

function getDecimals(symbol: string): number {
  return TOKEN_DECIMALS[symbol.toUpperCase()] ?? 18;
}

function parseAmount(amount: string, symbol: string): string {
  const decimals = getDecimals(symbol);
  if (decimals === 18) {
    return parseEther(amount).toString();
  }
  return parseUnits(amount, decimals).toString();
}

function getHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  const apiKey = process.env.LIFI_API_KEY;
  if (apiKey) headers["x-lifi-api-key"] = apiKey;
  return headers;
}

function getExplorerUrl(chainId: number, txHash: string): string {
  const explorers: Record<number, string> = {
    8453: "https://basescan.org/tx/",
    42161: "https://arbiscan.io/tx/",
    137: "https://polygonscan.com/tx/",
  };
  const base = explorers[chainId] ?? "https://basescan.org/tx/";
  return `${base}${txHash}`;
}

// ─── Core ────────────────────────────────────────────────────

/**
 * Execute a token swap end-to-end via LI.FI.
 *
 * @param params.fromToken - Token to sell (e.g. "ETH", "USDC")
 * @param params.toToken - Token to buy (e.g. "USDC", "ETH")
 * @param params.amount - Human-readable amount (e.g. "0.001")
 * @param params.fromChainId - Source chain ID (default: 8453 Base)
 * @param params.toChainId - Destination chain ID (default: same as fromChainId)
 * @returns Swap result with tx hash, amounts, and explorer URL
 *
 * @example
 *   const result = await swap({ fromToken: "ETH", toToken: "USDC", amount: "0.001" });
 *   // { txHash: "0x...", fromAmount: "0.001", toAmount: "2.43", ... }
 */
export async function swap(params: SwapParams): Promise<SwapResult> {
  const { fromToken, toToken, amount } = params;
  const fromChainId = params.fromChainId ?? 8453;
  const toChainId = params.toChainId ?? fromChainId;

  // Validate environment
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY is not configured. Swap wallet is unavailable.");
  }
  if (!process.env.LIFI_API_KEY) {
    throw new Error("LIFI_API_KEY is not configured. Swaps are unavailable.");
  }

  // Validate chain
  const chainInfo = CHAIN_MAP[fromChainId];
  if (!chainInfo) {
    throw new Error(`Unsupported chain ID: ${fromChainId}. Supported: Base (8453), Arbitrum (42161), Polygon (137)`);
  }

  // Resolve tokens
  const fromTokenAddress = resolveTokenAddress(fromToken, fromChainId);
  const toTokenAddress = resolveTokenAddress(toToken, toChainId);
  const fromAmountRaw = parseAmount(amount, fromToken);

  // Setup wallet
  const pk = (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as `0x${string}`;
  const account = privateKeyToAccount(pk);

  const walletClient = createWalletClient({
    chain: chainInfo.chain,
    transport: http(chainInfo.rpcUrl),
    account,
  });

  const publicClient = createPublicClient({
    chain: chainInfo.chain,
    transport: http(chainInfo.rpcUrl),
  });

  // 1. Get quote
  const quoteParams = new URLSearchParams({
    fromChain: fromChainId.toString(),
    toChain: toChainId.toString(),
    fromToken: fromTokenAddress,
    toToken: toTokenAddress,
    fromAmount: fromAmountRaw,
    fromAddress: account.address,
    slippage: "0.05",
  });

  const quoteRes = await fetch(`${LIFI_BASE_URL}/quote?${quoteParams}`, {
    headers: getHeaders(),
  });
  const quote = await quoteRes.json();

  if (!quoteRes.ok) {
    throw new Error(`LI.FI quote error: ${JSON.stringify(quote).slice(0, 200)}`);
  }

  if (!quote.transactionRequest) {
    throw new Error("LI.FI returned no transaction request — swap may not be available for this pair.");
  }

  const estimatedOutput = quote.estimate?.toAmount || quote.toAmount;
  const toDecimals = quote.action?.toToken?.decimals ?? getDecimals(toToken);
  const estimatedOutputFormatted = estimatedOutput
    ? formatUnits(BigInt(estimatedOutput), toDecimals)
    : "unknown";
  const gasCostUSD = quote.estimate?.gasCosts?.[0]?.amountUSD ?? "unknown";

  // 2. Execute swap transaction
  const tx = quote.transactionRequest;
  const hash = await walletClient.sendTransaction({
    to: tx.to as `0x${string}`,
    data: tx.data as `0x${string}`,
    value: tx.value ? BigInt(tx.value) : 0n,
    gasLimit: tx.gasLimit ? BigInt(tx.gasLimit) : undefined,
  });

  // 3. Wait for tx confirmation
  const receipt = await publicClient.waitForTransactionReceipt({ hash });

  if (receipt.status !== "success") {
    throw new Error("Swap transaction reverted on-chain.");
  }

  // 4. Poll LI.FI status
  let finalToAmount = estimatedOutputFormatted;
  let swapStatus = "CONFIRMED";

  for (let attempt = 0; attempt < 10; attempt++) {
    await sleep(3000 * Math.min(Math.pow(2, attempt), 10));

    const statusParams = new URLSearchParams({
      txHash: hash,
      fromChain: fromChainId.toString(),
      toChain: toChainId.toString(),
    });

    try {
      const statusRes = await fetch(`${LIFI_BASE_URL}/status?${statusParams}`, {
        headers: getHeaders(),
      });
      const statusData = await statusRes.json();
      const status = statusData.status || "PENDING";

      if (status === "DONE") {
        swapStatus = "DONE";
        if (statusData.receiving?.amount) {
          finalToAmount = formatUnits(BigInt(statusData.receiving.amount), toDecimals);
        }
        break;
      }

      if (status === "FAILED") {
        swapStatus = "FAILED";
        break;
      }
    } catch {
      // Status check failed, continue polling
    }
  }

  return {
    txHash: hash,
    fromAmount: amount,
    fromToken: fromToken.toUpperCase(),
    toAmount: finalToAmount,
    toToken: toToken.toUpperCase(),
    explorerUrl: getExplorerUrl(fromChainId, hash),
    status: swapStatus,
    gasCostUSD,
  };
}
