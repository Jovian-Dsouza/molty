# Molty Dashboard — build and run in Docker (build from repo root)
# docker build -f apps/dashboard/Dockerfile -t molty-dashboard .
# docker run -p 3001:3001 -e NEXT_PUBLIC_PREDICTION_API_URL=... -e NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=... molty-dashboard

FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/dashboard/package.json ./apps/dashboard/
RUN pnpm install --frozen-lockfile

FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm --filter dashboard build

FROM base AS runner
WORKDIR /app/apps/dashboard
ENV NODE_ENV=production
COPY --from=builder /app/apps/dashboard/.next ./.next
COPY --from=builder /app/apps/dashboard/package.json ./
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3001
CMD ["pnpm", "start"]
