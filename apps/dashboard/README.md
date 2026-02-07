# Molty Predictions Dashboard

Next.js dashboard for Yellow prediction markets: create markets, view predictions, resolve, and see on-chain Yellow Custody activity.

## Stack

- **Next.js 14** (App Router)
- **Tailwind CSS** + **shadcn/ui** (Radix)
- **wagmi** + **RainbowKit** (wallet connect)
- **viem** (on-chain reads)

## Setup

1. Install dependencies (from repo root):
   ```bash
   pnpm install
   ```

2. Copy env and set prediction API URL:
   ```bash
   cp .env.example .env.local
   # NEXT_PUBLIC_PREDICTION_API_URL=http://localhost:3999
   ```

3. Start the prediction-market API (so create/resolve work):
   ```bash
   cd research/prediction-market && npm start
   ```

4. Run the dashboard:
   ```bash
   pnpm --filter dashboard dev
   ```
   Opens at http://localhost:3001

## Pages

- **/** — Dashboard: stats, recent predictions, recent Yellow txs, Create market CTA
- **/markets** — List markets, Create market dialog, Resolve button per open market
- **/predictions** — All predictions (card layout)
- **/transactions** — Yellow Custody Deposited/Withdrawn events (filter by connected wallet, Base or Sepolia)

## API

- **Markets**: Uses `NEXT_PUBLIC_PREDICTION_API_URL` (e.g. `http://localhost:3999`) for GET/POST markets and POST resolve.
- **Transactions**: Next.js route `GET /api/transactions?address=0x...&chainId=8453` reads Yellow Custody contract logs (last 50k blocks).

## Deploy

See **[DEPLOY.md](./DEPLOY.md)** for Vercel, Docker, and VPS steps. You need:

- `NEXT_PUBLIC_PREDICTION_API_URL` — URL of your prediction market API.
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` — from [WalletConnect Cloud](https://cloud.walletconnect.com).
