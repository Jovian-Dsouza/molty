# Deploying the Molty Dashboard

## 1. Vercel (recommended for Next.js)

1. **Push your code** to GitHub/GitLab/Bitbucket.

2. **Go to [vercel.com](https://vercel.com)** → Add New Project → Import your repo.

3. **Configure the project:**
   - **Root Directory:** Click “Edit” and set to `apps/dashboard` (so Vercel builds this app).
   - **Framework Preset:** Next.js (auto-detected).
   - **Build Command:** `pnpm run build` (or leave default).
   - **Install Command:** `pnpm install` (Vercel usually detects pnpm from the repo).

   If you use a **pnpm monorepo from repo root** instead:
   - Leave **Root Directory** empty.
   - **Build Command:** `pnpm install && pnpm --filter dashboard build`
   - **Output Directory:** `apps/dashboard/.next`
   - **Install Command:** `pnpm install`

4. **Environment variables** (Project → Settings → Environment Variables). Add:

   | Name | Value | Notes |
   |------|--------|--------|
   | `NEXT_PUBLIC_PREDICTION_API_URL` | `https://molty-production.up.railway.app` | **Backend API URL** (Railway, etc.). Must be your **backend**, not the dashboard URL — wrong value causes HTTP 405 on Create market. |
   | `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | `845fb350ba83d50180234b4f77a4455a` | From [WalletConnect Cloud](https://cloud.walletconnect.com). |

5. **Deploy:** Save and deploy. Vercel will build and host the dashboard.

**Important:** Set `NEXT_PUBLIC_PREDICTION_API_URL` to your **backend** only (e.g. Railway). If you set it to your Vercel dashboard URL by mistake, Create market will return **HTTP 405** because the dashboard would be calling itself instead of the API.

---

## 2. Docker (self-host or any cloud)

From the **repo root**:

```bash
# Build (from repo root so workspace deps resolve)
pnpm install
pnpm --filter dashboard build

# Run the built app
cd apps/dashboard && pnpm start
```

To run in Docker, create `apps/dashboard/Dockerfile`:

```dockerfile
FROM node:20-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

# Install deps (monorepo: copy workspace files)
FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/dashboard/package.json ./apps/dashboard/
RUN pnpm install --frozen-lockfile

# Build dashboard
FROM base AS builder
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm --filter dashboard build

# Run
FROM base AS runner
WORKDIR /app/apps/dashboard
ENV NODE_ENV=production
COPY --from=builder /app/apps/dashboard/.next ./.next
COPY --from=builder /app/apps/dashboard/package.json ./
COPY --from=builder /app/node_modules ./node_modules
EXPOSE 3001
CMD ["pnpm", "start"]
```

Build and run (from repo root):

```bash
docker build -f apps/dashboard/Dockerfile -t molty-dashboard .
docker run -p 3001:3001 \
  -e NEXT_PUBLIC_PREDICTION_API_URL=https://your-api.com \
  -e NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID=845fb350ba83d50180234b4f77a4455a \
  molty-dashboard
```

---

## 3. Node on a VPS (e.g. Ubuntu)

```bash
# On the server (clone repo, then from repo root)
pnpm install
pnpm --filter dashboard build

# Run (e.g. with PM2 for keeping it up)
cd apps/dashboard && pnpm start
# Or: pm2 start "pnpm start" --name dashboard --cwd apps/dashboard
```

Set env vars (e.g. in `.env` in `apps/dashboard/` or in your process manager) before starting:

- `NEXT_PUBLIC_PREDICTION_API_URL`
- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`

---

## Checklist

- [ ] Prediction market API is deployed and its URL set in `NEXT_PUBLIC_PREDICTION_API_URL`.
- [ ] WalletConnect Project ID set in `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`.
- [ ] For Vercel: Root Directory = `apps/dashboard` (or monorepo build command as above).
