/**
 * Custody contract addresses and ABI for withdraw (Sepolia demo).
 */

export const CUSTODY_ADDRESS: Record<number, `0x${string}`> = {
  8453: "0x490fb189DdE3a01B00be9BA5F41e3447FbC838b6" as `0x${string}`,
  84532: "0x5bfEa1aD034512b43541fB2346928ca7511e75D3" as `0x${string}`,
  11155111: "0x6F71a38d919ad713D0AfE0eB712b95064Fc2616f" as `0x${string}`,
};

export const USDC_ADDRESS: Record<number, `0x${string}`> = {
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as `0x${string}`,
  84532: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`,
  11155111: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as `0x${string}`,
};

export const custodyAbi = [
  {
    inputs: [
      { name: "accounts", type: "address[]" },
      { name: "tokens", type: "address[]" },
    ],
    name: "getAccountsBalances",
    outputs: [{ type: "uint256[][]" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "account", type: "address" },
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "deposit",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
  {
    inputs: [
      { name: "token", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export const erc20Abi = [
  {
    inputs: [{ name: "account", type: "address" }],
    name: "balanceOf",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
  {
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    name: "allowance",
    outputs: [{ type: "uint256" }],
    stateMutability: "view",
    type: "function",
  },
] as const;
