const PREDICTION_API =
  typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_PREDICTION_API_URL ?? "http://localhost:3999")
    : process.env.NEXT_PUBLIC_PREDICTION_API_URL ?? "http://localhost:3999";

export type Market = {
  id: string;
  question: string;
  asset: string;
  direction: string;
  targetPrice: number;
  amount: string;
  status: string;
  outcome?: string;
  finalPrice?: number;
  expiresAt?: number;
};

export async function fetchMarkets(): Promise<Market[]> {
  const res = await fetch(`${PREDICTION_API}/api/markets`);
  if (!res.ok) throw new Error("Failed to fetch markets");
  const data = await res.json();
  return data.markets ?? [];
}

export async function createMarket(body: {
  question?: string;
  asset?: string;
  direction?: string;
  targetPrice?: number;
  amount?: string;
  expirySeconds?: number;
}): Promise<{ market: Market }> {
  const res = await fetch(`${PREDICTION_API}/api/markets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export async function resolveMarket(id: string, outcome?: "WIN" | "LOSS"): Promise<{ market: Market }> {
  const url = outcome
    ? `${PREDICTION_API}/api/markets/${id}/resolve?outcome=${outcome}`
    : `${PREDICTION_API}/api/markets/${id}/resolve`;
  const res = await fetch(url, { method: "POST" });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export type YellowTx = {
  type: "Deposit" | "Withdraw";
  txHash: string;
  blockNumber: number;
  wallet: string;
  token: string;
  amount: string;
  chainId: number;
};

export async function fetchTransactions(
  address?: string,
  chainId = 11155111,
  limit = 30
): Promise<YellowTx[]> {
  const params = new URLSearchParams({ chainId: String(chainId), limit: String(limit) });
  if (address) params.set("address", address);
  const res = await fetch(`/api/transactions?${params}`);
  if (!res.ok) throw new Error("Failed to fetch transactions");
  const data = await res.json();
  return data.transactions ?? [];
}

const PREDICTION_API_FOR_PRICE =
  typeof window !== "undefined"
    ? (process.env.NEXT_PUBLIC_PREDICTION_API_URL ?? "http://localhost:3999")
    : process.env.NEXT_PUBLIC_PREDICTION_API_URL ?? "http://localhost:3999";

export async function fetchPrice(asset: string): Promise<{ price: number }> {
  const res = await fetch(
    `${PREDICTION_API_FOR_PRICE}/api/price?asset=${encodeURIComponent(asset)}`
  );
  if (!res.ok) throw new Error("Failed to fetch price");
  const data = await res.json();
  return { price: data.price };
}
