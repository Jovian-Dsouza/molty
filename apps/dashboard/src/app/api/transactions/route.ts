import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, fallback, http, parseAbiItem, type Chain } from "viem";
import { base, baseSepolia, sepolia } from "viem/chains";

const CUSTODY_BASE = "0x490fb189DdE3a01B00be9BA5F41e3447FbC838b6" as const;
const CUSTODY_BASE_SEPOLIA = "0x5bfEa1aD034512b43541fB2346928ca7511e75D3" as const;
const CUSTODY_SEPOLIA = "0x6F71a38d919ad713D0AfE0eB712b95064Fc2616f" as const;

const BASE_RPCS = [
  "https://mainnet.base.org",
  "https://base.llamarpc.com",
  "https://base-mainnet.public.blastapi.io",
  "https://1rpc.io/base",
];

const chains: Record<number, { chain: Chain; transport: ReturnType<typeof http> | ReturnType<typeof fallback> }> = {
  8453: { chain: base, transport: fallback(BASE_RPCS.map((url) => http(url))) },
  84532: { chain: baseSepolia, transport: http("https://sepolia.base.org") },
  11155111: { chain: sepolia, transport: http("https://rpc.sepolia.org") },
};

const custodyAbi = [
  parseAbiItem("event Deposited(address indexed wallet, address indexed token, uint256 amount)"),
  parseAbiItem("event Withdrawn(address indexed wallet, address indexed token, uint256 amount)"),
];

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const address = searchParams.get("address");
  const chainId = parseInt(searchParams.get("chainId") ?? "8453", 10);
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50", 10), 100);

  const cfg = chains[chainId];
  if (!cfg) {
    return NextResponse.json({ error: "Unsupported chainId" }, { status: 400 });
  }

  const custody =
    chainId === 8453 ? CUSTODY_BASE : chainId === 84532 ? CUSTODY_BASE_SEPOLIA : CUSTODY_SEPOLIA;
  const client = createPublicClient({
    chain: cfg.chain,
    transport: cfg.transport,
  });

  try {
    const block = await client.getBlockNumber();
    const fiftyK = BigInt(50000);
    const fromBlock = block > fiftyK ? block - fiftyK : BigInt(0);
    const toBlock = block;

    const deposited = await client.getLogs({
      address: custody,
      events: [custodyAbi[0]],
      fromBlock,
      toBlock,
    });
    const withdrawn = await client.getLogs({
      address: custody,
      events: [custodyAbi[1]],
      fromBlock,
      toBlock,
    });

    type TxEntry = {
      type: "Deposit" | "Withdraw";
      txHash: string;
      blockNumber: number;
      wallet: string;
      token: string;
      amount: string;
      chainId: number;
    };

    const entries: TxEntry[] = [];

    const addr = address?.toLowerCase();
    for (const log of deposited) {
      if (log.args.wallet && log.args.token != null && log.args.amount != null) {
        if (addr && log.args.wallet.toLowerCase() !== addr) continue;
        entries.push({
          type: "Deposit",
          txHash: log.transactionHash ?? "",
          blockNumber: Number(log.blockNumber),
          wallet: log.args.wallet,
          token: log.args.token,
          amount: log.args.amount.toString(),
          chainId,
        });
      }
    }
    for (const log of withdrawn) {
      if (log.args.wallet && log.args.token != null && log.args.amount != null) {
        if (addr && log.args.wallet.toLowerCase() !== addr) continue;
        entries.push({
          type: "Withdraw",
          txHash: log.transactionHash ?? "",
          blockNumber: Number(log.blockNumber),
          wallet: log.args.wallet,
          token: log.args.token,
          amount: log.args.amount.toString(),
          chainId,
        });
      }
    }

    entries.sort((a, b) => b.blockNumber - a.blockNumber);
    const slice = entries.slice(0, limit);

    return NextResponse.json({ transactions: slice });
  } catch (err) {
    console.error("transactions API error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch" },
      { status: 500 }
    );
  }
}
