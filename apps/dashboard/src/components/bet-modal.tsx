"use client";

import { useState, useEffect } from "react";
import { useAccount } from "wagmi";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createMarket } from "@/lib/api";
import { addMyBet } from "@/lib/my-bets";
import type { Market } from "@/lib/api";

type BetModalProps = {
  market: Market;
  side: "LONG" | "SHORT";
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
  initialAmount?: string;
};

export function BetModal({ market, side, open, onOpenChange, onSuccess, initialAmount }: BetModalProps) {
  const { address } = useAccount();
  const [amount, setAmount] = useState(initialAmount ?? "10");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && initialAmount !== undefined) setAmount(initialAmount);
  }, [open, initialAmount]);

  const amountRaw = Math.round(parseFloat(amount || "0") * 1e6).toString();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const { market: created } = await createMarket({
        question: market.question,
        asset: market.asset,
        direction: side,
        targetPrice: market.targetPrice,
        amount: amountRaw,
        expirySeconds: 86400,
      });
      addMyBet({
        marketId: created.id,
        question: created.question,
        asset: created.asset,
        direction: side,
        targetPrice: created.targetPrice,
        amount: created.amount,
        createdAt: Date.now(),
      }, address);
      onOpenChange(false);
      setAmount("10");
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to place bet");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md border-primary/40 bg-card">
        <DialogHeader>
          <DialogTitle>Place bet</DialogTitle>
          <DialogDescription>
            {market.question} — {side === "LONG" ? "Up" : "Down"}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="amount">Amount (USDC)</Label>
            <Input
              id="amount"
              type="number"
              min="0.1"
              step="0.1"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1"
            />
          </div>
          {error && (
            <p className="text-sm text-destructive">{error}</p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !amountRaw || amountRaw === "0"}>
              {loading ? "Placing…" : "Place bet"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
