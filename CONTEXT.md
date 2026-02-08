# Molty — Project Context Document

> This document is designed to give any AI assistant, team member, or contributor
> full context on the Molty project. Read this before writing any code, making
> design decisions, or answering questions about the project.

---

## What is Molty?

Molty is a **physical desk robot** that acts as a **DeFi prediction market agent**. It is being built for **HackMoney 2026**, an ETHGlobal hackathon focused on decentralized finance (Jan 30 – Feb 11, 2026).

Molty sits on your desk, has a screen (showing animated face expressions and live data), two arms (servo motors), wheels (for movement), a microphone (for voice commands), and a speaker (for voice responses). It connects via WebSocket to an **OpenClaw** server running on **AWS EC2**, which serves as its agentic AI brain.

The name "Molty" is a tribute to OpenClaw's history — the project was originally called "Moltbot" (a lobster-themed name) before being renamed to OpenClaw. The mascot is a lobster. 🦞

---

## What Does Molty Do?

Molty is a voice-controlled DeFi assistant. For the hackathon we demo **two flows**:

1. **Swap + profit check:** User says "I want to buy some ETH" → Moltbot swaps USDC to ETH (molty-swap / LI.FI). Later: "Did I make a profit?" → bot checks prices and portfolio, says yes and **celebrates** (face + motors).
2. **Prediction bet (Yellow):** User says they want to bet that e.g. "the best AI this month is Codex" → OpenClaw checks if the market is available and places the bet via Yellow. User asks "What is the status of the bet?" → bot checks Yellow; user loses → bot becomes very sad and **falls off the table** (face `dying`, animation `tableFall`).

Molty also fetches live prices (molty-events), checks wallet balances (molty-portfolio), and follows personality/face rules (molty-soul). The dramatic physical reactions — celebrating on profit, falling off the table on loss — are the signature demo for judges.

---

## Hackathon Context

### Event

- **Name:** HackMoney 2026
- **Organizer:** ETHGlobal
- **Dates:** January 30 – February 11, 2026
- **Format:** Virtual / async hackathon
- **Theme:** DeFi innovations — stablecoin flows, on/offramps, agentic payments

### Prize Strategy

ETHGlobal allows selecting a **maximum of 3 partner prize tracks** (plus finalists, which is automatic for top 10).

**Our 3 selected partners:**

| #   | Partner             | Max Prize | Why                                                                                                                                             |
| --- | ------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Yellow Network**  | $15,000   | Their prize literally lists "prediction market apps" as an example. State channels for gasless instant betting. Highest prize available.        |
| 2   | **Arc (by Circle)** | $10,000   | Their "Agentic Commerce" prize describes exactly what Molty is — autonomous agent executing USDC transactions. Arc is Circle's L1 blockchain.   |
| 3   | **LI.FI**           | $6,000    | Their "AI x LI.FI Smart App" prize fits perfectly — AI agent using LI.FI for cross-chain execution. Enables "fund my bet from any chain/token." |

**Automatic:** HackMoney Finalists — $1,000 USDC per team member + hoodie + $500 flight reimbursement + $10K AWS credits.

**Total potential: $31,000+**

### Partners NOT selected (and why)

- **ENS ($5K):** Pool prize split among all qualifying projects — diluted value per team
- **Uniswap ($10K):** v4 hooks/AMM don't align with prediction markets
- **Sui ($10K):** Requires Move language + entirely different blockchain — too much pivoting

---

## Technical Architecture

### System Overview

```
Physical Robot (ESP32/RPi)
    ↕ WebSocket (wss://)
OpenClaw Server (AWS EC2)
    ↕ APIs
Blockchain Layer (Yellow + Arc + LI.FI)
```

### Layer 1: Physical Robot

- **Microcontroller:** ESP32-S3 or Raspberry Pi (Sahib has hardware ready)
- **Screen:** TFT LCD displaying animated face + live bet data
- **Arms:** 2x SG90 servo motors (up/down movement)
- **Wheels:** 2x DC motors (forward/backward/turn)
- **Audio:** I2S MEMS microphone (input) + speaker (output)
- **Communication:** WebSocket client connecting to EC2 server

The robot is a "thin client" — it captures audio, displays visuals, and moves motors. All intelligence lives on the EC2 server.

### Layer 2: OpenClaw Server (EC2)

OpenClaw is an open-source AI agent framework (https://openclaw.ai) that runs on your own machine. It connects to LLMs (Claude, GPT, DeepSeek), has persistent memory, can execute code, browse the web, and run autonomous tasks via "skills."

For Molty, we deploy OpenClaw with custom skills in `molty/skills/`:

- **molty-soul** — Personality and face directives (always on); defines when to use e.g. `[face:celebrating]` or `[face:dying]`
- **molty-events** — Live crypto prices via Stork oracle (e.g. ETH, BTC)
- **molty-swap** — On-chain token swaps via LI.FI (USDC↔ETH, etc.) — used in the swap flow
- **molty-portfolio** — Wallet token balances across Base, Arbitrum, Polygon

Prediction/betting is implemented via the **backend** Yellow integration (`apps/backend/lib/yellow.js`): check market availability, place bet, check status. OpenClaw or the kiosk calls the backend; see `research/yellow-swap/` for the state-channel lifecycle.

The server also handles:

- **Speech-to-text (STT):** Whisper API — converts robot mic audio to text
- **Text-to-speech (TTS):** Kokoro or ElevenLabs — generates robot voice responses
- **WebSocket server:** Bridges between OpenClaw agent and physical robot

### Layer 3: Blockchain

**LI.FI (Swap flow):** Used for on-chain token swaps when the user says e.g. "I want to buy some ETH." Molty-swap calls LI.FI to execute USDC→ETH (or other pairs) on Base, Arbitrum, or Polygon. Cross-chain routing (e.g. "use my DAI on Arbitrum") is supported the same way.

**Yellow Network (Prediction / bet flow):** Yellow uses state channels (Nitrolite protocol) for off-chain prediction markets. Open state channel / app session, place bet off-chain (instant, gasless), then settle on-chain. For Molty's bet flow: backend checks market availability, places bet, and checks resolution; on loss, robot triggers `dying` + table fall. See `research/yellow-swap/` and `HACK_DEMO.md` (Base mainnet).

**Arc / Circle (Settlement):** USDC settlement; Arc is Circle's L1. Optional for agentic commerce narrative.

---

## Demo Flows (for hackathon video)

We demo **two flows**; see also `ARCHITECTURE.md` Section 1 and Section 6.

**Flow A — Swap and profit check**

1. User: "I want to buy some ETH."
2. Moltbot swaps USDC to ETH (molty-swap / LI.FI).
3. After ~2 minutes: "Did I make a profit?"
4. Bot says yes and celebrates (face `celebrating`, dance).

**Flow B — Prediction bet (Yellow)**

1. User: "I want to bet that the best AI this month is Codex."
2. OpenClaw checks if the market is available and places the bet (Yellow backend).
3. User: "What is the status of the bet?"
4. Bot checks Yellow; user has lost.
5. Bot becomes very sad and falls off the table (face `dying`, animation `tableFall`).

Crypto and 24/7 markets keep the swap flow always demoable; the prediction flow shows Yellow state channels and the memorable table-fall reaction.

---

## Robot Face States

The **molty-soul** skill defines when to use each face (e.g. `celebrating` after profit, `dying` + table fall on bet loss). The screen shows animated eyes/expressions that change based on context:

| State         | When                     | Visual                               |
| ------------- | ------------------------ | ------------------------------------ |
| `idle`        | Default state            | Relaxed blinking eyes, gentle smile  |
| `listening`   | Mic active               | Wide eyes, attentive look            |
| `thinking`    | Processing a command     | Squinting, looking upward            |
| `excited`     | Bet successfully placed  | Stars in eyes, big grin              |
| `watching`    | Tracking live position   | Nervous/tense eyes                   |
| `winning`     | Position is profitable   | Happy eyes, growing smile            |
| `losing`      | Position is unprofitable | Worried, sweating                    |
| `celebrating` | Bet won (final)          | Extreme joy, party mode              |
| `dying`       | Bet lost (final)         | X eyes, spiral — triggers table fall |
| `error`       | Something went wrong     | Confused, dizzy eyes                 |

---

## Motor Animation Sequences

| Animation       | Trigger                       | Sequence                                           |
| --------------- | ----------------------------- | -------------------------------------------------- |
| `dance`         | Win celebration               | Arms up → down → up, wheels forward → back, repeat |
| `nervousWiggle` | Tense moment in live tracking | Small side-to-side wheel movements                 |
| `tableFall`     | Loss — the signature move     | Arms drop, pause, drive forward off table edge     |
| `idle`          | Default                       | Gentle arm breathing motion (loop)                 |

---

## Repository Structure

```
molty/
├── README.md                    # Project overview + demo video
├── ARCHITECTURE.md              # Full technical architecture
├── CONTEXT.md                   # THIS FILE
├── HACK_DEMO.md                 # LI.FI + Yellow on Base demo
├── molty/skills/                # OpenClaw custom skills
│   ├── molty-soul/              # Personality + face directives
│   ├── molty-events/            # Stork price feeds
│   ├── molty-swap/              # LI.FI swaps
│   └── molty-portfolio/         # Wallet balances
├── apps/
│   ├── kiosk/                   # Electron + React (face UI, voice, OpenClaw client)
│   ├── backend/                 # Yellow prediction (lib/yellow.js)
│   └── dashboard/               # Next.js dashboard
├── research/
│   ├── yellow-swap/             # Yellow state-channel scripts
│   └── lifi-swap/               # LI.FI swap scripts
├── scripts/                     # Audio, motors
└── demo/                        # Demo video + screenshots (if present)
```

---

## Tech Stack

| Component           | Technology                              |
| ------------------- | --------------------------------------- |
| Robot controller    | ESP32-S3 or Raspberry Pi                |
| Robot screen        | TFT LCD + custom face renderer          |
| Robot motors        | SG90 servos (arms) + DC motors (wheels) |
| Communication       | WebSocket (wss://)                      |
| Agent brain         | OpenClaw (self-hosted on EC2)           |
| LLM                 | Claude API (via OpenClaw)               |
| Speech-to-text      | Whisper API                             |
| Text-to-speech      | Kokoro / ElevenLabs                     |
| Prediction market   | Yellow SDK + Nitrolite state channels   |
| Cross-chain routing | LI.FI SDK                               |
| Wallet / settlement | Arc (Circle) + USDC                     |
| Hosting             | AWS EC2                                 |
| Face UI             | React / HTML Canvas                     |

---

## Key Integration Details for Each Prize

### Yellow Network ($15K) — What judges want to see:

- Use of Yellow SDK and Nitrolite protocol
- State channel session creation (on-chain)
- Off-chain bet placement (instant, gasless)
- On-chain settlement when session ends
- 2-3 min demo video showing the integration
- GitHub repo link
- Judging criteria: problem/solution clarity, SDK integration depth, business model, presentation, team potential

### Arc / Circle ($10K) — What judges want to see:

- USDC as the settlement currency
- Use of Arc blockchain
- Circle Wallets for programmable wallet
- Autonomous agent decision-making
- Functional MVP + architecture diagram
- Product feedback on Circle tools
- Video demo + GitHub repo

### LI.FI ($6K) — What judges want to see:

- Use of LI.FI SDK/API for cross-chain actions
- Support at least 2 EVM chains
- Clear strategy loop: monitor → decide → act using LI.FI
- Minimal UI or CLI demo with logs
- Video demo + GitHub repo

---

## Builder Context

- **Builder:** Sahib — software engineer at CoinDCX, blockchain/Web3 developer
- **Track record:** Won 3 ETHGlobal hackathons (Prague, New Delhi, Online), one project became EIP-8004
- **Relevant skills:** Solana/blockchain dev, Rust, Go, TypeScript, Docker, APIs
- **Current tools:** Uses Claude for development, familiar with OpenClaw

---

## Important Constraints

1. **Deadline:** Submissions due **Feb 8, 2026** (~24 hours from Feb 7). Plan accordingly.
2. **Max 3 partners:** Already decided — Yellow, Arc, LI.FI
3. **Virtual hackathon:** Demo is via video — robot must work well on camera
4. **Hardware is ready:** Sahib has hardware available, no need to source components
5. **Network-dependent:** Robot needs WiFi for WebSocket to EC2
6. **Demo tip:** If hardware fails on demo day, the face UI works as a standalone web app (fallback plan)

---

## Development Priority Order

1. ~~Architecture & system design doc~~ ✅ DONE
2. Face expressions & animation UI for the screen
3. AI agent logic (voice → intent → bet)
4. Smart contract / prediction market integration (Yellow SDK)
5. Robot firmware code (ESP32/RPi)

The face UI is prioritized because:

- It's the most visible part of the demo
- It works independently of hardware (can demo in browser)
- It demonstrates the "personality" that makes Molty special
- Other components (voice, betting) can use the face UI for visual feedback

---

## 24-Hour Sprint (Submission Feb 8)

**Submission demo = two flows:** (1) Swap USDC→ETH then profit check + celebrate. (2) Bet on "best AI is Codex" via Yellow, status check, lose, table fall.

**Order of attack:**

| Priority | Task                                                                       | Why                                                          |
| -------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1        | **Face UI in kiosk** — all face states + lobster/robot character           | Demo is video; face is the hero. Works without hardware.     |
| 2        | **Agent pipeline** — voice/button → OpenClaw → face state                  | Proves input → swap or bet → face reaction.                  |
| 3        | **Flow A** — LI.FI swap (molty-swap) + profit check (molty-events/portfolio) + celebrate | One clear LI.FI integration.                          |
| 4        | **Flow B** — Yellow bet (backend) + status check + lose → dying + tableFall | One clear Yellow integration; memorable table fall.     |
| 5        | **Demo video** — 2–3 min showing both flows                                 | Required for partners + finalists.                           |
| 6        | **README + repo** — setup, demo link, ARCHITECTURE.md link                  | Submission form needs repo + clarity.                        |

**Face states (molty-soul):** `idle` | `listening` | `thinking` | `excited` | `watching` | `winning` | `losing` | `celebrating` | `dying` | `error`. For the video: idle → thinking → celebrating (Flow A) and dying + table fall (Flow B).

**If time runs out:** A working face UI + a clear 2-min video showing both flows (or one flow in depth) beats an incomplete full stack.

---

_This document should be provided to any AI assistant helping with the Molty project._
_Last updated: February 8, 2026_
