# Molty

**Your DeFi prediction robot powered by OpenClaw.**  
_The only DeFi agent that literally dies for your losses._

Built for **HackMoney 2026** (ETHGlobal). Molty is a voice-controlled desk robot: it swaps tokens via **LI.FI**, places prediction-market bets via **Yellow Network** state channels, and physically reacts — celebrating when you profit, falling off the table when you lose.

---

## What Molty Does

- **Swap flow:** You say _"I want to buy some ETH"_ → Molty swaps your USDC to ETH (LI.FI). Later: _"Did I make a profit?"_ → Molty checks and celebrates.
- **Bet flow:** You say _"I want to bet that the best AI this month is Codex"_ → OpenClaw checks Yellow, places the bet. _"What’s the status?"_ → Molty checks; if you lost, it gets very sad and falls off the table.

The brain runs on **OpenClaw** (LLM + skills); the kiosk app is the face, voice, and client. Integrations: **Yellow** (prediction markets, state channels), **LI.FI** (on-chain swaps), **Stork** (prices).

---

## Quick Start

```bash
pnpm install
cp apps/kiosk/.env.sample apps/kiosk/.env
pnpm dev
```

Then open the kiosk (Electron or browser). Configure `.env` with your OpenClaw gateway URL and keys as in the sample.

---

## OpenClaw (Molty’s brain)

Deploy OpenClaw to your server and point the kiosk at it. Example deploy:

```bash
sh molty/deploy.sh YOUR_SERVER_IP /path/to/your.pem
```

On the server, set env vars so the gateway has API keys and wallet:

```bash
openclaw config set env.vars.STORK_API_KEY "YOUR_STORK_KEY"
openclaw config set env.vars.PRIVATE_KEY "YOUR_PRIVATE_KEY"
openclaw config set env.vars.LIFI_API_KEY "YOUR_LIFI_API_KEY"
openclaw gateway restart
```

Skills live in `molty/skills/` (molty-soul, molty-events, molty-swap, molty-portfolio). Prediction/betting uses the backend Yellow integration (`apps/backend`, `research/yellow-swap`).

---

## Repo Overview

| Path                    | Purpose                                                  |
| ----------------------- | -------------------------------------------------------- |
| `molty/skills/`         | OpenClaw skills (swap, events, portfolio, soul)          |
| `apps/kiosk/`           | Electron + React app (face UI, voice, OpenClaw client)   |
| `apps/backend/`         | WebSocket + Yellow prediction (e.g. `lib/yellow.js`)     |
| `research/yellow-swap/` | Yellow state-channel scripts (sandbox + production Base) |
| `research/lifi-swap/`   | LI.FI swap scripts                                       |

---

## Docs

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — System design, demo flows, data flow, prizes
- **[CONTEXT.md](CONTEXT.md)** — Project context for contributors and AI
- **[HACK_DEMO.md](HACK_DEMO.md)** — LI.FI on Base + Yellow on Base demo

---

## Prizes (HackMoney 2026)

- **Yellow Network** — prediction markets, state channels
- **LI.FI** — AI agent using LI.FI for swaps
- **Arc (Circle)** — agentic commerce, USDC
- **Finalists** — top 10 teams

---

_Molty — powered by OpenClaw, Yellow Network, LI.FI, and pure degen energy._
