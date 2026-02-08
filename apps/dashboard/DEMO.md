# Molty — Demo guide: LI.FI + Yellow

## In one sentence

**LI.FI** gets the user USDC on the right chain; **Yellow** runs the prediction (create → resolve → settle in USDC).

---

## Which chain, what happens

| Part | Chain(s) | What happens |
|------|----------|----------------|
| **LI.FI** | Source → Destination | User has tokens on chain A (e.g. Arbitrum). LI.FI quotes then executes a cross-chain swap so user receives **USDC on chain B** (e.g. Base or Polygon). Chain B is where they’ll use Yellow (custody + settlement). |
| **Yellow (app session + prediction)** | **Sepolia** (today) | Backend operator wallet and Yellow **sandbox** use **Sepolia**. Create market = open app session + submit prediction state (off-chain). Resolve = by price or manual WIN/LOSS, then close session. |
| **Yellow (custody / settlement)** | **Base** or **Sepolia** | Custody contract holds USDC. Dashboard “Transactions” reads **Deposited** / **Withdrawn** from custody on **Base (8453)** or **Sepolia (11155111)**. |

So: **LI.FI = funding the right chain with USDC. Yellow = prediction lifecycle and settlement on that chain (Sepolia for sandbox, custody on Base or Sepolia).**

---

## Demo A — What’s in the app today (Yellow only)

No LI.FI in the UI yet. You demo **Yellow**: create → resolve → see custody.

### Chains

- **Backend (create/resolve):** Uses **Sepolia** RPC + operator `PRIVATE_KEY`; talks to Yellow **sandbox** (`wss://clearnet-sandbox.yellow.com/ws`).
- **Dashboard:** Wallet can be **Base**, **Base Sepolia**, or **Sepolia**. “Transactions” tab: pick **Base** or **Sepolia** to show custody events.

### Steps (1–2 minutes)

1. **Open dashboard** → Markets.
2. **Create market**  
   - Question, asset (e.g. ETHUSD), direction (LONG/SHORT), target price, amount (USDC 6 decimals).  
   - Backend creates Yellow app session + prediction (off-chain), stores in `state.json`.  
   - New market appears in the list.
3. **Resolve**  
   - **By price** — backend fetches current price, compares to target, sets WIN/LOSS.  
   - **WIN** / **LOSS** — force outcome for demo.  
   - Row updates to resolved + final price.
4. **Transactions**  
   - Select chain **Base** or **Sepolia**, optional wallet filter.  
   - Show **Deposited** / **Withdrawn** from Yellow custody on that chain.

### What to say

- “We create prediction markets via **Yellow** — off-chain state, on-chain settlement in USDC.”
- “Resolution can be by live price or manual override. Custody and settlement are on **Base** or **Sepolia**; you’re seeing those events here.”

---

## Demo B — Full story: LI.FI + Yellow (research script)

To show **LI.FI → Yellow** in one flow, use the e2e script in `research/e2e-crosschain-prediction/`.

### Chains (script default)

- **LI.FI:** **Arbitrum** → **Polygon** (or change to Base: set `LIFI_TO_CHAIN=8453`).  
  - User has USDC (or DAI) on Arbitrum; LI.FI swaps/bridges to USDC on the destination chain.
- **Yellow:** **Sepolia** (auth + channel + prediction + settlement in the script).  
  - Sandbox + Sepolia RPC; settlement chain id in script is Sepolia (`SETTLEMENT_CHAIN_ID=11155111`).

### Steps

1. **Configure**  
   `cp .env.example .env` — set `PRIVATE_KEY`, optionally `LIFI_API_KEY`.  
   For Base as destination: `LIFI_TO_CHAIN=8453`, `LIFI_TO_TOKEN` = Base USDC address.
2. **Dry run (no real swap)**  
   `LIFI_DRY_RUN=true node main.js` — shows LI.FI quote + rest of pipeline (Yellow auth → prediction → settle).
3. **Live run (real cross-chain swap)**  
   `LIFI_DRY_RUN=false node main.js` — executes LI.FI swap so you have USDC on destination chain, then Yellow flow.

### What to say

- “**LI.FI** moves the user’s funds cross-chain so they have USDC where it’s needed.”
- “**Yellow** then runs the prediction: open channel, place prediction off-chain, resolve, settle on-chain in USDC.”

---

## Demo C — LI.FI + Yellow in the same product (future)

To demo both in the **dashboard**:

1. **Add a “Get USDC” / “Fund wallet” step**  
   - Link or embed LI.FI (e.g. widget or redirect): “Need USDC on Base? Bridge with LI.FI.”  
   - User completes swap on LI.FI (e.g. Arbitrum → Base USDC).
2. **Then use current flow**  
   - User (or operator) has USDC on Base (or Sepolia).  
   - Create market → resolve (Yellow) → show Transactions for that chain.

Chains for that story: **LI.FI:** any source → **Base** (or Sepolia). **Yellow:** create/resolve as today (Sepolia sandbox), custody/settlement on **Base** or **Sepolia** so it matches the LI.FI destination.

---

## Quick reference

| Question | Answer |
|----------|--------|
| Which chain for Yellow create/resolve in the app? | **Sepolia** (backend + Yellow sandbox). |
| Which chain for custody in the dashboard? | **Base (8453)** or **Sepolia (11155111)**. |
| Where does LI.FI run? | Research script: **Arbitrum → Polygon** (or **Base**). Not yet in the dashboard. |
| What to demo for “LI.FI + Yellow”? | **Option A:** Yellow only in dashboard (explain LI.FI verbally). **Option B:** Run `research/e2e-crosschain-prediction/main.js`. **Option C:** Add LI.FI “Get USDC” in app, then current Yellow flow. |
