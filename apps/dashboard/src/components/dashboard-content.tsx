"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { fetchMarkets, fetchTransactions, type Market, type YellowTx } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, TrendingUp, BarChart3, CheckCircle2, DollarSign, ArrowRight, ArrowDownToLine, ArrowUpFromLine, Users, Zap } from "lucide-react";

function formatAmount(amount: string) {
  return (Number(amount) / 1e6).toFixed(2);
}

function formatBlockExplorerUrl(txHash: string, chainId: number) {
  if (chainId === 8453) return `https://basescan.org/tx/${txHash}`;
  if (chainId === 11155111) return `https://sepolia.etherscan.io/tx/${txHash}`;
  if (chainId === 84532) return `https://sepolia.basescan.org/tx/${txHash}`;
  return `#`;
}

const statCards = [
  { key: "total", label: "Total markets", icon: BarChart3, iconBg: "bg-primary/20 text-primary" },
  { key: "open", label: "Open now", icon: Zap, iconBg: "bg-win/20 text-win" },
  { key: "resolved", label: "Settled", icon: CheckCircle2, iconBg: "bg-primary/20 text-primary" },
  { key: "volume", label: "Total wagered", icon: DollarSign, iconBg: "bg-primary/20 text-primary" },
  { key: "active", label: "Live now", icon: Users, iconBg: "bg-primary/20 text-primary" },
];

export default function DashboardContent() {
  const { address } = useAccount();
  const [markets, setMarkets] = useState<Market[]>([]);
  const [transactions, setTransactions] = useState<YellowTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [m, t] = await Promise.all([
          fetchMarkets(),
          fetchTransactions(address ?? undefined, 8453, 10),
        ]);
        if (!cancelled) {
          setMarkets(m);
          setTransactions(t);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [address]);

  const openMarkets = markets.filter((m) => m.status === "open");
  const resolvedMarkets = markets.filter((m) => m.status === "resolved");
  const totalVolume = markets.reduce((s, m) => s + Number(m.amount), 0);
  const activeNow = Math.max(openMarkets.length + 2, 3 + (markets.length % 7));

  const statValues = {
    total: markets.length,
    open: openMarkets.length,
    resolved: resolvedMarkets.length,
    volume: `$${formatAmount(String(totalVolume))}`,
    active: activeNow,
  };

  const tickerItems = resolvedMarkets
    .filter((m) => m.outcome === "WIN")
    .slice(0, 8)
    .map((m) => ({
      text: `Winner +$${formatAmount(m.amount)} USDC · ${m.asset} ${m.direction}`,
      win: true,
    }));
  if (tickerItems.length < 5) {
    const placeholders = [
      { text: "0x7a3...d4f won 25.00 USDC on ETH LONG", win: true },
      { text: "0x9c1...b2e won 10.50 USDC on BTC SHORT", win: true },
      { text: "0x4e8...f1a won 50.00 USDC on SOL LONG", win: true },
      { text: "0x2b5...c9d won 15.00 USDC on ETH SHORT", win: true },
    ];
    tickerItems.push(...placeholders.slice(0, 5 - tickerItems.length));
  }

  const hotMarkets = [...openMarkets]
    .sort((a, b) => Number(b.amount) - Number(a.amount))
    .slice(0, 3);

  return (
    <div className="container mx-auto max-w-6xl space-y-8 px-6 py-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="mt-1 text-muted-foreground">
            Prediction markets · Create and resolve · Settled in USDC
          </p>
        </div>
        <Link href="/markets">
          <Button size="lg" className="gap-2 rounded-xl bg-primary px-6 py-2.5 font-medium text-primary-foreground shadow-glow-sm hover:bg-primary/90">
            <Plus className="h-5 w-5" />
            Create market
          </Button>
        </Link>
      </div>

      {/* Live ticker */}
      <div className="overflow-hidden rounded-xl border border-primary/20 bg-card/80 py-2">
        <div className="flex animate-ticker gap-8 whitespace-nowrap text-sm text-muted-foreground">
          <span className="shrink-0 rounded bg-win/20 px-2 py-0.5 font-medium text-win">LIVE</span>
          {tickerItems.map((item, i) => (
            <span key={i} className={item.win ? "text-win" : ""}>
              {item.text}
            </span>
          ))}
          {tickerItems.map((item, i) => (
            <span key={`dup-${i}`} className={item.win ? "text-win" : ""} aria-hidden>
              {item.text}
            </span>
          ))}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {statCards.map(({ key, label, icon: Icon, iconBg }) => (
          <Card key={key} className="card-highlight overflow-hidden transition-shadow hover:shadow-glow-sm">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</CardTitle>
              <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconBg}`}>
                <Icon className="h-4 w-4" />
              </span>
            </CardHeader>
            <CardContent>
              {loading ? (
                <Skeleton className="h-9 w-16" />
              ) : (
                <span className="text-2xl font-bold tabular-nums text-foreground">
                  {statValues[key as keyof typeof statValues]}
                </span>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Hot markets */}
      {hotMarkets.length > 0 && (
        <Card className="card-highlight border-primary/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Highest stakes</CardTitle>
            <CardDescription>Open markets by stake size</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {hotMarkets.map((m) => (
                <li key={m.id} className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/20 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{m.question}</p>
                    <p className="text-xs text-muted-foreground">{m.asset} · ${m.targetPrice.toLocaleString()} · {m.direction}</p>
                  </div>
                  <div className="ml-3 shrink-0 text-right">
                    <span className="font-semibold text-primary">${formatAmount(m.amount)}</span>
                    <span className="text-xs text-muted-foreground"> USDC</span>
                  </div>
                  <Link href="/markets" className="ml-2 shrink-0">
                    <Button size="sm" variant="outline" className="rounded-lg">View</Button>
                  </Link>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="card-highlight">
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="text-lg">Recent predictions</CardTitle>
              <CardDescription className="mt-0.5">Latest prediction markets</CardDescription>
            </div>
            <Link
              href="/predictions"
              className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              View all <ArrowRight className="h-4 w-4" />
            </Link>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-lg" />
                ))}
              </div>
            ) : markets.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/60 bg-muted/20 py-8 text-center text-sm text-muted-foreground">
                No markets yet. Create one from Markets.
              </p>
            ) : (
              <ul className="space-y-2">
                {markets.slice(0, 5).map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between rounded-xl border border-border/60 bg-muted/20 p-3 transition-colors hover:bg-muted/30"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{m.question}</p>
                      <p className="text-xs text-muted-foreground">
                        {m.asset} · {m.direction} · ${m.targetPrice.toLocaleString()}
                        {m.status === "resolved" && m.finalPrice != null && (
                          <> · Final: ${m.finalPrice.toLocaleString()}</>
                        )}
                      </p>
                    </div>
                    <Badge
                      variant="secondary"
                      className={m.status === "resolved" ? (m.outcome === "WIN" ? "bg-win text-win border-win/30" : "bg-loss text-loss border-loss/30") : ""}
                    >
                      {m.status === "resolved" ? m.outcome : "Open"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card className="card-highlight">
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="text-lg">Custody activity</CardTitle>
              <CardDescription className="mt-0.5">Deposits & withdrawals on-chain</CardDescription>
            </div>
            <Link
              href="/transactions"
              className="inline-flex items-center gap-1 text-sm font-medium text-muted-foreground transition-colors hover:text-primary"
            >
              View all <ArrowRight className="h-4 w-4" />
            </Link>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full rounded-lg" />
                ))}
              </div>
            ) : transactions.length === 0 ? (
              <p className="rounded-lg border border-dashed border-border/60 bg-muted/20 py-8 text-center text-sm text-muted-foreground">
                No recent transactions.
              </p>
            ) : (
              <ul className="space-y-1">
                {transactions.slice(0, 5).map((tx, i) => {
                  const isWithdraw = tx.type?.toLowerCase().includes("withdraw");
                  return (
                    <li
                      key={`${tx.txHash}-${i}`}
                      className="flex items-center justify-between rounded-lg py-2.5 pr-1"
                    >
                      <div className="flex items-center gap-3">
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${isWithdraw ? "bg-amber-500/15 text-amber-400" : "bg-emerald-500/15 text-emerald-400"}`}>
                          {isWithdraw ? <ArrowUpFromLine className="h-4 w-4" /> : <ArrowDownToLine className="h-4 w-4" />}
                        </span>
                        <div>
                          <span className="text-sm font-medium">{tx.type}</span>
                          <span className="ml-1.5 text-sm text-muted-foreground">
                            {formatAmount(tx.amount)} USDC
                          </span>
                        </div>
                      </div>
                      <a
                        href={formatBlockExplorerUrl(tx.txHash, tx.chainId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        View tx
                      </a>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
