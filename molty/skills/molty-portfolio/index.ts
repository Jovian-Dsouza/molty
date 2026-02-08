/**
 * Molty Portfolio — On-Chain Wallet Balance Checker
 *
 * Reads token balances directly from the blockchain using viem.
 * Supports native ETH and ERC20 tokens on Base, Arbitrum, and Polygon.
 *
 * Environment variables:
 *   PRIVATE_KEY — Wallet private key (required, for address derivation)
 */

import {
  createPublicClient,
  http,
  formatUnits,
  formatEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { base, arbitrum, polygon } from "viem/chains";

// ─── Constants ────────────────────────────────────────────────

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

const ERC20_ABI = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ name: "", type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// ─── Types ───────────────────────────────────────────────────

interface PortfolioParams {
  chainId?: number;
}

interface TokenBalance {
  token: string;
  balance: string;
  chainId: number;
  chainName: string;
}

interface PortfolioResult {
  address: string;
  balances: TokenBalance[];
}

// ─── Core ────────────────────────────────────────────────────

/**
 * Fetch all token balances for the configured wallet.
 *
 * @param params.chainId - Chain to check (default: all supported chains)
 * @returns Wallet address and non-zero token balances
 *
 * @example
 *   const result = await getPortfolio();
 *   // { address: "0x...", balances: [{ token: "ETH", balance: "0.05", chainId: 8453, chainName: "Base" }] }
 *
 * @example
 *   const result = await getPortfolio({ chainId: 8453 });
 *   // Only checks Base chain
 */
export async function getPortfolio(params?: PortfolioParams): Promise<PortfolioResult> {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error("PRIVATE_KEY is not configured. Wallet is unavailable.");
  }

  const pk = (privateKey.startsWith("0x") ? privateKey : `0x${privateKey}`) as `0x${string}`;
  const account = privateKeyToAccount(pk);
  const walletAddress = account.address;

  const chainIds = params?.chainId ? [params.chainId] : Object.keys(CHAIN_MAP).map(Number);

  const allBalances: TokenBalance[] = [];

  for (const chainId of chainIds) {
    const chainInfo = CHAIN_MAP[chainId];
    if (!chainInfo) {
      throw new Error(`Unsupported chain ID: ${chainId}. Supported: Base (8453), Arbitrum (42161), Polygon (137)`);
    }

    const publicClient = createPublicClient({
      chain: chainInfo.chain,
      transport: http(chainInfo.rpcUrl),
    });

    // Build list of balance checks for this chain
    const checks: Array<{ token: string; isNative: boolean; address?: string }> = [];

    for (const [symbol, chains] of Object.entries(TOKENS)) {
      const tokenAddress = chains[chainId];
      if (tokenAddress) {
        checks.push({
          token: symbol,
          isNative: tokenAddress === NATIVE_TOKEN,
          address: tokenAddress,
        });
      }
    }

    // Fetch all balances in parallel
    const results = await Promise.all(
      checks.map(async (check) => {
        try {
          let rawBalance: bigint;

          if (check.isNative) {
            rawBalance = await publicClient.getBalance({ address: walletAddress });
          } else {
            rawBalance = await publicClient.readContract({
              address: check.address as `0x${string}`,
              abi: ERC20_ABI,
              functionName: "balanceOf",
              args: [walletAddress],
            });
          }

          if (rawBalance === 0n) return null;

          const decimals = TOKEN_DECIMALS[check.token] ?? 18;
          const formatted = decimals === 18
            ? formatEther(rawBalance)
            : formatUnits(rawBalance, decimals);

          return {
            token: check.token,
            balance: formatted,
            chainId,
            chainName: chainInfo.name,
          };
        } catch {
          // Skip tokens that fail to read (e.g. RPC issues)
          return null;
        }
      })
    );

    for (const result of results) {
      if (result) allBalances.push(result);
    }
  }

  return {
    address: walletAddress,
    balances: allBalances,
  };
}
