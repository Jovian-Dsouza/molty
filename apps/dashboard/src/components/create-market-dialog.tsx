"use client";

import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createMarket } from "@/lib/api";
import { PlusCircle } from "lucide-react";

type CreateMarketDialogProps = {
  onSuccess?: () => void;
  trigger?: React.ReactNode;
};

export function CreateMarketDialog({ onSuccess, trigger }: CreateMarketDialogProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState("");
  const [asset, setAsset] = useState("ETHUSD");
  const [direction, setDirection] = useState<"LONG" | "SHORT">("LONG");
  const [targetPrice, setTargetPrice] = useState("");
  const [amount, setAmount] = useState("1000000");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await createMarket({
        question: question || undefined,
        asset,
        direction,
        targetPrice: targetPrice ? parseFloat(targetPrice) : undefined,
        amount,
        expirySeconds: 86400,
      });
      setOpen(false);
      setQuestion("");
      setTargetPrice("");
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="gap-2">
            <PlusCircle className="h-5 w-5" />
            Create market
          </Button>
        )}
      </DialogTrigger>
      <DialogContent showClose={true}>
        <DialogHeader>
          <DialogTitle>Create prediction market</DialogTitle>
          <DialogDescription>
            Create a new market. The bet is placed off-chain via Yellow; resolve from this dashboard.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="space-y-2">
            <Label htmlFor="question">Question (optional)</Label>
            <Input
              id="question"
              placeholder="e.g. Will ETH be above $3,500 by EOD?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Asset</Label>
              <Select value={asset} onValueChange={setAsset}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ETHUSD">ETH</SelectItem>
                  <SelectItem value="BTCUSD">BTC</SelectItem>
                  <SelectItem value="SOLUSD">SOL</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Direction</Label>
              <Select value={direction} onValueChange={(v) => setDirection(v as "LONG" | "SHORT")}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LONG">LONG</SelectItem>
                  <SelectItem value="SHORT">SHORT</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="target">Target price (optional)</Label>
              <Input
                id="target"
                type="number"
                step="any"
                placeholder="3500"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="amount">Amount (6 decimals)</Label>
              <Input
                id="amount"
                placeholder="1000000"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                {(Number(amount) / 1e6).toFixed(2)} USDC
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
