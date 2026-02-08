/**
 * Molty Predict — Prediction Market Betting via Yellow Network
 *
 * Places bets, lists markets, resolves outcomes by calling the
 * Molty backend API (which handles Yellow state channels internally).
 *
 * Environment variables:
 *   PREDICTION_API_URL — Backend API base URL (default: http://localhost:3999)
 */

const API_URL = process.env.PREDICTION_API_URL || "http://localhost:3999";

// ─── Types ───────────────────────────────────────────────────

interface Market {
  id: string;
  question: string;
  asset: string;
  direction: string;
  targetPrice: number;
  amount: string;
  status: "open" | "resolved";
  outcome?: "WIN" | "LOSS";
  finalPrice?: number;
  expiresAt?: number;
}

interface CreateMarketParams {
  question: string;
  asset: string;
  direction: "LONG" | "SHORT";
  targetPrice?: number;
  amount?: string; // 6-decimal USDC, e.g. "1000000" = 1 USDC
}

interface ResolveResult {
  market: Market;
  result: {
    outcome: "WIN" | "LOSS";
    finalPrice: number;
  };
}

interface PriceData {
  asset: string;
  price: number;
}

// ─── Helpers ─────────────────────────────────────────────────

/**
 * Parse a user's natural language bet request into API parameters.
 *
 * @example
 *   parseBetIntent("Bet $5 on ETH going up to 2200")
 *   // { asset: "ETHUSD", direction: "LONG", targetPrice: 2200, amount: "5000000", question: "Will ETH be above $2,200?" }
 *
 * @example
 *   parseBetIntent("I think Bitcoin will crash below 90k")
 *   // { asset: "BTCUSD", direction: "SHORT", targetPrice: 90000, amount: "1000000", question: "Will BTC be below $90,000?" }
 */
export function parseBetIntent(text: string): CreateMarketParams {
  const lower = text.toLowerCase();

  // ── Asset ──
  let asset = "ETHUSD";
  if (/\b(btc|bitcoin)\b/i.test(lower)) asset = "BTCUSD";
  else if (/\b(sol|solana)\b/i.test(lower)) asset = "SOLUSD";
  else if (/\b(apple|aapl)\b/i.test(lower)) asset = "AAPL";
  else if (/\b(tesla|tsla)\b/i.test(lower)) asset = "TSLA";
  else if (/\b(gold|xau)\b/i.test(lower)) asset = "XAUUSD";
  else if (/\b(oil|crude|wti)\b/i.test(lower)) asset = "OILUSD";
  else if (/\b(politic|election|vote|government|congress|senate)\b/i.test(lower)) asset = "POLITICS";
  else if (/\b(sport|football|soccer|cricket|basketball|tennis|champion)\b/i.test(lower)) asset = "SPORTS";
  else if (/\b(movie|film|marvel|game|gta|entertainment|music)\b/i.test(lower)) asset = "ENTERTAINMENT";
  else if (/\b(weather|rain|snow|temperature|storm)\b/i.test(lower)) asset = "WEATHER";
  else if (/\b(fed|interest rate|inflation|macro)\b/i.test(lower)) asset = "MACRO";

  // ── Direction ──
  const isDown = /\b(down|below|short|no|bear|lower|under|crash|drop|fall|decline)\b/i.test(lower);
  const isUp = /\b(up|above|long|yes|bull|higher|over|hit|reach|rise|pump|moon)\b/i.test(lower);
  const direction: "LONG" | "SHORT" = isDown && !isUp ? "SHORT" : "LONG";

  // ── Target Price ──
  const priceMatch = lower.match(/\$?\s*([\d,]+(?:\.\d+)?)\s*(?:k|K)?\b/);
  let targetPrice: number | undefined;
  if (priceMatch) {
    let raw = parseFloat(priceMatch[1].replace(/,/g, ""));
    // Handle "100k" → 100000
    if (/k/i.test(lower.slice(priceMatch.index! + priceMatch[0].length - 1, priceMatch.index! + priceMatch[0].length + 1))) {
      raw *= 1000;
    }
    // Sanity check: don't use tiny numbers that are clearly amounts, not prices
    if (raw > 10 || asset === "AAPL" || asset === "TSLA") {
      targetPrice = raw;
    }
  }

  // ── Amount (USDC) ──
  const amountMatch = lower.match(/(?:bet|wager|stake|put)\s+\$?\s*(\d+(?:\.\d+)?)/i)
    || lower.match(/\$\s*(\d+(?:\.\d+)?)\s*(?:usdc|dollars?|bucks?)?/i);
  const usdcAmount = amountMatch ? parseFloat(amountMatch[1]) : 1;
  const amount = String(Math.round(usdcAmount * 1_000_000)); // 6 decimals

  // ── Question ──
  const assetLabel = asset.replace("USD", "");
  let question: string;
  if (["POLITICS", "SPORTS", "ENTERTAINMENT", "WEATHER", "MACRO", "GAMING"].includes(asset)) {
    // For non-price markets, use the user's text as the question
    question = text.replace(/^(bet|wager|predict|i think)\s*/i, "").trim();
    if (!question.endsWith("?")) question += "?";
    // Capitalize first letter
    question = question.charAt(0).toUpperCase() + question.slice(1);
  } else {
    const dir = direction === "LONG" ? "above" : "below";
    const priceStr = targetPrice ? `$${targetPrice.toLocaleString()}` : "target";
    question = `Will ${assetLabel} be ${dir} ${priceStr} by tomorrow?`;
  }

  return { question, asset, direction, targetPrice, amount };
}

// ─── API Functions ───────────────────────────────────────────

/**
 * List all prediction markets from the backend.
 * Returns both open and resolved markets.
 *
 * @example
 *   const markets = await listMarkets();
 *   const open = markets.filter(m => m.status === "open");
 */
export async function listMarkets(): Promise<Market[]> {
  const res = await fetch(`${API_URL}/api/markets`);
  if (!res.ok) {
    throw new Error(`Failed to list markets: ${res.status} ${res.statusText}`);
  }
  const data = await res.json();
  return data.markets ?? [];
}

/**
 * Get current price for a crypto asset.
 *
 * @param asset - Asset pair, e.g. "ETHUSD", "BTCUSD"
 * @returns Price data with asset name and USD price
 *
 * @example
 *   const { price } = await getPrice("ETHUSD");
 *   // price = 2089.50
 */
export async function getPrice(asset: string): Promise<PriceData> {
  const res = await fetch(`${API_URL}/api/price?asset=${encodeURIComponent(asset)}`);
  if (!res.ok) {
    throw new Error(`Failed to get price for ${asset}: ${res.status}`);
  }
  return await res.json();
}

/**
 * Create a new prediction market (place a bet).
 *
 * This calls the backend which:
 * 1. Connects to Yellow Network via WebSocket
 * 2. Authenticates with a session key
 * 3. Opens an app session (state channel) with the bet parameters
 * 4. Submits the prediction state
 *
 * @param params.question - The prediction question
 * @param params.asset - Asset pair (e.g. "ETHUSD", "BTCUSD", "POLITICS")
 * @param params.direction - "LONG" (up/yes) or "SHORT" (down/no)
 * @param params.targetPrice - Target price for crypto (optional — auto-calculated if omitted)
 * @param params.amount - Bet amount in 6-decimal USDC (default: "1000000" = 1 USDC)
 * @returns The created market object
 *
 * @example
 *   const market = await createMarket({
 *     question: "Will ETH be above $2,200 by tomorrow?",
 *     asset: "ETHUSD",
 *     direction: "LONG",
 *     targetPrice: 2200,
 *     amount: "5000000",
 *   });
 */
export async function createMarket(params: CreateMarketParams): Promise<Market> {
  const body: Record<string, unknown> = {
    question: params.question,
    asset: params.asset,
    direction: params.direction,
  };
  if (params.targetPrice != null) body.targetPrice = params.targetPrice;
  if (params.amount != null) body.amount = params.amount;

  const res = await fetch(`${API_URL}/api/markets`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Failed to create market: ${err.error || res.statusText}`);
  }

  const data = await res.json();
  return data.market;
}

/**
 * Resolve/settle a prediction market.
 *
 * For crypto markets (ETHUSD, BTCUSD, SOLUSD), omit `outcome` — the backend
 * auto-fetches the live price and determines WIN or LOSS.
 *
 * For non-crypto markets (POLITICS, SPORTS, etc.), pass `outcome` explicitly
 * as "WIN" or "LOSS".
 *
 * @param marketId - The market ID to resolve
 * @param outcome - Optional: "WIN" or "LOSS" (for manual resolution)
 * @returns Resolve result with outcome and final price
 *
 * @example
 *   // Auto-resolve crypto market
 *   const result = await resolveMarket("m_1770547906139");
 *
 *   // Manually resolve non-crypto market
 *   const result = await resolveMarket("m_1770547906139", "WIN");
 */
export async function resolveMarket(marketId: string, outcome?: "WIN" | "LOSS"): Promise<ResolveResult> {
  const url = new URL(`${API_URL}/api/markets/${marketId}/resolve`);
  if (outcome) url.searchParams.set("outcome", outcome);

  const res = await fetch(url.toString(), { method: "POST" });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Failed to resolve market: ${err.error || res.statusText}`);
  }

  return await res.json();
}

/**
 * High-level function: place a bet from natural language.
 *
 * Parses the user's intent, optionally fetches the current price for
 * target price calculation, and creates the market.
 *
 * @param userText - Natural language bet request from the user
 * @returns Object with the created market and a human-readable summary
 *
 * @example
 *   const { market, summary } = await placeBet("Bet $5 on ETH going up");
 *   // summary = "Bet 5 USDC that ETH goes above $2,130. Market ID: m_123..."
 *
 * @example
 *   const { market, summary } = await placeBet("I think Bitcoin will hit 100k");
 *   // summary = "Bet 1 USDC that BTC goes above $100,000. Market ID: m_456..."
 */
export async function placeBet(userText: string): Promise<{ market: Market; summary: string }> {
  const params = parseBetIntent(userText);

  // If no target price and it's a crypto asset, fetch current price
  if (params.targetPrice == null && !["POLITICS", "SPORTS", "ENTERTAINMENT", "WEATHER", "MACRO", "GAMING"].includes(params.asset)) {
    try {
      const { price } = await getPrice(params.asset);
      params.targetPrice = params.direction === "LONG"
        ? Math.round(price * 1.02)
        : Math.round(price * 0.98);
      // Update question with the actual target
      const assetLabel = params.asset.replace("USD", "");
      const dir = params.direction === "LONG" ? "above" : "below";
      params.question = `Will ${assetLabel} be ${dir} $${params.targetPrice.toLocaleString()} by tomorrow?`;
    } catch {
      // Price fetch failed — backend will handle target price
    }
  }

  const market = await createMarket(params);

  const usdcAmount = (Number(params.amount || "1000000") / 1_000_000).toFixed(0);
  const assetLabel = params.asset.replace("USD", "");
  const dirLabel = params.direction === "LONG" ? "goes above" : "goes below";
  const priceLabel = params.targetPrice ? ` $${params.targetPrice.toLocaleString()}` : "";

  const summary = `Bet ${usdcAmount} USDC that ${assetLabel} ${dirLabel}${priceLabel}. Market ID: ${market.id}`;

  return { market, summary };
}

/**
 * Find an open market matching a user query.
 * Searches by asset, question text, or market ID.
 *
 * @param query - Search text (asset name, keyword, or market ID)
 * @returns Matching open market, or null if not found
 *
 * @example
 *   const market = await findMarket("ETH");
 *   const market = await findMarket("Champions League");
 *   const market = await findMarket("m_1770547906139");
 */
export async function findMarket(query: string): Promise<Market | null> {
  const markets = await listMarkets();
  const lower = query.toLowerCase();

  // Try exact ID match first
  const byId = markets.find(m => m.id === query);
  if (byId) return byId;

  // Try asset match
  const byAsset = markets.find(m => m.status === "open" && m.asset.toLowerCase().includes(lower));
  if (byAsset) return byAsset;

  // Try question text match
  const byQuestion = markets.find(m => m.status === "open" && m.question.toLowerCase().includes(lower));
  if (byQuestion) return byQuestion;

  return null;
}
