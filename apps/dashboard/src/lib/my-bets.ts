const STORAGE_PREFIX = "molty-my-bets";

export type MyBetEntry = {
  marketId: string;
  question: string;
  asset: string;
  direction: "LONG" | "SHORT";
  targetPrice: number;
  amount: string;
  createdAt: number;
};

function storageKey(wallet?: string): string {
  if (wallet) return `${STORAGE_PREFIX}-${wallet.toLowerCase()}`;
  return STORAGE_PREFIX;
}

export function getMyBets(wallet?: string): MyBetEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(storageKey(wallet));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function addMyBet(entry: MyBetEntry, wallet?: string): void {
  const list = getMyBets(wallet);
  list.unshift(entry);
  localStorage.setItem(storageKey(wallet), JSON.stringify(list));
}

export function removeMyBet(marketId: string, wallet?: string): void {
  const list = getMyBets(wallet).filter((b) => b.marketId !== marketId);
  localStorage.setItem(storageKey(wallet), JSON.stringify(list));
}
