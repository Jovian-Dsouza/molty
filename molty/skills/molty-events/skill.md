# Molty Events — Live Price Feeds

This skill provides live cryptocurrency price data using the Stork oracle API.

---

## When to Use

Use this skill whenever the user asks about:
- The price of any cryptocurrency (ETH, BTC, SOL, etc.)
- Whether a crypto is up or down
- Market data or current trading prices

## How to Use

Call the `fetchPrice` tool with the asset pair. Asset pairs use the format `SYMBOLUSD` — uppercase, no slash, no spaces.

Common pairs:
- `ETHUSD` — Ethereum
- `BTCUSD` — Bitcoin
- `SOLUSD` — Solana
- `MATICUSD` — Polygon
- `AVAXUSD` — Avalanche
- `LINKUSD` — Chainlink
- `ARBUSD` — Arbitrum

You can also fetch multiple assets at once by passing a comma-separated string: `BTCUSD,ETHUSD,SOLUSD`

## How to Report Prices

- Be concise: "ETH is at $3,247" — not "The current market price of Ethereum is..."
- If the price seems notably high or low compared to common knowledge, comment on it briefly
- Round to whole dollars for prices above $100, two decimals for prices under $100
- If the API fails or the asset isn't found, say so honestly and use `[face:error]`

## Error Handling

- If `STORK_API_KEY` is not configured, tell the user: "My price feeds aren't set up yet. Ask my operator to add a Stork API key." with `[face:error]`
- If the asset isn't recognized by Stork, say: "I couldn't find pricing data for that one." with `[face:error]`
- If the API is rate-limited or down, say: "Price feeds are a bit slow right now, try again in a moment." with `[face:error]`
