# How the Off-Chain Prediction Flow Works

## TL;DR

**Deposit** → money sits in the **Custody contract** on-chain.  
**Off-chain** → you talk to **ClearNode** (Yellow’s server) over WebSocket. It keeps a **ledger** of your balance and runs **state channels** (app sessions).  
**Prediction betting** → happens entirely **off-chain**: you send prediction messages and state updates over the WebSocket; **no gas**, no new on-chain txs until settlement.  
**Settlement** → you send a **close_app_session** with the final outcome; ClearNode (with the broker) settles on-chain and updates the Custody balances.

---

## 1. After You Deposit: Where Does the Money Live?

```
You (wallet)  --[deposit tx]-->  Custody contract (on Base/Sepolia/etc.)
                                       |
                                       |  "This address has X USDC in custody"
                                       v
                              On-chain balance for your address
```

- The **Custody contract** is an on-chain contract (e.g. on Base).
- When you **deposit**, you send USDC to the contract; the contract records: *“address X has amount Y of token Z.”*
- Nothing has moved “into” Yellow’s off-chain system yet; it’s just on-chain custody.

---

## 2. How the Off-Chain Part Works (ClearNode + Ledger)

Yellow’s **ClearNode** is a WebSocket service you connect to. It does two main things:

1. **Ledger (unified balance)**  
   ClearNode keeps an off-chain ledger that can be tied to your on-chain custody. When you **create a channel** (or use a faucet on testnet), it links your custody balance to this ledger. So “balance” you see via `get_ledger_balances` is this off-chain view.

2. **State channels (app sessions)**  
   A **state channel** is an off-chain agreement: “we agree that the current state is X.”  
   - **Channel** = agreement on *who* has *how much* of which asset.  
   - **App session** = same idea but for an “app” (e.g. prediction): you and the broker agree on a state (e.g. “user has 50 USDC in this prediction session”).

All of this is **off-chain**:
- You connect to `wss://clearnet.yellow.com/ws` (prod) or `wss://clearnet-sandbox.yellow.com/ws` (sandbox).
- You authenticate (EIP-712 + session key).
- You send RPCs: `create_channel`, `create_app_session`, `submit_app_state`, `close_app_session`, etc.
- No new blockchain transactions are sent for placing or updating predictions; it’s all messages over the WebSocket.

So: **the “off-chain part” = talking to ClearNode over WebSocket and updating the ledger/state channel state by signed messages.**

---

## 3. Where Does Prediction Betting Actually Happen?

Prediction betting in this script is **fully off-chain**:

| Step | What happens | Where it runs |
|------|----------------|----------------|
| Place bet | You build a prediction (asset, direction, target, amount, expiry) and send it as an **application message** or **submit_app_state** over the WebSocket. | Your script → ClearNode (WebSocket) |
| “Bet is placed” | ClearNode (and broker) accept the signed message and update the **app session state** (e.g. “user committed 10 USDC to this LO prediction”). | ClearNode / broker (off-chain) |
| Resolve outcome | Your script (or a backend) **monitors price** (e.g. CoinGecko) and decides WIN/LOSS/EXPIRED. | Your script (or your backend) |
| Apply outcome | You compute **final allocations** (e.g. user gets payout or loses stake) and send **close_app_session** with that state. | Your script → ClearNode (WebSocket) |
| Settlement | ClearNode/broker submit the **final state on-chain** (e.g. to the Adjudicator/Custody), so custody balances are updated. | ClearNode → chain (one settlement tx) |

So:

- **Betting logic** (what is a WIN, what is a LOSS, odds, expiry) = in **your app** (this repo: `src/3-lo-prediction.js`).
- **Recording the bet and updating state** = **off-chain** via ClearNode (signed messages over WebSocket).
- **Enforcing the result on-chain** = when you **close the app session** with the final allocations; that triggers **on-chain settlement**.

The “prediction betting” is **working** in the sense that:
1. You open an app session (state channel) with the broker.
2. You send the prediction as an app message / state update (off-chain).
3. You (or your backend) resolve the outcome and send `close_app_session` with the final split of funds.
4. Settlement brings that final state on-chain.

---

## 4. End-to-End Flow (Deposit → Bet → Settlement)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ON-CHAIN                                                                     │
│  • You deposit USDC into Custody contract.                                     │
│  • Money is locked there until you withdraw or until channel settles.         │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ Create channel (links custody ↔ ledger)
                                      v
┌─────────────────────────────────────────────────────────────────────────────┐
│  OFF-CHAIN (ClearNode WebSocket)                                              │
│  1. Auth (EIP-712 + session key).                                            │
│  2. create_app_session: open state channel with broker, allocate e.g. 50 USDC.│
│  3. submit_app_state / application message: place LO prediction (asset,       │
│     direction, target, amount, expiry).  ← “Betting” happens here.           │
│  4. Your script monitors price; when expiry or target hit, you decide         │
│     outcome (WIN/LOSS).                                                       │
│  5. close_app_session with final allocations (e.g. user 100 USDC, broker 0). │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ Settlement (ClearNode/broker submit state)
                                      v
┌─────────────────────────────────────────────────────────────────────────────┐
│  ON-CHAIN AGAIN                                                               │
│  • Final state is checkpointed/closed on-chain.                              │
│  • Custody balances updated: you can withdraw or use in another channel.      │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Who Enforces the Bet?

- **Off-chain**: You and the broker (ClearNode) both see the same signed messages. The **broker** is the counterparty in the app session; it agrees to the state you propose when you send `submit_app_state` and `close_app_session`.
- **On-chain**: The **Adjudicator** (and Custody) enforce only the **final state** that gets submitted at settlement. They don’t run your prediction logic; they just apply the final allocation you and the broker agreed on off-chain.

So: **the contract doesn’t “run” the bet.** The bet is run off-chain (your logic + ClearNode/broker). The contract only holds the funds and then enforces the **final allocation** when you close the channel.

---

## 6. Summary Table

| Question | Answer |
|----------|--------|
| Where is the money after deposit? | In the **Custody contract** on-chain (Base, etc.). |
| What is the “off-chain part”? | **ClearNode**: WebSocket + ledger + state channels (app sessions). You send signed RPCs; no gas for each action. |
| Where does prediction betting happen? | **Off-chain**: you send prediction + state updates over WebSocket; outcome is resolved by your script (or backend); you close the app session with final allocations. |
| When does the contract do something again? | When the app session is **closed** and the final state is **settled on-chain** (and when you **withdraw** from custody). |

If you want, we can next map this exactly to the functions in `2-yellow-channel.js`, `3-lo-prediction.js`, and `4-settlement.js` line by line.
