"use client";

import { useEffect, useState, useCallback } from "react";
import { fetchMarkets, type Market } from "@/lib/api";
import { mergeMarkets } from "@/lib/mock-markets";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { BetModal } from "@/components/bet-modal";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, TrendingDown, Send } from "lucide-react";

function categoryFor(asset: string): { label: string; color: string } {
  switch (asset) {
    case "ETHUSD":
    case "BTCUSD":
    case "SOLUSD":
      return { label: "Crypto", color: "bg-primary/15 text-primary border-primary/30" };
    case "POLITICS":
      return { label: "Politics", color: "bg-blue-500/15 text-blue-400 border-blue-500/30" };
    case "SPORTS":
      return { label: "Sports", color: "bg-orange-500/15 text-orange-400 border-orange-500/30" };
    case "AAPL":
    case "TSLA":
      return { label: "Stocks", color: "bg-cyan-500/15 text-cyan-400 border-cyan-500/30" };
    case "ENTERTAINMENT":
    case "GAMING":
      return { label: "Entertainment", color: "bg-pink-500/15 text-pink-400 border-pink-500/30" };
    case "WEATHER":
      return { label: "Weather", color: "bg-sky-500/15 text-sky-400 border-sky-500/30" };
    case "MACRO":
    case "OILUSD":
    case "XAUUSD":
      return { label: "Global", color: "bg-amber-500/15 text-amber-400 border-amber-500/30" };
    default:
      return { label: "Other", color: "bg-muted text-muted-foreground border-border" };
  }
}

function formatAmount(amount: string) {
  return (Number(amount) / 1e6).toFixed(2);
}

export default function PredictionsPage() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [betModal, setBetModal] = useState<{
    market: Market;
    side: "LONG" | "SHORT";
    initialAmount?: string;
  } | null>(null);
  const [moltyInput, setMoltyInput] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const m = await fetchMarkets();
      setMarkets(mergeMarkets(m));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function handleAskMolty(e: React.FormEvent) {
    e.preventDefault();
    const text = moltyInput.trim().toLowerCase();
    if (!text || !markets.length) return;
    const amountMatch = text.match(/\$?\s*(\d+(?:\.\d+)?)\s*(?:dollars?|usdc)?/i);
    const amount = amountMatch ? parseFloat(amountMatch[1]) : 10;
    const isUp = /up|above|long|yes|bull/.test(text);
    const isDown = /down|below|short|no|bear/.test(text);
    const side: "LONG" | "SHORT" = isDown && !isUp ? "SHORT" : "LONG";
    const marketIndexMatch = text.match(/market\s*(\d+)/i);
    const openMarkets = markets.filter((m) => m.status === "open");
    const index = marketIndexMatch ? Math.min(parseInt(marketIndexMatch[1], 10) - 1, openMarkets.length - 1) : 0;
    const market = openMarkets[index >= 0 ? index : 0];
    if (market) {
      setBetModal({ market, side, initialAmount: String(amount) });
      setMoltyInput("");
    }
  }

  return (
    <div className="container mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Predictions</h1>
          <p className="text-muted-foreground">
            Pick Up or Down. Place your bet.
          </p>
        </div>
      </div>

      <Card className="border-primary/40 bg-card/95">
        <CardHeader className="pb-2">
          <p className="text-sm font-medium text-primary">Ask Molty</p>
          <p className="text-xs text-muted-foreground">
            e.g. &quot;Bet $10 on ETH up&quot; or &quot;Bet 5 on market 1 down&quot;
          </p>
        </CardHeader>
        <CardContent className="pt-0">
          <form onSubmit={handleAskMolty} className="flex gap-2">
            <Input
              placeholder="Bet $10 on Ethereum up..."
              value={moltyInput}
              onChange={(e) => setMoltyInput(e.target.value)}
              className="flex-1 border-primary/40 focus-visible:ring-primary/30"
            />
            <Button type="submit" size="icon" className="shrink-0">
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </CardContent>
      </Card>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Skeleton key={i} className="h-44 rounded-xl" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {markets.filter((m) => m.status === "open").map((m) => (
            <Card
              key={m.id}
              className="overflow-hidden border-border/80 bg-card transition-shadow hover:shadow-lg hover:shadow-black/20"
            >
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-base font-semibold leading-tight line-clamp-2 text-foreground flex-1">
                    {m.question}
                  </h3>
                  <Badge variant="outline" className={`shrink-0 text-[10px] px-1.5 py-0.5 ${categoryFor(m.asset).color}`}>
                    {categoryFor(m.asset).label}
                  </Badge>
                </div>
                <p className="text-xs text-muted-foreground">
                  {m.targetPrice > 1 ? `Target: $${m.targetPrice.toLocaleString()} · ` : ""}{m.asset}
                </p>
              </CardHeader>
              <CardContent className="flex gap-2 pt-0">
                {(() => {
                  const isCrypto = ["ETHUSD","BTCUSD","SOLUSD","AAPL","TSLA","OILUSD","XAUUSD"].includes(m.asset);
                  return (
                    <>
                      <Button
                        variant="outline"
                        className="flex-1 border-win/40 bg-win/10 text-win hover:bg-win/20"
                        onClick={() => setBetModal({ market: m, side: "LONG" })}
                      >
                        <TrendingUp className="mr-1.5 h-4 w-4" />
                        {isCrypto ? "Up" : "Yes"}
                      </Button>
                      <Button
                        variant="outline"
                        className="flex-1 border-loss/40 bg-loss/10 text-loss hover:bg-loss/20"
                        onClick={() => setBetModal({ market: m, side: "SHORT" })}
                      >
                        <TrendingDown className="mr-1.5 h-4 w-4" />
                        {isCrypto ? "Down" : "No"}
                      </Button>
                    </>
                  );
                })()}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {betModal && (
        <BetModal
          market={betModal.market}
          side={betModal.side}
          open={!!betModal}
          onOpenChange={(open) => !open && setBetModal(null)}
          onSuccess={load}
          initialAmount={betModal.initialAmount}
        />
      )}
    </div>
  );
}
