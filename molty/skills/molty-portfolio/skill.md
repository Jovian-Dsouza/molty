---
name: molty-portfolio
description: Check wallet token balances across chains. Use when user asks about their wallet, balance, or portfolio.
metadata: {"openclaw": {"requires": {"env": ["PRIVATE_KEY"]}}}
---

# Molty Portfolio — Wallet Balance Checker

This skill reads on-chain token balances for the wallet derived from `PRIVATE_KEY`.

---

## When to Use

Use this skill whenever the user asks about:
- Their wallet balance or holdings
- What tokens they have
- Their portfolio
- How much ETH, USDC, or other tokens they hold

## How to Use

Call `getPortfolio()` with an optional `chainId` parameter. If no chainId is provided, all supported chains (Base, Arbitrum, Polygon) are checked.

Supported chains:
- Base (8453) — default
- Arbitrum (42161)
- Polygon (137)

Supported tokens: ETH, USDC, DAI, USDT

## How to Report Results

- Be concise: "You've got 0.05 ETH and 124 USDC on Base" — not "Your current wallet holdings are..."
- Group by chain if showing multiple chains
- Only non-zero balances are returned, so report everything you get back
- If the wallet is empty, say so: "Your wallet is empty on Base right now."
- Use `[face:excited]` for healthy balances, `[face:idle]` for empty or small balances

## Error Handling

- If `PRIVATE_KEY` is not configured, tell the user: "My wallet isn't set up yet. Ask my operator to configure a private key." with `[face:error]`
- If an RPC call fails, say: "Couldn't read balances right now, the network might be slow. Try again in a moment." with `[face:error]`
