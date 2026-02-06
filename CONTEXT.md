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

Molty is a voice-controlled DeFi trading assistant. The core use case:

1. **User speaks to Molty** — e.g., "Hey Molty, what's ETH trading at?"
2. **Molty fetches live data** — queries market data APIs, returns current price
3. **User places a bet** — "Bet 50 USDC that ETH hits $3,300 in the next hour"
4. **Molty executes the bet onchain** — uses Yellow Network state channels for gasless, instant off-chain betting with on-chain settlement
5. **Molty tracks the position live** — shows real-time P&L, odds changes on its screen
6. **Molty physically reacts to the outcome:**
   - **WIN:** Arms go up, dances (wheels move), screen shows party face 🎉, announces winnings
   - **LOSS:** Sad face, arms drop, robot drives forward off the edge of the table and falls off (dramatic "death") 💀

The dramatic physical reactions are the signature feature — it's what makes Molty memorable and demo-worthy for hackathon judges.

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

For Molty, we deploy OpenClaw on an EC2 instance with custom skills:

- **molty-betting** — Yellow SDK integration for placing/settling prediction market bets
- **molty-events** — Fetches live market data (crypto prices, sports events)
- **molty-robot** — Sends commands to the physical robot (face states, motor animations, screen data)
- **molty-portfolio** — Monitors active positions, triggers reactions on outcome
- **molty-crosschain** — LI.FI SDK for routing assets across chains
- **molty-wallet** — Arc/Circle Wallets for USDC settlement

The server also handles:

- **Speech-to-text (STT):** Whisper API — converts robot mic audio to text
- **Text-to-speech (TTS):** Kokoro or ElevenLabs — generates robot voice responses
- **WebSocket server:** Bridges between OpenClaw agent and physical robot

### Layer 3: Blockchain

**Yellow Network (Primary):**
Yellow uses state channels (Nitrolite protocol) for off-chain transactions. Think of it like a bar tab — you "open a tab" (lock USDC in a state channel), make unlimited transactions off-chain (instant, gasless), and "close the tab" (settle final balance on-chain). For Molty:

- Open state channel = 1 on-chain tx
- Place bets = unlimited off-chain txns (instant, no gas)
- Settle outcomes = 1 on-chain tx
- Total: 2 on-chain txns regardless of how many bets placed

**Arc / Circle (Settlement):**
Arc is Circle's L1 blockchain, EVM-compatible. USDC is the native settlement currency. Circle Wallets provide programmable wallets for Molty's autonomous transactions.

**LI.FI (Cross-chain routing):**
LI.FI aggregates DEXs and bridges. If a user's funds are on the wrong chain (e.g., DAI on Arbitrum but needs USDC on Polygon), LI.FI routes the swap+bridge in a single transaction.

---

## Demo Flow (for hackathon video)

The demo uses **crypto price predictions** because:

- Crypto trades 24/7 (always live during judging)
- ETHGlobal judges are crypto people (they care about ETH price)
- Short timeframes work ("next hour" shows full lifecycle)

```
[Molty on desk, idle face, screen shows wallet balance]

User: "Hey Molty, what's ETH trading at?"
Molty: [Eyes light up] "ETH is at $3,247, up 2.1% today!"
       [Screen shows mini price chart]

User: "Bet 50 USDC that ETH hits $3,300 in the next hour."
Molty: [Thinking face] "Placing bet... 50 USDC on ETH above $3,300
       by 4:30 PM. Odds: 2.1x. Potential payout: $105."
       [Screen shows bet details + countdown]

User: "Actually, use my DAI on Arbitrum for this."
Molty: [Processing] "Routing via LI.FI... swapping DAI on Arbitrum
       to USDC on Polygon... Done! Bet funded."
       [Shows cross-chain route on screen]

[TIME PASSES — screen shows live ETH price, face shifts
 between nervous/excited as price moves up and down]

--- IF ETH HITS $3,300 (WIN) ---
Molty: [ARMS UP, DANCING, PARTY FACE 🎉]
       "WE WON! +$105 USDC settled to your wallet! 🦞"
       [Screen: confetti + final P&L]

--- IF ETH STAYS BELOW (LOSS) ---
Molty: [Sad face, arms droop...]
       "I... I believed in ETH..."
       [Drives forward off table edge, falls] 💀
```

Molty is general-purpose — sports betting, election outcomes, any prediction market event works. Crypto is chosen purely for the demo because it resonates with judges.

---

## Robot Face States

The screen shows animated eyes/expressions that change based on context:

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
├── docs/
│   ├── architecture.md          # Full technical architecture
│   └── context.md               # THIS FILE
├── robot/                       # Hardware firmware (ESP32/RPi)
│   └── src/                     # Motor control, screen, WebSocket, audio
├── server/                      # EC2 backend (WebSocket + speech)
├── skills/                      # OpenClaw custom skills
│   ├── molty-betting/           # Yellow SDK + Nitrolite
│   ├── molty-events/            # Market data APIs
│   ├── molty-robot/             # Robot hardware commands
│   ├── molty-portfolio/         # Position monitoring
│   ├── molty-crosschain/        # LI.FI SDK
│   └── molty-wallet/            # Arc/Circle Wallets
├── face-ui/                     # Robot face web app (HTML Canvas/React)
├── contracts/                   # Smart contracts (if needed)
└── demo/                        # Demo video + screenshots
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

**Current state:** Kiosk app = default Vite template. No face UI yet. Architecture docs done.

**Order of attack:**

| Priority | Task                                                                       | Why                                                          |
| -------- | -------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 1        | **Face UI in kiosk** — all face states + simple lobster/robot character    | Demo is video; face is the hero. Works without hardware.     |
| 2        | **Stub or minimal agent** — e.g. button/voice trigger → set face state     | Proves pipeline: input → face reaction.                      |
| 3        | **One prize integration** — Yellow OR Arc OR LI.FI, even minimal           | Judges want to see _one_ clear integration; depth > breadth. |
| 4        | **Demo video** — 2–3 min with face states + one onchain/cross-chain moment | Required for all three partners + finalists.                 |
| 5        | **README + repo** — setup, demo link, architecture link                    | Submission form needs repo + clarity.                        |

**Face states to implement (from spec):** `idle` | `listening` | `thinking` | `excited` | `watching` | `winning` | `losing` | `celebrating` | `dying` | `error`. Start with idle → thinking → celebrating/dying for the video.

**If time runs out:** A working face UI + a clear 2-min video explaining architecture and showing one integration beats an incomplete full stack.

---

_This document should be provided to any AI assistant helping with the Molty project.
Last updated: February 7, 2026_
