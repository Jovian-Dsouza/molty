---
name: molty-predict
description: Place prediction bets and manage markets via Yellow Network. Use when user asks to bet, predict, or wager on any market outcome.
metadata: {"openclaw": {"requires": {"env": ["PREDICTION_API_URL"]}}}
---

# Molty Predict — Prediction Market Betting via Yellow Network

This skill lets Molty place bets on prediction markets, list open markets, check market status, and resolve markets — all via the Molty backend API which talks to Yellow Network state channels.

**How it works under the hood:** Deposits happen on-chain (Sepolia USDC into Yellow custody). Betting and resolving happen off-chain via Yellow state channels. Withdrawals go back on-chain.

---

## When to Use

Use this skill whenever the user asks to:
- **Place a bet or prediction** — "Bet $5 on ETH going up", "I think BTC will hit 100k", "Predict yes on Apple above 250"
- **List available markets** — "What can I bet on?", "Show me open markets", "What predictions are live?"
- **Check a bet status** — "How's my ETH bet doing?", "Did I win?"
- **Resolve a market** — "Resolve the ETH bet", "Settle all markets"
- **Create a new market** — "Create a market for SOL above 300"

---

## Available Markets

The system has both real crypto markets and fun prediction markets across categories:

### Crypto (real price-based — auto-resolves by live price)
- **ETHUSD** — Ethereum price predictions (Up/Down)
- **BTCUSD** — Bitcoin price predictions (Up/Down)
- **SOLUSD** — Solana price predictions (Up/Down)

### Non-Crypto (fun/demo markets — resolve manually as WIN/LOSS)
- **Politics** — Elections, regulations, government decisions
- **Sports** — Championship outcomes, match results
- **Stocks** — AAPL, TSLA stock price predictions
- **Entertainment** — Movies, games, pop culture
- **Weather** — Weather predictions
- **Global/Macro** — Interest rates, oil, gold, geopolitical events

---

## How to Use

### 1. List Open Markets

Call `listMarkets()` to get all available markets. Filter for `status === "open"` to show betable markets.

The response includes:
- `id` — Market ID (needed for betting and resolving)
- `question` — Human-readable question (e.g. "Will ETH be above $2,100 by tomorrow?")
- `asset` — Asset category (ETHUSD, BTCUSD, POLITICS, SPORTS, etc.)
- `direction` — LONG (Up/Yes) or SHORT (Down/No)
- `targetPrice` — Target price for crypto markets
- `status` — "open" or "resolved"
- `outcome` — "WIN" or "LOSS" (only when resolved)

### 2. Place a Bet (Create Market)

When a user says something like "Bet on ETH going up" or "I think BTC will hit 100k":

1. **Parse the intent:**
   - What asset? (ETH, BTC, SOL, or a non-crypto category)
   - What direction? (Up/Yes = LONG, Down/No = SHORT)
   - What target price? (for crypto — if not specified, use current price +2% for LONG, -2% for SHORT)
   - What amount? (default: 1 USDC = "1000000" in 6-decimal format)

2. **Call `createMarket()`** with:
   - `question` — A clear question, e.g. "Will ETH be above $2,200 by tomorrow?"
   - `asset` — e.g. "ETHUSD"
   - `direction` — "LONG" or "SHORT"
   - `targetPrice` — number (e.g. 2200)
   - `amount` — string in 6-decimal USDC format (e.g. "1000000" = 1 USDC, "5000000" = 5 USDC)

3. **Report the result** to the user.

### 3. Resolve a Market

Call `resolveMarket(marketId, outcome?)` to settle:
- For **crypto markets**: omit `outcome` — the system auto-fetches the current price and determines WIN/LOSS.
- For **non-crypto markets**: pass `outcome` as "WIN" or "LOSS" since there's no live price feed.

### 4. Check a Specific Market

Call `getMarket(marketId)` or filter `listMarkets()` results to find a specific bet and report its status.

---

## Mapping User Language to API Parameters

### Direction Mapping
| User says | Direction |
|-----------|-----------|
| "up", "above", "long", "yes", "bull", "higher", "over" | LONG |
| "down", "below", "short", "no", "bear", "lower", "under" | SHORT |

### Asset Mapping
| User says | Asset |
|-----------|-------|
| "ETH", "Ethereum", "ether" | ETHUSD |
| "BTC", "Bitcoin" | BTCUSD |
| "SOL", "Solana" | SOLUSD |
| "Apple", "AAPL" | AAPL |
| "Tesla", "TSLA" | TSLA |
| "gold", "XAU" | XAUUSD |
| "oil", "crude" | OILUSD |

For non-price markets (politics, sports, entertainment, weather), use the category as the asset (e.g. "POLITICS", "SPORTS").

### Amount Mapping
| User says | Amount (6-decimal USDC) |
|-----------|------------------------|
| "$1", "1 USDC", "1 dollar" | "1000000" |
| "$5", "5 USDC" | "5000000" |
| "$10", "10 USDC" | "10000000" |
| "$50" | "50000000" |
| No amount mentioned | "1000000" (default: 1 USDC) |

---

## How to Report Results

Keep responses voice-friendly and concise (remember: TTS on a physical robot).

### Bet Placed Successfully
"Done! Bet 5 USDC that ETH goes above $2,200. Let's see if we're right! [face:excited]"

### Listing Markets
"There are 4 open markets right now. ETH above $2,100, BTC above $95k, Real Madrid winning Champions League, and Apple above $250. Want to bet on any? [face:watching]"

### Market Resolved — Win
"We won! ETH hit the target. That's a shell of a deal! [face:celebrating]"

### Market Resolved — Loss
"We lost that one. ETH didn't make it. My claws are trembling. [face:dying]"

### Checking Status
"Your ETH bet is still live. Currently looking good — ETH is above the target! [face:winning]"

---

## Error Handling

- **Backend unreachable:** "My prediction backend is offline right now. Try again in a moment." with `[face:error]`
- **No open markets:** "No open markets right now. Want me to create one?" with `[face:idle]`
- **Market not found:** "I couldn't find that market. Let me show you what's available." with `[face:error]`
- **Yellow Network error (session expired):** The backend auto-retries with a fresh session key. If it still fails: "Having trouble with Yellow Network. The operator might need to check the backend." with `[face:error]`
- **Unknown asset:** "I don't have a market for that one. I can bet on ETH, BTC, SOL, or fun categories like politics and sports." with `[face:idle]`

---

## API Reference

All calls go to `PREDICTION_API_URL` (default: `http://localhost:3999`).

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/markets` | GET | List all markets |
| `/api/markets` | POST | Create a new market (place a bet) |
| `/api/markets/:id/resolve` | POST | Resolve/settle a market |
| `/api/price?asset=ETHUSD` | GET | Get current price for an asset |

### POST /api/markets — Request Body
```json
{
  "question": "Will ETH be above $2,200 by tomorrow?",
  "asset": "ETHUSD",
  "direction": "LONG",
  "targetPrice": 2200,
  "amount": "1000000"
}
```

### POST /api/markets/:id/resolve — Optional Query/Body
```json
{
  "outcome": "WIN"
}
```
Omit `outcome` for crypto markets (auto-resolves by price).
