import type { Market } from "@/lib/api";

export const MOCK_MARKETS: Omit<Market, "id" | "status" | "amount"> & {
  id: string;
  status: string;
  amount: string;
}[] = [
  {
    id: "mock-eth-2100",
    question: "Will ETH be above $2,100 by tomorrow?",
    asset: "ETHUSD",
    direction: "LONG",
    targetPrice: 2100,
    amount: "0",
    status: "open",
  },
  {
    id: "mock-eth-2050",
    question: "Will ETH be below $2,050 by tomorrow?",
    asset: "ETHUSD",
    direction: "SHORT",
    targetPrice: 2050,
    amount: "0",
    status: "open",
  },
  {
    id: "mock-btc-95k",
    question: "Will BTC be above $95,000 by tomorrow?",
    asset: "BTCUSD",
    direction: "LONG",
    targetPrice: 95000,
    amount: "0",
    status: "open",
  },
  {
    id: "mock-btc-92k",
    question: "Will BTC be below $92,000 by tomorrow?",
    asset: "BTCUSD",
    direction: "SHORT",
    targetPrice: 92000,
    amount: "0",
    status: "open",
  },
  {
    id: "mock-eth-2200",
    question: "Will ETH hit $2,200 by end of week?",
    asset: "ETHUSD",
    direction: "LONG",
    targetPrice: 2200,
    amount: "0",
    status: "open",
  },
  {
    id: "mock-sol-250",
    question: "Will SOL be above $250 by tomorrow?",
    asset: "SOLUSD",
    direction: "LONG",
    targetPrice: 250,
    amount: "0",
    status: "open",
  },
  // ── Politics ──
  {
    id: "mock-politics-1",
    question: "Will the incumbent win the 2026 US midterm?",
    asset: "POLITICS",
    direction: "LONG",
    targetPrice: 1,
    amount: "0",
    status: "open",
  },
  {
    id: "mock-politics-2",
    question: "Will EU pass new AI regulation by Q3 2026?",
    asset: "POLITICS",
    direction: "LONG",
    targetPrice: 1,
    amount: "0",
    status: "open",
  },
  // ── Sports ──
  {
    id: "mock-sports-1",
    question: "Will Real Madrid win Champions League 2026?",
    asset: "SPORTS",
    direction: "LONG",
    targetPrice: 1,
    amount: "0",
    status: "open",
  },
  {
    id: "mock-sports-2",
    question: "Will India win the Cricket World Cup 2026?",
    asset: "SPORTS",
    direction: "LONG",
    targetPrice: 1,
    amount: "0",
    status: "open",
  },
  // ── Tech ──
  {
    id: "mock-tech-1",
    question: "Will Apple stock be above $250 by March?",
    asset: "AAPL",
    direction: "LONG",
    targetPrice: 250,
    amount: "0",
    status: "open",
  },
  {
    id: "mock-tech-2",
    question: "Will Tesla deliver 500K cars in Q1 2026?",
    asset: "TSLA",
    direction: "LONG",
    targetPrice: 1,
    amount: "0",
    status: "open",
  },
  // ── Entertainment ──
  {
    id: "mock-entertainment-1",
    question: "Will the next Marvel movie gross over $1B?",
    asset: "ENTERTAINMENT",
    direction: "LONG",
    targetPrice: 1,
    amount: "0",
    status: "open",
  },
  {
    id: "mock-entertainment-2",
    question: "Will GTA 6 release before December 2026?",
    asset: "GAMING",
    direction: "LONG",
    targetPrice: 1,
    amount: "0",
    status: "open",
  },
  // ── Weather ──
  {
    id: "mock-weather-1",
    question: "Will it snow in New York City this weekend?",
    asset: "WEATHER",
    direction: "LONG",
    targetPrice: 1,
    amount: "0",
    status: "open",
  },
  // ── Global Events ──
  {
    id: "mock-global-1",
    question: "Will Fed cut interest rates in March 2026?",
    asset: "MACRO",
    direction: "LONG",
    targetPrice: 1,
    amount: "0",
    status: "open",
  },
  {
    id: "mock-global-2",
    question: "Will oil prices drop below $60/barrel this month?",
    asset: "OILUSD",
    direction: "SHORT",
    targetPrice: 60,
    amount: "0",
    status: "open",
  },
  {
    id: "mock-global-3",
    question: "Will gold hit $3,000/oz by end of February?",
    asset: "XAUUSD",
    direction: "LONG",
    targetPrice: 3000,
    amount: "0",
    status: "open",
  },
];

export function mergeMarkets(apiMarkets: Market[]): Market[] {
  const apiIds = new Set(apiMarkets.map((m) => m.id));
  const mockOnly = MOCK_MARKETS.filter((m) => !apiIds.has(m.id));
  return [...apiMarkets, ...mockOnly];
}
