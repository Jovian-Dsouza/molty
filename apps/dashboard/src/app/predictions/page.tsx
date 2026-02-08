"use client";

import { useEffect, useState } from "react";
import { fetchMarkets, type Market } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Target, TrendingUp, TrendingDown } from "lucide-react";

function formatAmount(amount: string) {
  return (Number(amount) / 1e6).toFixed(2);
}

export default function PredictionsPage() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchMarkets()
      .then((m) => {
        if (!cancelled) setMarkets(m);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="container mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Predictions</h1>
        <p className="text-muted-foreground">
          All prediction markets
        </p>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-40 rounded-lg" />
          ))}
        </div>
      ) : markets.length === 0 ? (
        <Card className="card-highlight">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <Target className="h-12 w-12 text-muted-foreground" />
            <p className="mt-4 text-muted-foreground">No predictions yet</p>
            <p className="text-sm text-muted-foreground">Create a market from the Markets page</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {markets.map((m) => (
            <Card key={m.id} className="card-highlight overflow-hidden">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between gap-2">
                  <CardTitle className="text-base leading-tight line-clamp-2">
                    {m.question}
                  </CardTitle>
                  <Badge
                    variant="secondary"
                    className={m.status === "resolved" ? (m.outcome === "WIN" ? "bg-win/20 text-win border-win/30" : "bg-loss/20 text-loss border-loss/30") : ""}
                  >
                    {m.status === "resolved" ? m.outcome : "Open"}
                  </Badge>
                </div>
                <CardDescription className="flex items-center gap-2">
                  {m.direction === "LONG" ? (
                    <TrendingUp className="h-4 w-4 text-win" />
                  ) : (
                    <TrendingDown className="h-4 w-4 text-loss" />
                  )}
                  {m.asset} · Target ${m.targetPrice.toLocaleString()} · {formatAmount(m.amount)} USDC
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                {m.status === "resolved" && m.finalPrice != null && (
                  <p className="text-sm text-muted-foreground">
                    Final price: ${m.finalPrice.toLocaleString()}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
