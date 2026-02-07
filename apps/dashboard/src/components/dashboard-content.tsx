"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useAccount } from "wagmi";
import { fetchMarkets, fetchTransactions, type Market, type YellowTx } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { PlusCircle, TrendingUp, Target, Receipt, ArrowRight } from "lucide-react";

function formatAmount(amount: string) {
  return (Number(amount) / 1e6).toFixed(2);
}

function formatBlockExplorerUrl(txHash: string, chainId: number) {
  if (chainId === 8453) return `https://basescan.org/tx/${txHash}`;
  if (chainId === 11155111) return `https://sepolia.etherscan.io/tx/${txHash}`;
  return `#`;
}

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

  return (
    <div className="container mx-auto max-w-6xl space-y-8 px-4 py-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground">
            Yellow prediction markets — create, trade, resolve
          </p>
        </div>
        <Link href="/markets">
          <Button size="lg" className="gap-2">
            <PlusCircle className="h-5 w-5" />
            Create market
          </Button>
        </Link>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total markets</CardTitle>
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <span className="text-2xl font-bold">{markets.length}</span>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Open</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <span className="text-2xl font-bold">{openMarkets.length}</span>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Resolved</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <span className="text-2xl font-bold">{resolvedMarkets.length}</span>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Volume (USDC)</CardTitle>
          </CardHeader>
          <CardContent>
            {loading ? (
              <Skeleton className="h-8 w-24" />
            ) : (
              <span className="text-2xl font-bold">{formatAmount(String(totalVolume))}</span>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Recent predictions</CardTitle>
              <CardDescription>Latest prediction markets</CardDescription>
            </div>
            <Link href="/predictions">
              <Button variant="ghost" size="sm" className="gap-1">
                View all <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-14 w-full" />
                ))}
              </div>
            ) : markets.length === 0 ? (
              <p className="text-sm text-muted-foreground">No markets yet. Create one from Markets.</p>
            ) : (
              <ul className="space-y-3">
                {markets.slice(0, 5).map((m) => (
                  <li
                    key={m.id}
                    className="flex items-center justify-between rounded-lg border border-border p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{m.question}</p>
                      <p className="text-xs text-muted-foreground">
                        {m.asset} · {m.direction} · ${m.targetPrice.toLocaleString()}
                      </p>
                    </div>
                    <Badge variant={m.status === "resolved" ? (m.outcome === "WIN" ? "success" : "destructive") : "secondary"}>
                      {m.status === "resolved" ? m.outcome : "Open"}
                    </Badge>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Yellow contract activity</CardTitle>
              <CardDescription>Deposits & withdrawals on-chain</CardDescription>
            </div>
            <Link href="/transactions">
              <Button variant="ghost" size="sm" className="gap-1">
                View all <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : transactions.length === 0 ? (
              <p className="text-sm text-muted-foreground">No recent transactions.</p>
            ) : (
              <ul className="space-y-2">
                {transactions.slice(0, 5).map((tx, i) => (
                  <li
                    key={`${tx.txHash}-${i}`}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <Receipt className="h-4 w-4 text-muted-foreground" />
                      <span>{tx.type}</span>
                      <span className="text-muted-foreground">
                        {formatAmount(tx.amount)} USDC
                      </span>
                    </div>
                    <a
                      href={formatBlockExplorerUrl(tx.txHash, tx.chainId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:underline"
                    >
                      View tx
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
