---
name: molty-swap
description: Swap tokens on-chain via LI.FI. Use when user asks to swap, convert, or exchange crypto tokens.
metadata: {"openclaw": {"requires": {"env": ["PRIVATE_KEY", "LIFI_API_KEY"]}}}
---

# Molty Swap — On-Chain Token Swaps via LI.FI

This skill executes real on-chain token swaps using the LI.FI aggregator API.

---

## When to Use

Use this skill whenever the user asks to:
- Swap tokens — "swap 0.001 ETH to USDC"
- Convert tokens — "convert ETH to USDC"
- Exchange tokens — "exchange my USDC for ETH"
- Buy tokens with other tokens — "buy some USDC with ETH"

## How to Use

Call the `swap` function with parameters:
- `fromToken` — Token to sell (e.g. "ETH", "USDC", "DAI", "USDT")
- `toToken` — Token to buy (e.g. "USDC", "ETH")
- `amount` — Human-readable amount (e.g. "0.001" for 0.001 ETH)
- `fromChainId` — (optional) Source chain ID, defaults to 8453 (Base)
- `toChainId` — (optional) Destination chain ID, defaults to same as fromChainId

## Supported Tokens

- **ETH** (native) — Base
- **USDC** — Base, Arbitrum, Polygon
- **DAI** — Arbitrum, Polygon
- **USDT** — Arbitrum, Polygon

Default chain is Base (8453). Also supports Arbitrum (42161) and Polygon (137).

## How to Report Results

Keep it voice-friendly and concise:
- Success: "Done! Swapped 0.001 ETH for 2.43 USDC on Base." with `[face:celebrating]`
- Pending: "Swap is in progress, waiting for confirmation." with `[face:watching]`

## Safety

The swap auto-executes immediately when the user gives the command. No confirmation step is needed. Report the result after completion.

## Error Handling

- If `PRIVATE_KEY` or `LIFI_API_KEY` is not configured: "My swap wallet isn't set up yet. Ask my operator to add the keys." with `[face:error]`
- If insufficient balance: "Not enough balance for that swap." with `[face:error]`
- If the quote fails: "Couldn't get a swap quote for that pair right now." with `[face:error]`
- If the transaction reverts: "The swap transaction failed on-chain. Try again with a smaller amount." with `[face:error]`
