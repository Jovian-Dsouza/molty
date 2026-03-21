/**
 * Molty MCP Skills Server
 *
 * Exposes molty TypeScript skills as MCP tools over SSE transport.
 * Picoclaw connects to this server to call molty skills.
 *
 * Transport: SSE at http://0.0.0.0:3001/sse
 * Run with: tsx src/index.ts (from monorepo root or mcp-skills dir)
 */

import express from "express";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { z } from "zod";

// ── Skill imports ─────────────────────────────────────────────────────────
// Paths are relative to this file's location: apps/mcp-skills/src/index.ts
// Skills live at: molty/skills/<name>/index.ts (three levels up from src/)

import {
  fetchPrice,
  listAssets,
} from "../../../molty/skills/molty-events/index";

import { swap } from "../../../molty/skills/molty-swap/index";

import { getPortfolio } from "../../../molty/skills/molty-portfolio/index";

import {
  listMarkets,
  placeBet,
  resolveMarket,
  findMarket,
} from "../../../molty/skills/molty-predict/index";

import {
  getArcBalance,
  sendUSDC,
  getTreasuryStatus,
  depositToYield,
  withdrawFromYield,
  autoRebalance,
} from "../../../molty/skills/molty-arc/index";

// ── Constants ─────────────────────────────────────────────────────────────

const PORT = parseInt(process.env.PORT ?? "3001", 10);

// ── MCP Server ────────────────────────────────────────────────────────────

const server = new McpServer({
  name: "molty-skills",
  version: "0.1.0",
});

// ── Tool: fetch_price ─────────────────────────────────────────────────────

server.tool(
  "fetch_price",
  "Fetch the latest crypto price from the Stork oracle. Pass comma-separated asset IDs like ETHUSD, BTCUSD, SOLUSD.",
  { assets: z.string().describe("Comma-separated asset IDs, e.g. 'ETHUSD,BTCUSD'") },
  async ({ assets }) => {
    const results = await fetchPrice(assets);
    return {
      content: [{ type: "text", text: JSON.stringify(results, null, 2) }],
    };
  }
);

// ── Tool: list_assets ─────────────────────────────────────────────────────

server.tool(
  "list_assets",
  "List all available asset IDs supported by the Stork oracle price feed.",
  {},
  async () => {
    const assets = await listAssets();
    return {
      content: [{ type: "text", text: JSON.stringify(assets, null, 2) }],
    };
  }
);

// ── Tool: execute_swap ────────────────────────────────────────────────────

server.tool(
  "execute_swap",
  "Execute an on-chain token swap via LI.FI. Supports ETH, USDC, DAI, USDT on Base (8453), Arbitrum (42161), Polygon (137).",
  {
    fromToken: z.string().describe("Source token symbol, e.g. 'ETH', 'USDC'"),
    toToken: z.string().describe("Destination token symbol, e.g. 'USDC', 'DAI'"),
    amount: z.string().describe("Amount in human units, e.g. '0.001' for 0.001 ETH"),
    fromChainId: z.number().optional().describe("Source chain ID (default: 8453 Base)"),
    toChainId: z.number().optional().describe("Destination chain ID (default: same as fromChainId)"),
  },
  async (params) => {
    const result = await swap(params);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ── Tool: get_portfolio ───────────────────────────────────────────────────

server.tool(
  "get_portfolio",
  "Get the current wallet token balances on Base, Arbitrum, and Polygon.",
  {
    chainId: z.number().optional().describe("Chain ID to check (optional — checks all chains by default)"),
  },
  async ({ chainId }) => {
    const result = await getPortfolio(chainId ? { chainId } : undefined);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ── Tool: list_markets ────────────────────────────────────────────────────

server.tool(
  "list_markets",
  "List all open and recently resolved prediction markets on Yellow Network.",
  {},
  async () => {
    const markets = await listMarkets();
    return {
      content: [{ type: "text", text: JSON.stringify(markets, null, 2) }],
    };
  }
);

// ── Tool: place_bet ───────────────────────────────────────────────────────

server.tool(
  "place_bet",
  "Place a prediction bet using natural language. Parses the user's intent and creates a market. E.g. 'Bet $5 on ETH hitting $3500'.",
  {
    userText: z.string().describe("Natural language bet description"),
  },
  async ({ userText }) => {
    const result = await placeBet(userText);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ── Tool: resolve_market ──────────────────────────────────────────────────

server.tool(
  "resolve_market",
  "Resolve a prediction market by ID. Optionally force a WIN or LOSS outcome; otherwise resolves based on current price.",
  {
    marketId: z.string().describe("Market ID to resolve"),
    outcome: z.enum(["WIN", "LOSS"]).optional().describe("Force outcome (optional)"),
  },
  async ({ marketId, outcome }) => {
    const result = await resolveMarket(marketId, outcome);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ── Tool: find_market ─────────────────────────────────────────────────────

server.tool(
  "find_market",
  "Find a prediction market by natural language query, e.g. 'ETH above 3000'.",
  {
    query: z.string().describe("Search query for the market"),
  },
  async ({ query }) => {
    const market = await findMarket(query);
    return {
      content: [{ type: "text", text: JSON.stringify(market, null, 2) }],
    };
  }
);

// ── Tool: get_arc_balance ─────────────────────────────────────────────────

server.tool(
  "get_arc_balance",
  "Get the USDC and USYC (yield) balances of the Molty treasury on Arc Network.",
  {},
  async () => {
    const balance = await getArcBalance();
    return {
      content: [{ type: "text", text: JSON.stringify(balance, null, 2) }],
    };
  }
);

// ── Tool: treasury_status ─────────────────────────────────────────────────

server.tool(
  "treasury_status",
  "Get a full treasury status report: USDC balance, USYC yield position, total value, and rebalance recommendation.",
  {},
  async () => {
    const status = await getTreasuryStatus();
    return {
      content: [{ type: "text", text: JSON.stringify(status, null, 2) }],
    };
  }
);

// ── Tool: send_usdc ───────────────────────────────────────────────────────

server.tool(
  "send_usdc",
  "Send USDC to a recipient address on Arc Network.",
  {
    recipient: z.string().describe("Recipient wallet address (0x...)"),
    amount: z.string().describe("Amount in USDC, e.g. '10.5'"),
  },
  async ({ recipient, amount }) => {
    const result = await sendUSDC(recipient, amount);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ── Tool: deposit_to_yield ────────────────────────────────────────────────

server.tool(
  "deposit_to_yield",
  "Deposit USDC into USYC (US Treasury yield) on Arc Network to earn yield.",
  {
    amount: z.string().describe("Amount in USDC to deposit, e.g. '100'"),
  },
  async ({ amount }) => {
    const result = await depositToYield(amount);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ── Tool: withdraw_from_yield ─────────────────────────────────────────────

server.tool(
  "withdraw_from_yield",
  "Withdraw USDC from USYC yield position on Arc Network.",
  {
    amount: z.string().describe("Amount in USDC to withdraw, e.g. '50'"),
  },
  async ({ amount }) => {
    const result = await withdrawFromYield(amount);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ── Tool: auto_rebalance ──────────────────────────────────────────────────

server.tool(
  "auto_rebalance",
  "Automatically rebalance the Arc treasury based on Stork oracle signals. Moves funds between USDC and USYC for optimal yield.",
  {},
  async () => {
    const result = await autoRebalance();
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

// ── Express + SSE transport ───────────────────────────────────────────────

const app = express();

// Track active SSE transports by session ID
const transports = new Map<string, SSEServerTransport>();

app.get("/sse", async (_req, res) => {
  const transport = new SSEServerTransport("/messages", res);
  transports.set(transport.sessionId, transport);

  res.on("close", () => {
    transports.delete(transport.sessionId);
  });

  await server.connect(transport);
});

app.post("/messages", express.json(), async (req, res) => {
  const sessionId = req.query["sessionId"] as string;
  const transport = transports.get(sessionId);

  if (!transport) {
    res.status(404).json({ error: "Session not found" });
    return;
  }

  await transport.handlePostMessage(req, res);
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", server: "molty-skills" });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[mcp-skills] Listening on http://0.0.0.0:${PORT}/sse`);
});
