# Circle Developer Wallet

Creates a Circle developer-controlled wallet (SCA on Polygon Amoy testnet).

## Setup

1. Copy `.env.example` to `.env` and add your Circle API key.
2. Get an API key from [Circle Console](https://console.circle.com/api-keys).
3. Format: `TEST_API_KEY:your_id:your_secret` (3 parts for testnet)

## Run

```bash
npm run create-wallet
```

## Output

You'll get:
- **Wallet ID** – Use for API calls
- **Address** – On-chain wallet address (e.g. `0x80a2bbf1a7fca65520373449feb5accbc5b1e156`)
- **Entity Secret** – ⚠️ Save securely! Needed for future Circle API calls.

## Your Wallet

| Field | Value |
|-------|-------|
| **Address** | `0x80a2bbf1a7fca65520373449feb5accbc5b1e156` |
| **Blockchain** | Polygon Amoy (testnet) |
| **Account Type** | SCA (Smart Contract Account) |
| **Wallet Set ID** | `c9ac71ca-f66c-57a5-8b32-9bf01e22ff48` |
