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
        amount: amount || "1000000",
        expirySeconds: 86400,
      });
      setOpen(false);
      setQuestion("");
      setTargetPrice("");
      setAmount("1000000");
      onSuccess?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        setError(null);
      }}
    >
      <DialogTrigger asChild>
        {trigger ?? (
          <Button className="gap-2">
            <PlusCircle className="h-5 w-5" />
            Create market
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="border-primary/30 sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="text-lg">Create prediction market</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Set the question, asset, and target. Bet is placed off-chain; resolve from Markets or My Bets.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-1">
          {error && (
            <p className="rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="question" className="text-sm font-medium">Question (optional)</Label>
            <Input
              id="question"
              placeholder="e.g. Will ETH be above $3,500 by EOD?"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              className="border-border/80"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Asset</Label>
              <Select value={asset} onValueChange={setAsset}>
                <SelectTrigger className="border-border/80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ETHUSD">ETH</SelectItem>
                  <SelectItem value="BTCUSD">BTC</SelectItem>
                  <SelectItem value="SOLUSD">SOL</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-sm font-medium">Side</Label>
              <Select value={direction} onValueChange={(v) => setDirection(v as "LONG" | "SHORT")}>
                <SelectTrigger className="border-border/80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="LONG">Up</SelectItem>
                  <SelectItem value="SHORT">Down</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="target" className="text-sm font-medium">Target price</Label>
              <Input
                id="target"
                type="number"
                step="any"
                placeholder="3500"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                className="border-border/80"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="amount" className="text-sm font-medium">Amount (USDC)</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="1"
                value={amount ? (Number(amount) / 1e6).toFixed(2) : ""}
                onChange={(e) => {
                  const v = e.target.value;
                  const parsed = parseFloat(v);
                  if (v === "" || isNaN(parsed)) setAmount("");
                  else setAmount(String(Math.round(parsed * 1e6)));
                }}
                className="border-border/80"
              />
              <p className="text-xs text-muted-foreground">
                {amount ? `${(Number(amount) / 1e6).toFixed(2)} USDC` : "—"}
              </p>
            </div>
          </div>
          <DialogFooter className="gap-2 pt-2 sm:pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="border-border/80">
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !(amount || "1000000")} className="bg-primary hover:bg-primary/90">
              {loading ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
