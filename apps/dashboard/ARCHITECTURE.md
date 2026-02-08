# Molty Predictions — Architecture

## Overview

Molty is a prediction-market dashboard that creates and resolves markets via **Yellow Network** (off-chain bets) and exposes them in a simple UI. The backend holds market state and talks to Yellow; the frontend lists markets, creates new ones, and triggers resolution.

## High-level flow: LI.FI → Yellow

1. **Trade / fund (LI.FI)** — Bridge, swap, or move assets (e.g. DAI on Arbitrum → USDC on Base) so the user has USDC on the chain where Yellow operates. LI.FI handles cross-chain routing and execution.
2. **Prediction (Yellow)** — Create market (app session + prediction state), list markets, resolve by price or manual WIN/LOSS, settle on-chain. All prediction lifecycle is via Yellow (off-chain state, on-chain settlement).

So: **LI.FI for trade/funding → Yellow for prediction.**

## Flow

### 1. Create market

- **User:** Opens “Create market” in the dashboard, fills question (optional), asset (e.g. ETHUSD), direction (LONG/SHORT), target price, amount (USDC 6 decimals).
- **Frontend:** `POST /api/markets` to the prediction-market backend with `question`, `asset`, `direction`, `targetPrice`, `amount`, `expirySeconds`.
- **Backend:** Uses `PRIVATE_KEY` to connect to Yellow (WebSocket), creates an app session and prediction (off-chain), stores the market in local state (`state.json`) with `id`, `question`, `asset`, `direction`, `targetPrice`, `amount`, `status: 'open'`, and Yellow metadata needed for resolution.
- **Response:** Backend returns the created `market`; frontend calls `GET /api/markets` (e.g. via `onSuccess`), so the new market appears at the top of the list with its **question** and all fields.

### 2. List markets

- **Frontend:** `GET /api/markets` on load and after create/resolve.
- **Backend:** Reads `state.json`, returns `markets` (id, question, asset, direction, targetPrice, amount, status, outcome, finalPrice, expiresAt).
- **UI:** Table shows each market with full question, asset, direction, target, amount, status (Open / WIN / LOSS), and resolution actions for open markets.

### 3. Resolution

- **By price (default):** User clicks “By price”. Backend calls Yellow with the market’s app session and allocations; Yellow (or the backend) compares the asset’s **current price** to the **target**.  
  - LONG: price ≥ target → WIN; else LOSS.  
  - SHORT: price ≤ target → WIN; else LOSS.
- **Manual override:** User clicks “WIN” or “LOSS”. Backend calls the resolve endpoint with `?outcome=WIN` or `?outcome=LOSS` so the result is forced (for testing or disputed markets).
- **Backend:** `POST /api/markets/:id/resolve` (optional `outcome`). Uses `PRIVATE_KEY` and stored `sessionPrivateKey` to resolve on Yellow, then updates the market in state to `status: 'resolved'`, `outcome`, `finalPrice`.
- **Frontend:** After resolve, refetches markets; the row updates to show WIN or LOSS.

## Stack

| Layer        | Tech |
|-------------|------|
| Dashboard   | Next.js 14 (App Router), Tailwind, shadcn/ui, RainbowKit + wagmi |
| Backend API | Node, Express, dotenv, viem, Yellow WebSocket client |
| State       | Backend: `state.json` (markets + session key). Frontend: React state + refetch |

## Key files

- **Frontend:** `src/app/markets/page.tsx` (list, create trigger, resolve actions), `src/components/create-market-dialog.tsx`, `src/lib/api.ts` (fetchMarkets, createMarket, resolveMarket).
- **Backend:** `server.js` (routes, dotenv from app dir), `lib/yellow.js` (Yellow connect, create, resolve), `lib/store.js` (state.json read/write).

## Environment

- **Backend:** `apps/backend/.env` — `PRIVATE_KEY` (operator wallet), `YELLOW_WS_URL`, `RPC_URL`, etc. Loaded from the backend directory so it works regardless of process cwd.
- **Dashboard:** `NEXT_PUBLIC_PREDICTION_API_URL` (default `http://localhost:3999` for local backend).

## Wallet in the UI

- **Navbar:** Wallet connect (RainbowKit) and network selector (Base, Base Sepolia, Sepolia) are in the **top-right** of the main content header. Used for chain selection and future on-chain actions (e.g. viewing txs).
- **Markets:** Create and resolve are driven by the **backend** operator key; the dashboard wallet is for identity/chain only unless you add on-chain features later.
