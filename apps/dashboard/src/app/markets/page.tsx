"use client";

import { useEffect, useState } from "react";
import { fetchMarkets, resolveMarket, type Market } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CreateMarketDialog } from "@/components/create-market-dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw } from "lucide-react";

function formatAmount(amount: string) {
  return (Number(amount) / 1e6).toFixed(2);
}

export default function MarketsPage() {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "open" | "resolved">("all");
  const [error, setError] = useState<string | null>(null);

  async function load() {
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
  }

  useEffect(() => {
    load();
  }, []);

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

  const filtered =
    filter === "open"
      ? markets.filter((m) => m.status === "open")
      : filter === "resolved"
        ? markets.filter((m) => m.status === "resolved")
        : markets;

  // Newest first (id is m_<timestamp>)
  const sorted = [...filtered].sort((a, b) => (b.id > a.id ? 1 : -1));

  return (
    <div className="container mx-auto max-w-6xl space-y-6 px-6 py-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Markets</h1>
          <p className="text-muted-foreground">
            Create and resolve prediction markets · Resolve uses current price
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
          <CreateMarketDialog onSuccess={load} />
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        {(["all", "open", "resolved"] as const).map((f) => (
          <Button
            key={f}
            variant={filter === f ? "default" : "outline"}
            size="sm"
            onClick={() => setFilter(f)}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
          </Button>
        ))}
      </div>

      <Card className="card-highlight border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Resolution</CardTitle>
          <CardDescription>
            Resolve uses the asset&apos;s current price: Up wins if price ≥ target, Down wins if price ≤ target.
          </CardDescription>
        </CardHeader>
      </Card>

      <Card className="card-highlight">
        <CardHeader>
          <CardTitle>All markets</CardTitle>
          <CardDescription>{sorted.length} market(s)</CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : sorted.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No markets. Create one above.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[200px]">Question</TableHead>
                  <TableHead>Asset</TableHead>
                  <TableHead>Direction</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="whitespace-nowrap">Final price</TableHead>
                  <TableHead className="w-[120px]">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sorted.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="max-w-[360px] font-medium leading-snug">
                      {m.question}
                    </TableCell>
                    <TableCell>{m.asset}</TableCell>
                    <TableCell>{m.direction}</TableCell>
                    <TableCell>${m.targetPrice.toLocaleString()}</TableCell>
                    <TableCell>{formatAmount(m.amount)} USDC</TableCell>
                    <TableCell>
                      <Badge
                        variant="secondary"
                        className={m.status === "resolved" ? (m.outcome === "WIN" ? "bg-win/20 text-win border-win/30" : "bg-loss/20 text-loss border-loss/30") : ""}
                      >
                        {m.status === "resolved" ? m.outcome : "Open"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {m.status === "resolved"
                        ? m.finalPrice != null
                          ? `$${m.finalPrice.toLocaleString()}`
                          : "—"
                        : "—"}
                    </TableCell>
                    <TableCell>
                      {m.status === "open" && (
                        <Button
                          size="sm"
                          onClick={() => handleResolve(m.id)}
                          disabled={resolvingId !== null}
                          className="bg-primary hover:bg-primary/90"
                        >
                          {resolvingId === m.id ? "Resolving…" : "Resolve"}
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
