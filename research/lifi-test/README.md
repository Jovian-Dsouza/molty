# LI.FI API Test

Minimal scripts to test LI.FI REST API (no SDK, no API key required).

## Endpoints Used

| Script       | LI.FI Endpoint | Purpose                         |
|--------------|----------------|----------------------------------|
| get-quote.js | GET /v1/quote  | Cross-chain swap/bridge quote   |
| get-chains.js| GET /v1/chains | List supported chains           |
| get-tokens.js| GET /v1/tokens | List tokens per chain           |
| get-status.js| GET /v1/status | Check transfer status (pass txHash) |

## Run

```bash
npm run quote    # Get DAI (Arbitrum) -> USDC (Polygon) quote
npm run chains   # List EVM chains
npm run tokens   # List tokens for Ethereum, Polygon, Arbitrum
```

## Base URL

```
https://li.quest/v1
```

No API key required. Optional `x-lifi-api-key` header for higher rate limits.

## Molty Use Case

Example: User says "Bet 50 USDC — use my DAI on Arbitrum"
1. `get-quote.js` → LI.FI returns route + transaction data
2. User (or Molty) signs transaction
3. After tx confirms → poll `/status` until DONE
4. USDC arrives on Polygon → deposit into Yellow → place bet
