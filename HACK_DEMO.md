# Hack demo: LI.FI (trade) on Base → Yellow (prediction) on Base

Everything happens on **Base mainnet**.

---

## Flow in two steps

### Step 1 — Trade on Base mainnet (LI.FI)

**Goal:** Get USDC on Base so you can use Yellow.

- **If you already have USDC on Base** → skip to Step 2.
- **If you have ETH or other tokens on Base** → Use LI.FI to **swap on Base** (same chain): e.g. ETH → USDC. One tx on Base.
- **If you have funds on another chain** (e.g. Arbitrum, Polygon) → Use LI.FI to **bridge + swap** to Base: e.g. USDC on Arbitrum → USDC on Base. LI.FI handles the bridge; destination is Base.

**Chain:** Base mainnet (8453).  
**Outcome:** Wallet has USDC on Base.

---

### Step 2 — Yellow on Base mainnet

**Goal:** Use that USDC for prediction markets (create → resolve → settle).

1. **Deposit USDC into Yellow Custody (on Base)**  
   - Contract: `0x490fb189DdE3a01B00be9BA5F41e3447FbC838b6` (Base).  
   - You approve USDC and call `deposit()`. USDC is now in Yellow’s custody on Base.

2. **Create prediction (off-chain, but tied to Base)**  
   - Backend connects to **Yellow production** ClearNet: `wss://clearnet.yellow.com/ws`.  
   - Auth uses your **Base** wallet (same chain as custody).  
   - You open an app session and submit the prediction state. No extra on-chain tx; it’s off-chain state.

3. **Resolve**  
   - Backend fetches price, decides WIN/LOSS, sends `close_app_session` with final allocations.  
   - Yellow settles **on Base**: custody balances update on-chain (one settlement tx on Base).

**Chains:** All of this is Base mainnet — custody contract, wallet, and settlement.

---

## How it fits together

```
[ You have funds on Base (or another chain) ]
                    │
    Step 1: LI.FI   │  Swap on Base (ETH→USDC) or bridge to Base (e.g. Arbitrum→Base USDC)
                    ▼
[ USDC on Base in your wallet ]
                    │
                    │  Approve + deposit to Yellow Custody (on Base)
                    ▼
[ USDC in Yellow Custody on Base ]
                    │
    Step 2: Yellow  │  Create market (off-chain) → Resolve (off-chain) → Settle (on-chain Base)
                    ▼
[ Custody balances updated on Base; you can withdraw or place another prediction ]
```

So: **first trade = LI.FI on Base (get USDC). Then Yellow = same Base mainnet (deposit → create → resolve → settle).** No Sepolia in this demo.

---

## What the app uses today vs what you need for this demo

| | Today (sandbox) | Hack demo (Base mainnet) |
|--|------------------|---------------------------|
| **Yellow** | Sandbox (`wss://clearnet-sandbox.yellow.com/ws`) + **Sepolia** | Production (`wss://clearnet.yellow.com/ws`) + **Base** |
| **Asset** | `ytest.usd` (test) | `usdc` (real) |
| **RPC** | Sepolia | Base mainnet |
| **Custody** | Sepolia (or Base in UI) | Base only |

So for the hack demo you need the **backend** to talk to Yellow **production** and use **Base** (chain + RPC + custody). The dashboard already can show custody on Base (8453); the missing piece is making the backend use Base + production when you choose “hack demo” mode (e.g. via env).

---

## Env for hack demo (Base mainnet)

In `apps/backend/.env` set:

```env
# Base mainnet + Yellow production
RPC_URL=https://mainnet.base.org
YELLOW_WS_URL=wss://clearnet.yellow.com/ws
# PRIVATE_KEY = wallet that has (or will have) USDC on Base and has approved/deposited to Yellow Custody on Base
```

And the backend code must use **Base** chain (not Sepolia) and **usdc** (not ytest.usd) when `YELLOW_WS_URL` is production. (See “What to change” below.)

---

## What the backend does for Base mainnet (already wired)

The backend `apps/backend/lib/yellow.js` detects production by URL: if `YELLOW_WS_URL` is `wss://clearnet.yellow.com/ws` (no "sandbox"), it uses **Base** chain and **usdc**; otherwise Sepolia + **ytest.usd**. So you only need env (see above).

1. **Custody / deposit**  
   For production you must have already deposited USDC to Yellow Custody on Base (e.g. run `research/yellow-swap/yellow-production.js` once, or use Yellow’s UI). The backend only does create/resolve; it doesn’t deposit. Contract on Base: `0x490fb189DdE3a01B00be9BA5F41e3447FbC838b6`.

2. **Dashboard**  
   Wallet: connect to **Base**. Transactions: select **Base** to show custody Deposited/Withdrawn on Base.

---

### Step 3 — Arc Treasury Management (Arc Testnet)

**Goal:** Show autonomous treasury management with real-world assets on Arc.

**Prize target:** Best Agentic Commerce App Powered by Real-World Assets on Arc ($2,500)

#### Pre-requisites

1. Get testnet USDC from https://faucet.circle.com (select Arc Testnet)
2. Apply for USYC allowlisting via Circle Support (include your wallet address, takes 24–48h)

#### Demo flow

1. **Check Arc balance:**
   - Voice: "What's my Arc treasury?"
   - Molty reads USDC + USYC balances on Arc Testnet

2. **Deposit into yield (RWA):**
   - Voice: "Move 50 USDC into US Treasuries"
   - Molty approves USDC → calls Teller.deposit() → mints USYC
   - USYC = tokenized US Treasury money market fund, earning ~4.5% APY

3. **Check yield position:**
   - Voice: "How's my yield?"
   - Molty shows USYC balance, estimated APY, daily/monthly yield

4. **Auto-rebalance (key feature):**
   - Voice: "Rebalance my treasury based on market conditions"
   - Molty fetches live prices from Stork oracle (ETH, BTC, SOL)
   - Calculates market signal (bearish/neutral/bullish)
   - Decides allocation: bearish → 70% USYC / bullish → 80% USDC
   - Executes the deposit or withdrawal autonomously
   - Reports: "Market is bearish (ETH -4.2%, BTC -3.8%). Moving 70% to USYC for safe yield."

5. **Send USDC payment:**
   - Voice: "Send 10 USDC to [address] on Arc"
   - Molty sends USDC via ERC-20 transfer on Arc, confirms instantly

#### Arc details

| Property | Value |
|----------|-------|
| Network | Arc Testnet |
| Chain ID | 5042002 |
| RPC | `https://rpc.testnet.arc.network` |
| Gas Token | USDC (native) |
| USDC ERC-20 | `0x3600000000000000000000000000000000000000` |
| USYC Token | `0xe9185F0c5F296Ed1797AaE4238D26CCaBEadb86C` |
| USYC Teller | `0x9fdF14c5B14173D74C08Af27AebFf39240dC105A` |
| Explorer | `https://testnet.arcscan.app` |
| Faucet | `https://faucet.circle.com` |

#### Why this wins the Arc prize

- **RWA collateral:** USYC is a real tokenized US Treasury fund, not a mock
- **Autonomous agent:** Molty makes rebalancing decisions without human intervention
- **Oracle-driven logic:** Stork price feeds drive every allocation decision
- **USDC settlement:** Everything is denominated and settled in USDC on Arc
- **Clear decision logic:** Every rebalance explains the market signal and reasoning

---

## How all three steps fit together

```
[ Funds on any chain ]
         │
  Step 1 │  LI.FI: Swap/bridge to USDC on Base
         ▼
[ USDC on Base ]
         │
  Step 2 │  Yellow: Deposit → Predict → Resolve → Settle (gasless state channels)
         ▼
[ Winnings in USDC on Base ]
         │
  Step 3 │  Arc: Park idle USDC in USYC (US Treasuries) → Auto-rebalance by market signals
         ▼
[ Treasury earning 4.5% yield on Arc, liquid for next bet ]
```

**Full cycle:** Trade on Base (LI.FI) → Bet on Base (Yellow) → Earn yield on Arc (USYC). Molty manages all three autonomously.

---

## One-line summary

**Trade on Base (LI.FI) → Predict on Base (Yellow) → Earn yield on Arc (USYC). All autonomous, all USDC.**
