"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount } from "wagmi";
import { fetchMarkets, fetchPrice, resolveMarket, type Market } from "@/lib/api";
import { getMyBets } from "@/lib/my-bets";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, TrendingUp, TrendingDown, CheckCircle2, XCircle } from "lucide-react";

function formatAmount(amount: string) {
  return (Number(amount) / 1e6).toFixed(2);
}

type EnrichedBet = {
  marketId: string;
  question: string;
  asset: string;
  direction: "LONG" | "SHORT";
  targetPrice: number;
  amount: string;
  createdAt: number;
  status?: string;
  outcome?: string;
  finalPrice?: number;
  currentPrice?: number;
  winning?: boolean;
};

export default function MyBetsPage() {
  const { address } = useAccount();
  const [bets, setBets] = useState<EnrichedBet[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [betFilter, setBetFilter] = useState<"all" | "live" | "history">("all");

  const load = useCallback(async () => {
    const myBets = getMyBets(address);
    setBets(myBets);
    setLoading(true);
    setError(null);
    try {
      const m = await fetchMarkets();
      setMarkets(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [address]);

  useEffect(() => {
    load();
  }, [load]);

  const assetList = [...new Set([...bets.map((b) => b.asset), ...markets.map((m) => m.asset)])];
  useEffect(() => {
    if (assetList.length === 0) return;
    let cancelled = false;
    async function poll() {
      for (const asset of assetList) {
        if (cancelled) return;
        try {
          const { price } = await fetchPrice(asset);
          setPrices((prev) => ({ ...prev, [asset]: price }));
        } catch (_) {}
      }
    }
    poll();
    const t = setInterval(poll, 15000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [assetList.join(",")]);

  const enriched: EnrichedBet[] = bets.map((bet) => {
    const market = markets.find((m) => m.id === bet.marketId);
    const currentPrice = prices[bet.asset];
    let winning: boolean | undefined;
    if (market?.status === "resolved") {
      winning = market.outcome === "WIN";
    } else if (currentPrice != null) {
      winning =
        bet.direction === "LONG"
          ? currentPrice >= bet.targetPrice
          : currentPrice <= bet.targetPrice;
    }
    return {
      ...bet,
      status: market?.status ?? "open",
      outcome: market?.outcome,
      finalPrice: market?.finalPrice,
      currentPrice,
      winning,
    };
  });

  async function handleResolve(id: string, outcome?: "WIN" | "LOSS") {
    setResolvingId(id);
    setError(null);
    try {
      await resolveMarket(id, outcome);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Resolve failed");
    } finally {
      setResolvingId(null);
    }
  }

  return (
    <div className="container mx-auto max-w-4xl space-y-8 px-6 py-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">My Bets</h1>
          <p className="text-muted-foreground">
            Trades and predictions in one place.
          </p>
        </div>
        <Button variant="outline" size="icon" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card className="card-highlight">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-lg">Predictions</CardTitle>
              <CardDescription>Your positions. Resolve when ready.</CardDescription>
            </div>
            <div className="flex gap-1 rounded-lg border border-border bg-muted/30 p-1">
              {(["all", "live", "history"] as const).map((tab) => (
                <button
                  key={tab}
                  onClick={() => setBetFilter(tab)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                    betFilter === tab
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab === "all" ? `All (${markets.length})` : tab === "live" ? `Live (${markets.filter((m) => m.status === "open").length})` : `History (${markets.filter((m) => m.status === "resolved").length})`}
                </button>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading && markets.length === 0 ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <Skeleton key={i} className="h-32 rounded-xl" />
              ))}
            </div>
          ) : (() => {
            const filtered = betFilter === "live" ? markets.filter((m) => m.status === "open") : betFilter === "history" ? markets.filter((m) => m.status === "resolved") : markets;
            if (filtered.length === 0) return <p className="py-12 text-center text-muted-foreground">{betFilter === "live" ? "No live bets right now." : betFilter === "history" ? "No resolved bets yet." : "No markets yet."}</p>;
            return (
            <div className="space-y-4">
              {filtered.map((m) => {
                const currentPrice = prices[m.asset];
                let winning: boolean | undefined;
                if (m.status === "resolved") {
                  winning = m.outcome === "WIN";
                } else if (currentPrice != null) {
                  winning = m.direction === "LONG" ? currentPrice >= m.targetPrice : currentPrice <= m.targetPrice;
                }
                return (
                  <Card key={m.id} className="overflow-hidden border-border/80 bg-card">
                    <CardHeader className="pb-2">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                          {m.status === "open" && (
                            <span className="relative flex h-2.5 w-2.5">
                              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-win opacity-75" />
                              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-win" />
                            </span>
                          )}
                          <CardTitle className="text-base leading-tight line-clamp-2">
                            {m.question}
                          </CardTitle>
                        </div>
                        <div className="flex items-center gap-2">
                          {m.status === "resolved" ? (
                            <Badge className={m.outcome === "WIN" ? "bg-win/20 text-win border-win/30" : "bg-loss/20 text-loss border-loss/30"}>
                              {m.outcome === "WIN" ? <CheckCircle2 className="mr-1 h-3.5 w-3.5" /> : <XCircle className="mr-1 h-3.5 w-3.5" />}
                              {m.outcome}
                            </Badge>
                          ) : (
                            <>
                              {winning !== undefined && (
                                <Badge variant="secondary" className={winning ? "bg-win/20 text-win border-win/30" : "bg-loss/20 text-loss border-loss/30"}>
                                  {winning ? "Currently winning" : "Currently losing"}
                                </Badge>
                              )}
                              <Badge variant="outline" className="border-win/40 text-win">Live</Badge>
                              <Button size="sm" className="bg-primary hover:bg-primary/90" disabled={!!resolvingId} onClick={() => handleResolve(m.id)}>
                                {resolvingId === m.id ? "Resolving…" : "Resolve"}
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                      <p className="flex items-center gap-2 text-sm text-muted-foreground">
                        {m.direction === "LONG" ? <TrendingUp className="h-4 w-4 text-win" /> : <TrendingDown className="h-4 w-4 text-loss" />}
                        {m.direction === "LONG" ? "Up" : "Down"} · {formatAmount(m.amount)} USDC
                        {currentPrice != null && <span className="ml-2">· Current: ${currentPrice.toLocaleString()}</span>}
                        {m.finalPrice != null && <span className="ml-2">· Final: ${m.finalPrice.toLocaleString()}</span>}
                      </p>
                    </CardHeader>
                  </Card>
                );
              })}
            </div>
            );
          })()}
        </CardContent>
      </Card>

    </div>
  );
}
