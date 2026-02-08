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

## One-line summary

**First trade on Base (LI.FI) → then Yellow on Base (deposit, create, resolve, settle). All on Base mainnet.**
