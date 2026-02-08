"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { fetchTransactions, type YellowTx } from "@/lib/api";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, ExternalLink } from "lucide-react";

function formatAmount(amount: string) {
  return (Number(amount) / 1e6).toFixed(2);
}

function blockExplorerUrl(txHash: string, chainId: number) {
  if (chainId === 8453) return `https://basescan.org/tx/${txHash}`;
  if (chainId === 11155111) return `https://sepolia.etherscan.io/tx/${txHash}`;
  return "#";
}

function chainName(chainId: number) {
  if (chainId === 8453) return "Base";
  if (chainId === 11155111) return "Sepolia";
  return `Chain ${chainId}`;
}

export default function TransactionsContent() {
  const { address } = useAccount();
  const [transactions, setTransactions] = useState<YellowTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [chainId, setChainId] = useState(8453);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const t = await fetchTransactions(address ?? undefined, chainId, 50);
      setTransactions(t);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [address, chainId]);

  return (
    <div className="container mx-auto max-w-6xl space-y-6 px-4 py-8">
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Transactions</h1>
          <p className="text-muted-foreground">
            Custody — deposits & withdrawals on-chain
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-10 rounded-md border border-input bg-background px-3 py-2 text-sm"
            value={chainId}
            onChange={(e) => setChainId(parseInt(e.target.value, 10))}
          >
            <option value={8453}>Base</option>
            <option value={11155111}>Sepolia</option>
          </select>
          <Button variant="outline" size="icon" onClick={load} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </Button>
        </div>
      </div>

      {address && (
        <p className="text-sm text-muted-foreground">
          Filtering by connected wallet: {address.slice(0, 6)}…{address.slice(-4)}
        </p>
      )}

      {error && (
        <div className="rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          {error}
        </div>
      )}

      <Card className="card-highlight">
        <CardHeader>
          <CardTitle>On-chain activity</CardTitle>
          <CardDescription>
            Last 50 Deposited / Withdrawn events from custody
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="space-y-3">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : transactions.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">
              No transactions in this range.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Wallet</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Chain</TableHead>
                  <TableHead className="w-[80px]">Link</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.map((tx, i) => (
                  <TableRow key={`${tx.txHash}-${i}`}>
                    <TableCell>
                      <span
                        className={
                          tx.type === "Deposit"
                            ? "text-win font-medium"
                            : "text-primary font-medium"
                        }
                      >
                        {tx.type}
                      </span>
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {tx.wallet.slice(0, 6)}…{tx.wallet.slice(-4)}
                    </TableCell>
                    <TableCell>{formatAmount(tx.amount)} USDC</TableCell>
                    <TableCell>{chainName(tx.chainId)}</TableCell>
                    <TableCell>
                      <a
                        href={blockExplorerUrl(tx.txHash, tx.chainId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex text-primary hover:underline"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
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
