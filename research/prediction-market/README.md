# Our Own Prediction Market

Simple **create-your-own market** flow: create a market (script or API), place the bet off-chain via Yellow, then **resolve with one click** in the kiosk frontend.

## Example

**"Will ETH be above $3,500 by end of day?"** — one LONG bet, resolved by current price when you hit Resolve.

## Quick start

1. **Install and env**
   ```bash
   cd research/prediction-market
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
