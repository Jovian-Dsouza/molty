# Prediction Market API

Create markets (Yellow ClearNet), list them, and resolve with one click from the dashboard or kiosk.

## Deploy on Railway

1. **New Project** → Deploy from GitHub → select this repo.
2. **Root directory:** set to `apps/backend` (or configure build/start to run from this folder).
3. **Variables** (required):
   - `PRIVATE_KEY` — wallet private key (0x...) for Yellow auth.
   - `RPC_URL` — e.g. `https://rpc.sepolia.org` or `https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY`.
   - `YELLOW_WS_URL` — `wss://clearnet-sandbox.yellow.com/ws` (sandbox) or `wss://clearnet.yellow.com/ws` (production).
4. **Optional:** `DEFAULT_ASSET=ETHUSD`, `DEFAULT_AMOUNT=1000000`, `PORT` (Railway sets this automatically).
5. Deploy. Use the generated URL (e.g. `https://your-app.up.railway.app`) as `NEXT_PUBLIC_PREDICTION_API_URL` in the dashboard.

**Health check:** `GET /health` returns `{ "status": "ok" }`. Railway can use this for readiness.

**State:** Markets are stored in `state.json` in the container. On Railway the filesystem is ephemeral — a redeploy clears state. For persistent storage you’d add a DB or Redis later.

---

## Example (local)

**"Will ETH be above $3,500 by end of day?"** — one LONG bet, resolved by current price when you hit Resolve.

## Quick start

1. **Install and env**
   ```bash
   cd apps/backend
   cp .env.example .env
   # Edit .env: set PRIVATE_KEY (wallet with Yellow sandbox funds)
   npm install
   ```

2. **Start the API** (so create-market and frontend can talk to it)
   ```bash
   npm start
   ```
   Server: http://localhost:3999

3. **Create one market** (in another terminal)
   ```bash
   npm run create-market
   ```
   This connects to Yellow sandbox, opens an app session, places the prediction state, and saves the market to `state.json`.

4. **Open kiosk and resolve**
   - Run the kiosk app (`npm run dev` in `apps/kiosk`).
   - Double-click to open the debug view.
   - In **Prediction Market** you’ll see the market and a **Resolve** button.
   - Click **Resolve** → API fetches current ETH price, settles WIN/LOSS, and closes the Yellow app session.

## API

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/markets | List all markets |
| POST | /api/markets | Create market (body: `question`, `asset`, `direction`, `targetPrice?`, `amount?`) |
| POST | /api/markets/:id/resolve | Resolve by current price (optional `?outcome=WIN` or `?outcome=LOSS` to force) |

## Flow

1. **Create market** → Yellow: auth, `create_app_session`, `submit_app_state` (prediction). State saved in `state.json` (and session key for resolve).
2. **Resolve** → API loads market, fetches price (e.g. CoinGecko), computes WIN/LOSS, sends `close_app_session` to Yellow → on-chain settlement.

## Frontend

The kiosk debug view includes a **Prediction Market** panel that lists markets and shows **Resolve** for open ones. API URL: set `VITE_PREDICTION_API_URL` in kiosk `.env` or it defaults to `http://localhost:3999`.
