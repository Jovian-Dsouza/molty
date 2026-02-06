# 🦞 Molty — Architecture & System Design

### _Your DeFi Prediction Robot Powered by OpenClaw_

**HackMoney 2026 | ETHGlobal**

---

## 1. Project Overview

**Molty** is a physical desk robot that acts as your personal DeFi prediction market agent. It listens to your voice, fetches live market data, places onchain bets on your behalf using state channels for instant settlement, tracks your positions in real-time, and physically reacts to outcomes — dancing when you win, and dramatically falling off the table when you lose.

The name is a tribute to OpenClaw's heritage — the project was originally called "Moltbot" before becoming OpenClaw. Molty is the lobster that bets, dances, and occasionally dies for your portfolio.

The robot's brain runs on **OpenClaw** (deployed on AWS EC2), giving it autonomous agentic capabilities — browsing, executing transactions, remembering context, and managing your DeFi positions 24/7.

### Tagline

> _"The only DeFi agent that literally dies for your losses."_

### Demo Flow (Judges Pitch)

```
[Molty is sitting on desk, idle face, showing wallet balance on screen]

You:     "Hey Molty, what's ETH trading at?"
Molty:   [Eyes light up] "ETH is at $3,247, up 2.1% today!"
         [Screen shows mini price chart]

You:     "I think it's going higher. Bet 50 USDC that ETH
          hits $3,300 in the next hour."
Molty:   [Thinking face] "Placing bet... 50 USDC on ETH above
          $3,300 by 4:30 PM. Odds: 2.1x. Potential payout: $105."
         [Screen: bet confirmation + countdown timer]

You:     "Actually, use my DAI on Arbitrum for this."
Molty:   [Processing] "Routing via LI.FI... swapping DAI on
          Arbitrum to USDC on Polygon... Done! Bet funded."
         [Screen shows cross-chain route animation]

[TIME PASSES — Molty shows live ETH price on screen,
 face shifts between nervous/excited as price moves]

--- ETH HITS $3,300 ---
Molty:   [ARMS UP, DANCING, PARTY FACE 🎉]
         "WE WON! +$105 USDC settled to your wallet! 🦞"
         [Screen shows confetti + P&L]

--- OR: ETH STAYS BELOW ---
Molty:   [Sad face, arms droop, slowly drives forward...]
         "I... I believed in ETH..."
         [Falls off table] 💀
```

### Why This Demo Works for Judges

- **Always live** — crypto trades 24/7, judges can verify ETH price in real-time
- **Judges are crypto people** — they care about ETH, not cricket scores
- **Shows cross-chain** — "use my DAI on Arbitrum" naturally demos LI.FI
- **Short timeframe** — "next hour" shows the full lifecycle in a demo video
- **Universally relatable** — everyone in DeFi has opinions on price direction

> **Note:** Molty is general-purpose — sports betting (cricket, football, etc.),
> election outcomes, and any prediction market event all work. Crypto price
> predictions are chosen for the demo because they're always available and
> resonate best with ETHGlobal judges.

---

## 2. Target Prizes (3 Partner Slots + Finalists)

ETHGlobal allows a maximum of 3 partner selections. Finalists is automatic.

| Prize                   | Amount                | Fit          | Why Selected                                                                                      |
| ----------------------- | --------------------- | ------------ | ------------------------------------------------------------------------------------------------- |
| **Yellow Network**      | $15,000               | 🎯 PARTNER 1 | Prediction market is their listed example. State channels = gasless instant bets. Highest prize.  |
| **Arc (Circle)**        | $10,000               | 🎯 PARTNER 2 | "Agentic Commerce" prize is literally Molty — autonomous agent executing USDC txns.               |
| **LI.FI**               | $6,000                | 🎯 PARTNER 3 | "AI x LI.FI Smart App" — AI agent using LI.FI for cross-chain execution. Low effort, high impact. |
| **HackMoney Finalists** | $1,000/member + perks | 🏆 AUTO      | Physical robot demo is instant finalist material. Top 10 teams.                                   |

**Total potential: $31,000+ plus finalist perks (hoodie, $500 flight, $10K AWS credits)**

### Partners NOT Selected (and why)

- **ENS ($5K):** Pool prize split among ALL qualifying projects — diluted value. Not worth a partner slot.
- **Uniswap ($10K):** v4 hooks/AMM don't align with what Molty does. Would feel forced.
- **Sui ($10K):** Requires Move language + entirely different chain. Too much pivoting for 3 days.

---

## 3. High-Level Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    PHYSICAL ROBOT                        │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐              │
│  │  Screen   │  │  Motors  │  │   Mic    │              │
│  │ (TFT/LCD)│  │(Arms +   │  │(Audio In)│              │
│  │  Faces   │  │ Wheels)  │  │          │              │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘              │
│       │              │              │                    │
│  ┌────┴──────────────┴──────────────┴────┐              │
│  │     Microcontroller (ESP32 / RPi)     │              │
│  │     - Renders face animations         │              │
│  │     - Controls servo/DC motors        │              │
│  │     - Captures audio                  │              │
│  │     - WebSocket client to EC2         │              │
│  └───────────────────┬───────────────────┘              │
└──────────────────────┼──────────────────────────────────┘
                       │ WebSocket (wss://)
                       │
┌──────────────────────┼──────────────────────────────────┐
│              AWS EC2 INSTANCE                            │
│  ┌───────────────────┴───────────────────┐              │
│  │           OpenClaw Gateway              │              │
│  │  - Receives voice/text commands        │              │
│  │  - LLM reasoning (Claude/GPT)         │              │
│  │  - Skill execution engine             │              │
│  │  - Persistent memory                  │              │
│  └───────┬──────────┬──────────┬─────────┘              │
│          │          │          │                         │
│  ┌───────┴───┐ ┌────┴────┐ ┌──┴──────────┐             │
│  │  Speech   │ │  DeFi   │ │   Robot     │             │
│  │  Engine   │ │  Skills │ │   Control   │             │
│  │           │ │         │ │   Skill     │             │
│  │ STT:Whisper│ │-Yellow  │ │             │             │
│  │ TTS:Kokoro│ │ SDK     │ │-Face states │             │
│  │           │ │-LI.FI   │ │-Motor cmds  │             │
│  │           │ │-Arc/    │ │-Animations  │             │
│  │           │ │ Circle  │ │             │             │
│  │           │ │-Events  │ │             │             │
│  └───────────┘ └─────────┘ └─────────────┘             │
│                                                         │
│  ┌─────────────────────────────────────────┐            │
│  │         Wallet & Key Management          │            │
│  │  - User's wallet (delegated session)    │            │
│  │  - Yellow state channel session         │            │
│  │  - Transaction signing                  │            │
│  └─────────────────────────────────────────┘            │
└─────────────────────────────────────────────────────────┘
                       │
                       │ On-chain
                       ▼
┌─────────────────────────────────────────────────────────┐
│                   BLOCKCHAIN LAYER                       │
│                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │   Yellow      │  │   LI.FI     │  │    Arc       │  │
│  │   Nitrolite   │  │   Router    │  │   (Circle)   │  │
│  │              │  │              │  │              │  │
│  │ State channel │  │ Cross-chain │  │ USDC settle- │  │
│  │ for instant  │  │ asset       │  │ ment layer   │  │
│  │ off-chain    │  │ routing     │  │ + Circle     │  │
│  │ bets         │  │ for funding │  │ Wallets      │  │
│  └──────────────┘  └──────────────┘  └──────────────┘  │
│                                                         │
│  Settlement chains: Arc, Polygon, Base, Arbitrum, EVM   │
└─────────────────────────────────────────────────────────┘
```

---

## 4. Component Breakdown

### 4.1 Physical Robot (Hardware Layer)

**Purpose:** Physical embodiment of the DeFi agent. Provides voice I/O, visual feedback (face + data), and physical reactions.

| Component | Hardware                              | Purpose                                   |
| --------- | ------------------------------------- | ----------------------------------------- |
| Brain     | ESP32-S3 or Raspberry Pi              | Main controller, WiFi, WebSocket client   |
| Screen    | TFT LCD (2.4" - 3.5") or phone screen | Face expressions + live bet data          |
| Arms      | 2x SG90 Servo motors                  | Up/down for dance/celebration             |
| Movement  | 2x DC motors + wheels                 | Forward/backward, the dramatic table fall |
| Audio In  | I2S MEMS Microphone (INMP441)         | Voice capture                             |
| Audio Out | Small speaker + I2S DAC               | Robot voice responses                     |
| Power     | LiPo battery or USB-C                 | Portable operation                        |

**Communication Protocol:**

```
Robot ←→ EC2: WebSocket (wss://)

Messages FROM EC2 to Robot:
  { type: "face",    state: "happy" | "sad" | "thinking" | "excited" | "dead" }
  { type: "screen",  data: { odds: "1.8x", position: "+$80", event: "RCB vs MI" } }
  { type: "motors",  action: "dance" | "forward" | "backward" | "fall" | "arms_up" | "arms_down" }
  { type: "audio",   data: "<base64 audio>" }

Messages FROM Robot to EC2:
  { type: "audio",   data: "<base64 audio from mic>" }
  { type: "button",  action: "confirm" | "cancel" }
  { type: "status",  battery: 85, connected: true }
```

### 4.2 OpenClaw Server (EC2 — Brain Layer)

**Purpose:** The agentic brain. Runs OpenClaw with custom skills for DeFi operations and robot control.

**Deployment:**

- AWS EC2 instance (t3.medium or larger)
- OpenClaw installed via CLI
- Custom skills directory for Molty-specific capabilities
- WebSocket server for robot communication

**Custom OpenClaw Skills:**

```
~/.openclaw/skills/
├── molty-betting/          # Core betting skill
│   ├── skill.md               # Skill definition
│   └── index.ts               # Yellow SDK integration
├── molty-events/           # Event data fetching
│   ├── skill.md
│   └── index.ts               # Sports/events API
├── molty-robot/            # Robot hardware control
│   ├── skill.md
│   └── index.ts               # WebSocket → robot commands
├── molty-portfolio/        # Position tracking
│   ├── skill.md
│   └── index.ts               # Monitor bets, trigger reactions
├── molty-crosschain/       # LI.FI integration
│   ├── skill.md
│   └── index.ts               # Cross-chain funding
└── molty-wallet/              # Arc/Circle wallet
    ├── skill.md
    └── index.ts               # Circle Wallets + USDC settlement
```

### 4.3 Yellow SDK Integration (Primary Prize Target)

**Purpose:** Gasless, instant prediction market bets via state channels.

**Flow:**

```
1. USER: "Bet 100 USDC on RCB winning"
2. OpenClaw parses intent → calls molty-betting skill
3. Skill opens Yellow state channel session (one-time on-chain tx)
4. All bets happen OFF-CHAIN through Yellow Nitrolite protocol
   - Instant confirmation
   - Zero gas fees
   - Session-based allowance (user sets max spend)
5. When match ends (or user exits):
   - Final balances settled ON-CHAIN via smart contract
   - Winner receives USDC to wallet
6. Robot reacts to outcome
```

**Key Yellow Concepts Used:**

- **State Channels:** Lock funds once, transact unlimited times off-chain
- **Session Allowance:** User defines max bet amount per session
- **On-chain Settlement:** Only 2 transactions (open + close channel)
- **Nitrolite Protocol:** Manages off-chain state between parties

**Integration Points:**

```javascript
// Pseudo-code for Yellow SDK usage
import { YellowSDK, NitroliteClient } from "@aspect-build/yellow-sdk";

// 1. Initialize session
const session = await YellowSDK.createSession({
  wallet: userWallet,
  allowance: "500", // Max 500 USDC per session
  token: "USDC",
  network: "polygon", // or any EVM chain
});

// 2. Place bet (off-chain, instant)
const bet = await session.createTransaction({
  type: "prediction",
  event: "RCB_vs_MI_2026_02_07",
  outcome: "RCB_WIN",
  amount: "100", // 100 USDC
  odds: 1.8,
});

// 3. Monitor position (off-chain state)
const position = await session.getPosition(bet.id);
// { status: 'active', potential_payout: 180, current_odds: 1.75 }

// 4. Settlement (on-chain, when match ends)
const result = await session.settle();
// Final USDC balance returned to user's wallet
```

### 4.4 LI.FI Integration (Cross-Chain Funding)

**Purpose:** Allow users to fund bets from ANY chain/token. User has ETH on Arbitrum but wants to bet USDC on Polygon? LI.FI handles it.

```
User: "Bet 100 USDC on RCB — use my ETH on Arbitrum"

Flow:
1. LI.FI SDK fetches best route: ETH (Arbitrum) → USDC (Polygon)
2. Swap + bridge in one transaction
3. USDC arrives on Polygon → deposited into Yellow state channel
4. Bet placed instantly
```

### 4.5 Arc (Circle) Integration

**Purpose:** USDC settlement layer + agentic commerce infrastructure.

- **USDC as base currency:** All bets denominated and settled in USDC
- **Circle Wallets:** Programmable wallet for Molty's autonomous transactions
- **Arc L1:** Settlement chain for final bet outcomes
- **Agentic Commerce:** Molty autonomously decides, executes, and settles — the core Arc narrative

```javascript
// Pseudo-code for Arc/Circle integration
import { CircleWallets } from "@circle-fin/wallets";

// Create a programmable wallet for Molty
const moltyWallet = await CircleWallets.create({
  blockchain: "ARC",
  accountType: "SCA", // Smart Contract Account
});

// Autonomous USDC transfer on bet settlement
await moltyWallet.transfer({
  to: userWalletAddress,
  amount: "105.00",
  token: "USDC",
});
```

### 4.6 Speech Pipeline

```
┌─────────┐    ┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│  Robot   │───▶│  EC2 Server  │───▶│   Whisper    │───▶│  OpenClaw    │
│  Mic     │    │  (WebSocket) │    │   (STT)      │    │  (LLM Agent) │
└─────────┘    └──────────────┘    └──────────────┘    └──────┬───────┘
                                                              │
┌─────────┐    ┌──────────────┐    ┌──────────────┐          │
│  Robot   │◀──│  EC2 Server  │◀──│   Kokoro /   │◀─────────┘
│  Speaker │    │  (WebSocket) │    │   ElevenLabs │
└─────────┘    └──────────────┘    │   (TTS)      │
                                   └──────────────┘
```

**STT Options:**

- OpenAI Whisper API (fastest, most accurate)
- Local Whisper on EC2 (free, slower)
- Deepgram (real-time streaming)

**TTS Options:**

- Kokoro (open source, great quality)
- ElevenLabs (best quality, paid)
- OpenAI TTS (good middle ground)

---

## 5. Robot Face & Screen States

### Face Expression States

| State         | Trigger             | Face                          | Screen Data            |
| ------------- | ------------------- | ----------------------------- | ---------------------- |
| `idle`        | Default             | 😊 Relaxed eyes, gentle blink | Clock + wallet balance |
| `listening`   | Mic active          | 👀 Wide eyes, attentive       | "Listening..."         |
| `thinking`    | Processing command  | 🤔 Squinting, looking up      | "Processing..."        |
| `excited`     | Bet placed          | 🤩 Stars in eyes              | Bet details + odds     |
| `watching`    | Live event tracking | 😬 Nervous eyes               | Live position + P&L    |
| `winning`     | Bet winning         | 🎉 Party eyes, big smile      | "+$180 🚀"             |
| `losing`      | Bet losing          | 😰 Worried eyes               | "-$100 📉"             |
| `celebrating` | Final win           | 🥳 Extreme joy                | Final P&L + confetti   |
| `dying`       | Final loss          | 😵 X eyes, spiral             | "Rug... pulled..."     |
| `error`       | Something broke     | 😵‍💫 Confused eyes              | Error message          |

### Motor Animation Sequences

```javascript
const ANIMATIONS = {
  dance: {
    description: "Victory celebration",
    sequence: [
      { arms: "up", wheels: "forward", duration: 300 },
      { arms: "down", wheels: "backward", duration: 300 },
      { arms: "up", wheels: "forward", duration: 300 },
      { arms: "down", wheels: "stop", duration: 200 },
      { arms: "up", wheels: "stop", duration: 500 }, // final pose
    ],
  },

  nervousWiggle: {
    description: "During tense moments in live event",
    sequence: [
      { arms: "mid", wheels: "left", duration: 150 },
      { arms: "mid", wheels: "right", duration: 150 },
      { arms: "mid", wheels: "left", duration: 150 },
      { arms: "mid", wheels: "stop", duration: 200 },
    ],
  },

  tableFall: {
    description: "Dramatic death on loss — drives off table edge",
    sequence: [
      { arms: "down", wheels: "stop", duration: 1000, face: "losing" },
      { arms: "down", wheels: "stop", duration: 500, face: "dying" },
      { arms: "drop", wheels: "forward", duration: 2000, face: "dying" },
      // Robot drives forward off table. RIP. 🦞
    ],
  },

  idle: {
    description: "Gentle breathing motion",
    sequence: [
      { arms: "slight_up", wheels: "stop", duration: 2000 },
      { arms: "slight_down", wheels: "stop", duration: 2000 },
    ],
    loop: true,
  },
};
```

---

## 6. Data Flow — Complete Bet Lifecycle

```
Step 1: VOICE INPUT
━━━━━━━━━━━━━━━━━━
User speaks → Robot mic captures audio → WebSocket → EC2
EC2 runs Whisper STT → text: "Bet 100 USDC that RCB wins tonight"

Step 2: INTENT PARSING (OpenClaw + LLM)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OpenClaw agent processes text → extracts:
  {
    action: "place_bet",
    amount: 100,
    currency: "USDC",
    event: "cricket",
    team: "RCB",
    outcome: "win",
    opponent: "Mumbai Indians",
    date: "tonight"
  }

Step 3: EVENT VALIDATION
━━━━━━━━━━━━━━━━━━━━━━━
molty-events skill queries sports API:
  → Confirms: RCB vs MI, Feb 7 2026, 7:30 PM IST
  → Fetches current odds: RCB win @ 1.8x
  → Returns event_id for prediction market

Step 4: CROSS-CHAIN FUNDING (if needed, via LI.FI)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
If user's USDC is on wrong chain:
  LI.FI SDK routes assets to correct chain
  → Swap/bridge in single tx

Step 5: BET PLACEMENT (Yellow SDK)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
molty-betting skill:
  → Opens Yellow state channel (if not already open)
  → Places off-chain bet: 100 USDC on RCB @ 1.8x
  → Instant confirmation, zero gas

Step 6: ROBOT REACTION — BET PLACED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
EC2 → Robot:
  face: "excited"
  screen: { event: "RCB vs MI", bet: "100 USDC", odds: "1.8x", payout: "180 USDC" }
  audio: TTS("Bet placed! 100 USDC on RCB at 1.8x odds. Let's go!")
  motors: arms_up briefly

Step 7: LIVE POSITION TRACKING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
molty-portfolio skill polls every 30s:
  → Fetches live odds changes
  → Calculates current position value
  → Sends updates to robot screen
  Robot face toggles between "watching" and "nervousWiggle"

Step 8a: WIN → CELEBRATION
━━━━━━━━━━━━━━━━━━━━━━━━━
Event resolves: RCB wins
  → Yellow state channel settles on-chain
  → 180 USDC sent to user wallet
  → Robot: face="celebrating", animation="dance", audio="WE WON!"

Step 8b: LOSS → DRAMATIC DEATH
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Event resolves: RCB loses
  → Yellow state channel settles (0 USDC back)
  → Robot: face="dying", audio="Rug... pulled..."
  → animation="tableFall" → Robot drives off table 💀
```

---

## 7. Tech Stack Summary

| Layer             | Technology                  | Purpose                       |
| ----------------- | --------------------------- | ----------------------------- |
| **Hardware**      | ESP32-S3 / Raspberry Pi     | Robot controller              |
| **Screen**        | TFT LCD + custom renderer   | Face + data display           |
| **Motors**        | SG90 servos + DC motors     | Arms + wheels                 |
| **Communication** | WebSocket (wss://)          | Robot ↔ EC2                   |
| **Agent Brain**   | OpenClaw on EC2             | Agentic AI orchestration      |
| **LLM**           | Claude API (via OpenClaw)   | Intent parsing + conversation |
| **STT**           | Whisper API                 | Speech to text                |
| **TTS**           | Kokoro / ElevenLabs         | Text to speech                |
| **Betting**       | Yellow SDK + Nitrolite      | Off-chain prediction market   |
| **Cross-chain**   | LI.FI SDK                   | Multi-chain asset routing     |
| **Wallet**        | Arc / Circle Wallets        | Programmable USDC wallet      |
| **Settlement**    | USDC on Arc / Polygon / EVM | Final on-chain settlement     |
| **Hosting**       | AWS EC2                     | OpenClaw server               |
| **Face UI**       | React / HTML Canvas         | Animated face expressions     |

---

## 8. Repository Structure

```
molty/
├── README.md                    # Project overview + demo video link
├── docs/
│   ├── architecture.md          # This document
│   └── prize-submission.md      # Prize-specific submission notes
│
├── robot/                       # Hardware firmware
│   ├── src/
│   │   ├── main.cpp             # Entry point (ESP32) or main.py (RPi)
│   │   ├── websocket_client.h   # WebSocket connection to EC2
│   │   ├── motor_controller.h   # Servo + DC motor control
│   │   ├── screen_renderer.h    # Face + data rendering
│   │   ├── audio_capture.h      # Mic → audio buffer
│   │   └── animations.h         # Predefined animation sequences
│   ├── platformio.ini           # Build config (ESP32)
│   └── wiring-diagram.png       # Hardware connections
│
├── server/                      # EC2 backend
│   ├── index.ts                 # WebSocket server + router
│   ├── speech/
│   │   ├── stt.ts               # Whisper integration
│   │   └── tts.ts               # TTS integration
│   └── ws/
│       └── robot-bridge.ts      # WebSocket handler for robot
│
├── skills/                      # OpenClaw custom skills
│   ├── molty-betting/
│   │   ├── skill.md
│   │   └── index.ts             # Yellow SDK + Nitrolite
│   ├── molty-events/
│   │   ├── skill.md
│   │   └── index.ts             # Sports/events data
│   ├── molty-robot/
│   │   ├── skill.md
│   │   └── index.ts             # Robot control commands
│   ├── molty-portfolio/
│   │   ├── skill.md
│   │   └── index.ts             # Position monitoring
│   ├── molty-crosschain/
│   │   ├── skill.md
│   │   └── index.ts             # LI.FI integration
│   └── molty-wallet/
│       ├── skill.md
│       └── index.ts             # Arc/Circle wallet + USDC
│
├── face-ui/                     # Robot face web app
│   ├── index.html               # Single-file face renderer
│   ├── faces/                   # Face state SVGs/animations
│   └── data-overlay/            # Bet data display components
│
├── contracts/                   # Smart contracts (if custom)
│   └── MoltySettlement.sol   # Settlement logic
│
└── demo/
    ├── demo-video.mp4           # 2-3 min demo for submission
    └── screenshots/             # UI screenshots
```

---

## 9. Development Priorities (Hackathon Timeline)

Given submissions are due ~Feb 10-11:

### Day 1 (Today, Feb 7) — Foundation

- [x] Architecture doc ← YOU ARE HERE
- [ ] Set up EC2 instance + install OpenClaw
- [ ] Face UI prototype (HTML Canvas / React) — can demo without hardware
- [ ] WebSocket server skeleton

### Day 2 (Feb 8) — Core Integration

- [ ] Yellow SDK integration — create state channel, place mock bet
- [ ] OpenClaw skill for betting + events
- [ ] Face animation system (all states working)
- [ ] Connect robot hardware to WebSocket

### Day 3 (Feb 9) — Polish & Extras

- [ ] LI.FI cross-chain funding integration
- [ ] Arc / Circle Wallets USDC settlement
- [ ] Live position tracking on screen
- [ ] Motor animations (dance, fall, idle)
- [ ] End-to-end test of full bet lifecycle

### Day 4 (Feb 10) — Demo & Submit

- [ ] Record 2-3 min demo video
- [ ] Write submission descriptions for each prize track
- [ ] Clean up README
- [ ] Submit on ETHGlobal dashboard

---

## 10. Hackathon Submission Strategy

### For Yellow Network Prize ($15K):

**Emphasize:** State channel usage, off-chain bet execution, session-based allowance, on-chain settlement. Show the "chess game" analogy they mention — Molty does unlimited bet interactions off-chain with just 2 on-chain txns. Include 2-3 min demo video and repo link as required.

### For Arc Agentic Commerce ($2.5K) + Chain Abstracted ($5K):

**Emphasize:** Autonomous agent (OpenClaw) making decisions, executing transactions, managing risk — all settled in USDC on Arc. Molty IS the agent, physically embodied. Show functional MVP + architecture diagram. Apply to BOTH Arc prize tracks — agentic commerce AND chain-abstracted USDC apps (via LI.FI cross-chain routing).

### For LI.FI AI Smart App ($2K):

**Emphasize:** AI-powered agent using LI.FI as cross-chain execution layer. Molty monitors state, decides routing, acts using LI.FI. The "use my DAI on Arbitrum" moment in the demo is the money shot. Provide CLI/script demo with logs + video.

### For Finalists (Top 10):

**Emphasize:** Creativity (physical robot!), functionality, technical difficulty (OpenClaw + Yellow + LI.FI + Arc + hardware), impact. The demo video with the robot falling off the table will be unforgettable.

---

## 11. Key Risks & Mitigations

| Risk                                 | Impact                    | Mitigation                                                               |
| ------------------------------------ | ------------------------- | ------------------------------------------------------------------------ |
| Hardware issues on demo day          | Can't show physical robot | Build face UI as standalone web app — can demo just the screen           |
| Yellow SDK integration complexity    | Can't place real bets     | Use Yellow test environment; mock if needed, show architecture           |
| No live cricket match during judging | Can't show live tracking  | Pre-record demo with real data; use any live event (crypto prices, etc.) |
| Robot falls and breaks               | No dramatic death scene   | Use foam/cushion below table; or just show video of the fall             |
| OpenClaw EC2 latency                 | Slow voice response       | Optimize with streaming STT/TTS; keep EC2 in same region                 |

---

_Built with 🦞 by Sahib for HackMoney 2026_
_Molty — Powered by OpenClaw, Yellow Network, Arc (Circle), LI.FI, and pure degen energy_
