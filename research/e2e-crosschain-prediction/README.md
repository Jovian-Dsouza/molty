# Molty — End-to-End Cross-Chain Prediction Pipeline

Full pipeline script: **LI.FI cross-chain swap → Yellow state channel → LO prediction → on-chain settlement**.

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  STEP 1: LI.FI  │────▶│ STEP 2: Yellow   │────▶│ STEP 3: LO       │────▶│ STEP 4: Settle  │
│  Cross-Chain    │     │ Auth + Channel   │     │ Prediction       │     │ On-Chain        │
│                 │     │                  │     │ (Off-Chain)      │     │                 │
│ • Quote         │     │ • EIP-712 Auth   │     │ • Price oracle   │     │ • Close channel │
│ • Swap tokens   │     │ • Session key    │     │ • Create LO      │     │ • Final alloc   │
│ • Bridge cross  │     │ • App session    │     │ • Sign + send    │     │ • Settle USDC   │
│   chain         │     │ • State channel  │     │ • Monitor price  │     │ • Verify on-    │
│ • Poll status   │     │                  │     │ • Resolve W/L    │     │   chain         │
└─────────────────┘     └──────────────────┘     └──────────────────┘     └─────────────────┘
     (on-chain)              (on-chain open)          (off-chain)            (on-chain close)
```

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your private key and RPC URLs

# 3. Run the full pipeline
node main.js
```

## Running Individual Steps

Each step can be run independently:

```bash
# Step 1: LI.FI cross-chain quote (dry run)
node src/1-lifi-crosschain.js

# Step 2: Yellow auth + state channel
node src/2-yellow-channel.js

# Step 3: LO prediction (standalone price test)
node src/3-lo-prediction.js

# Step 4: Settlement module demo
node src/4-settlement.js
```

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `PRIVATE_KEY` | Yes | — | Your EOA private key |
| `SEPOLIA_RPC_URL` | No | `https://rpc.sepolia.org` | Sepolia RPC for Yellow auth |
| `ARBITRUM_RPC_URL` | No | `https://arb1.arbitrum.io/rpc` | Arbitrum RPC for LI.FI swap |
| `YELLOW_WS_URL` | No | `wss://clearnet-sandbox.yellow.com/ws` | ClearNet endpoint |
| `YELLOW_FAUCET_URL` | No | `https://clearnet-sandbox.yellow.com/faucet/requestTokens` | Sandbox faucet |
| `PREDICTION_ASSET` | No | `ETHUSD` | Asset to predict |
| `PREDICTION_DIRECTION` | No | `LONG` | `LONG` or `SHORT` |
| `PREDICTION_AMOUNT` | No | `50000000` | Amount in USDC (6 decimals) |
| `PREDICTION_TARGET_PRICE` | No | auto (+2%) | Target price |
| `PREDICTION_EXPIRY_SECONDS` | No | `3600` | Prediction expiry |
| `LIFI_DRY_RUN` | No | `true` | Set `false` for live swap |
| `MONITOR_DURATION_MS` | No | `60000` | How long to monitor prices |

## How It Works

### Step 1 — LI.FI Cross-Chain Swap
Fetches a cross-chain quote from the LI.FI API, optionally executes the swap transaction to move USDC from one chain (e.g. Arbitrum) to the target chain (e.g. Polygon), and polls until the transfer completes.

### Step 2 — Yellow Network Auth + State Channel
Connects to Yellow ClearNet via WebSocket, performs EIP-712 authentication with a session key, requests sandbox faucet tokens, and creates an application session (state channel) for the prediction.

### Step 3 — LO Prediction (Off-Chain)
Fetches live prices from CoinGecko, creates a Limit Order prediction with direction/target/expiry, signs and sends it into the state channel (gasless, instant), and monitors the price until target hit or expiry.

### Step 4 — On-Chain Settlement
Computes final allocations based on WIN/LOSS, closes the app session which triggers on-chain settlement via Yellow's ClearNode, verifies the settlement on-chain, and prints the final P&L.

## Tech Stack

- **@erc7824/nitrolite** — Yellow Network state channel SDK
- **viem** — Ethereum wallet/signing
- **LI.FI REST API** — Cross-chain routing
- **CoinGecko API** — Price oracle
- **ws** — WebSocket client

## Key Concepts

- **State Channels**: Lock funds once on-chain, transact unlimited times off-chain, settle once on-chain. Only 2 gas-costing transactions for the entire prediction lifecycle.
- **LI.FI**: Aggregates 20+ bridges and DEX aggregators to find the best cross-chain route.
- **Limit Order (LO)**: A prediction that a price will reach a target within a time window. Direction can be LONG (price goes up) or SHORT (price goes down).
- **Session Keys**: Ephemeral keys that sign off-chain messages without exposing the main wallet key.
