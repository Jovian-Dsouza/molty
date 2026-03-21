FROM node:20-alpine

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Copy monorepo root config
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./
COPY turbo.json ./

# Copy skills and MCP server source
COPY molty/skills ./molty/skills
COPY apps/mcp-skills ./apps/mcp-skills

# Install all dependencies (mcp-skills and hoisted skill deps like viem)
RUN pnpm install --frozen-lockfile --filter mcp-skills

EXPOSE 3001

# Run directly with tsx — no compile step needed
CMD ["pnpm", "--filter", "mcp-skills", "start"]
