---
name: molty-arc
description: Autonomous treasury management on Arc Network. Use when user asks about Arc balance, treasury, yield, USYC, rebalancing, or making payments on Arc.
metadata: {"openclaw": {"requires": {"env": ["PRIVATE_KEY"]}}}
---

# Molty Arc — Autonomous Treasury Management on Arc Network

This skill lets Molty manage a USDC treasury on Arc Network, earn yield via USYC (tokenized US Treasury money market fund), send USDC payments, and autonomously rebalance between liquid USDC and yield-bearing USYC based on Stork oracle market signals.

**How it works under the hood:** Arc is a Layer-1 blockchain that uses USDC as its native gas token. USYC is a yield-bearing token backed by US Treasuries (real-world asset). Molty deposits USDC into USYC via the Teller contract to earn safe yield, and redeems USYC back to USDC when it needs liquidity. The rebalancing logic is driven by live crypto prices from Stork oracle.

---

## When to Use

Use this skill whenever the user asks to:
- **Check Arc balance** — "What's my Arc balance?", "How much USDC do I have on Arc?"
- **Check treasury status** — "Show my treasury", "What's my portfolio on Arc?"
- **Send USDC on Arc** — "Send 10 USDC to 0x...", "Pay 5 USDC to this address on Arc"
- **Deposit into yield** — "Move USDC into US Treasuries", "Earn yield on my USDC", "Deposit to USYC"
- **Withdraw from yield** — "Redeem my USYC", "Move USYC back to USDC", "Exit yield position"
- **Check yield position** — "How's my yield?", "What's my USYC worth?"
- **Rebalance treasury** — "Rebalance my treasury", "Auto-rebalance based on market", "Optimize my allocation"

---

## How to Use

### 1. Check Arc Balance

Call `getArcBalance()` to see USDC and USYC balances on Arc Testnet.

Returns:
- `address` — Wallet address
- `usdcBalance` — USDC balance (human-readable)
- `usycBalance` — USYC balance (human-readable)
- `explorerUrl` — Link to wallet on Arc Explorer

### 2. Send USDC Payment

Call `sendUSDC(recipient, amount)` to send USDC to any address on Arc.

Parameters:
- `recipient` — Destination address (0x...)
- `amount` — Human-readable USDC amount (e.g. "10" for 10 USDC)

Returns tx hash and explorer link.

### 3. Get Yield Position

Call `getYieldPosition()` to see the current USYC holding and estimated yield.

Returns:
- `usycBalance` — Current USYC balance
- `estimatedAPY` — Approximate yield (~4.5% from US Treasuries)
- `estimatedDailyYield` — Estimated daily yield in USDC
- `estimatedMonthlyYield` — Estimated monthly yield in USDC

### 4. Deposit USDC into USYC (Earn Yield)

Call `depositToYield(amount)` to convert USDC into USYC via the Teller contract.

Parameters:
- `amount` — Human-readable USDC amount to deposit (e.g. "50" for 50 USDC)

This approves USDC to the Teller, then calls `deposit()` to mint USYC. Returns tx hash.

### 5. Withdraw USYC to USDC

Call `withdrawFromYield(amount)` to redeem USYC back to USDC via the Teller contract.

Parameters:
- `amount` — Human-readable USYC amount to redeem (e.g. "50" for 50 USYC)

Returns tx hash and USDC received.

### 6. Get Treasury Status

Call `getTreasuryStatus()` for a full overview: USDC balance, USYC balance, total value, allocation percentages, and estimated yield.

### 7. Auto-Rebalance (Key Feature)

Call `autoRebalance()` to autonomously rebalance between USDC and USYC based on Stork oracle market signals.

The logic:
1. Fetches live crypto prices from Stork (ETH, BTC, SOL)
2. Calculates a market risk signal based on price movements
3. Decides target allocation:
   - **Bearish / high volatility** (prices dropping >3%) → 70% USYC / 30% USDC (park in safe yield)
   - **Moderate market** (prices within ±3%) → 50% USYC / 50% USDC (balanced)
   - **Bullish** (prices up >3%) → 20% USYC / 80% USDC (stay liquid for trading)
4. Executes the necessary deposit or withdrawal
5. Returns explanation of the decision and actions taken

---

## How to Report Results

Keep responses voice-friendly and concise (remember: TTS on a physical robot).

### Balance Check
"You've got 150 USDC and 200 USYC on Arc. That's about 350 total, earning yield on the Treasuries. [face:excited]"

### USDC Sent
"Done! Sent 10 USDC to that address on Arc. Transaction confirmed instantly. [face:celebrating]"

### Deposit to Yield
"Moved 50 USDC into US Treasuries via USYC. Now earning about 4.5% annually. Safe harbor! [face:excited]"

### Withdraw from Yield
"Redeemed 50 USYC back to USDC. Ready to deploy that capital. [face:excited]"

### Yield Position
"Your 200 USYC is earning roughly 25 cents a day from US Treasuries. Steady as she goes. [face:watching]"

### Auto-Rebalance
"Market looks bearish — ETH down 4.2%, BTC down 3.8%. Moving 70% of treasury to USYC for safe yield. Anchoring down! [face:watching]"

### Treasury Status
"Treasury has 100 USDC liquid and 250 in USYC earning yield. Total value about 350 USDC, 71% in safe harbor. [face:idle]"

---

## Error Handling

- **PRIVATE_KEY not configured:** "My Arc wallet isn't set up yet. Ask my operator to add the private key." with `[face:error]`
- **Insufficient USDC balance:** "Not enough USDC on Arc for that. Need to top up first." with `[face:error]`
- **Insufficient USYC balance:** "Don't have enough USYC to redeem that amount." with `[face:error]`
- **USYC not allowlisted:** "My wallet isn't allowlisted for USYC yet. The operator needs to request access from Circle." with `[face:error]`
- **Transaction failed:** "The transaction failed on Arc. Try again with a smaller amount." with `[face:error]`
- **Stork oracle unavailable:** "Can't fetch market data right now. Try rebalancing again in a moment." with `[face:error]`

---

## Arc Network Details

| Property | Value |
|----------|-------|
| Network | Arc Testnet |
| Chain ID | 5042002 |
| RPC | `https://rpc.testnet.arc.network` |
| Gas Token | USDC (native) |
| Explorer | `https://testnet.arcscan.app` |
| USDC ERC-20 | `0x3600000000000000000000000000000000000000` (6 decimals) |
| USYC Token | `0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C` (6 decimals) |
| USYC Teller | `0x9fdF14c5B14173D74C08Af27AebFf39240dC105A` |
| Faucet | `https://faucet.circle.com` |
