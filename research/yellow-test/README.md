# Yellow Network Nitrolite SDK Test

Quick test to verify the Yellow Network Nitrolite SDK works with your wallet.

## Setup

```bash
npm install
```

## Environment

Create `.env` (or copy from `.env.sample`):

```
PRIVATE_KEY=0x_your_private_key
ALCHEMY_RPC_URL=https://rpc.sepolia.org
```

## Get Test Tokens

Request ytest.usd from the Sandbox Faucet:

```bash
npm run faucet
```

## Run Test

```bash
npm test
```

This will:
1. Connect to `wss://clearnet-sandbox.yellow.com/ws`
2. Authenticate using your private key (EIP-712 auth flow)
3. Request config and verify the SDK works

## Wallet

From your private key, the wallet address is: `0x0bde6B99a4AcDF900BbF7E85b79195bF2e0D80B3`
