"use client";

import { useEffect, useState, useCallback } from "react";
import { useAccount, useBalance, useChainId, useReadContract, useWriteContract } from "wagmi";
import { parseUnits, formatUnits } from "viem";
import { fetchTransactions, type YellowTx } from "@/lib/api";
import { CUSTODY_ADDRESS, USDC_ADDRESS, custodyAbi, erc20Abi } from "@/lib/custody";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw, ArrowDownToLine, ArrowUpFromLine, ExternalLink, Wallet, Copy, Check, User } from "lucide-react";

function blockExplorerUrl(txHash: string, chainId: number) {
  if (chainId === 8453) return `https://basescan.org/tx/${txHash}`;
  if (chainId === 84532) return `https://sepolia.basescan.org/tx/${txHash}`;
  if (chainId === 11155111) return `https://sepolia.etherscan.io/tx/${txHash}`;
  return "#";
}

function addressExplorerUrl(addr: string, chainId: number) {
  if (chainId === 8453) return `https://basescan.org/address/${addr}`;
  if (chainId === 84532) return `https://sepolia.basescan.org/address/${addr}`;
  if (chainId === 11155111) return `https://sepolia.etherscan.io/address/${addr}`;
  return "#";
}

function chainName(chainId: number) {
  if (chainId === 8453) return "Base";
  if (chainId === 84532) return "Base Sepolia";
  if (chainId === 11155111) return "Sepolia";
  return `Chain ${chainId}`;
}

export default function ProfilePage() {
  const { address } = useAccount();
  const connectedChainId = useChainId();
  const [transactions, setTransactions] = useState<YellowTx[]>([]);
  const [loading, setLoading] = useState(false);
  const [tradesError, setTradesError] = useState<string | null>(null);
  const [chainId, setChainId] = useState(11155111);
  const [copied, setCopied] = useState(false);

  // Deposit state
  const [depositAmount, setDepositAmount] = useState("");
  const [lastDepositTxHash, setLastDepositTxHash] = useState<string | null>(null);

  // Withdraw state
  const [withdrawAmount, setWithdrawAmount] = useState("");
  const [lastWithdrawTxHash, setLastWithdrawTxHash] = useState<string | null>(null);

  const custodyAddr = connectedChainId ? CUSTODY_ADDRESS[connectedChainId] : undefined;
  const usdcAddr = connectedChainId ? USDC_ADDRESS[connectedChainId] : undefined;

  // Balances
  const { data: nativeBalance } = useBalance({ address });

  const { data: usdcWalletBalance, refetch: refetchUsdcWallet } = useReadContract({
    address: usdcAddr,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
  });
  const usdcWalletFormatted = usdcWalletBalance !== undefined ? (Number(usdcWalletBalance) / 1e6).toFixed(2) : "—";

  const { data: custodyBalances, refetch: refetchCustody } = useReadContract({
    address: custodyAddr,
    abi: custodyAbi,
    functionName: "getAccountsBalances",
    args: address && usdcAddr ? [[address], [usdcAddr]] : undefined,
  });
  const custodyBalanceRaw = custodyBalances?.[0]?.[0] ?? 0n;
  const custodyBalanceFormatted = (Number(custodyBalanceRaw) / 1e6).toFixed(2);

  // Write contracts
  const { writeContractAsync: writeDeposit, isPending: isDepositPending } = useWriteContract();
  const { writeContractAsync: writeApprove } = useWriteContract();
  const { writeContractAsync: writeWithdraw, isPending: isWithdrawPending } = useWriteContract();

  const loadTransactions = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    setTradesError(null);
    try {
      const t = await fetchTransactions(address, chainId, 30);
      setTransactions(t);
    } catch (e) {
      setTradesError(e instanceof Error ? e.message : "Failed to fetch transactions");
      setTransactions([]);
    } finally {
      setLoading(false);
    }
  }, [address, chainId]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions]);

  function refreshAll() {
    refetchUsdcWallet();
    refetchCustody();
    loadTransactions();
  }

  async function handleDeposit() {
    if (!custodyAddr || !usdcAddr || !address) return;
    const amt = depositAmount.trim();
    if (!amt || Number(amt) <= 0) return;
    try {
      const amountWei = parseUnits(amt, 6);
      await writeApprove({
        address: usdcAddr,
        abi: erc20Abi,
        functionName: "approve",
        args: [custodyAddr, amountWei],
      });
      const hash = await writeDeposit({
        address: custodyAddr,
        abi: custodyAbi,
        functionName: "deposit",
        args: [address, usdcAddr, amountWei],
      });
      setLastDepositTxHash(hash);
      setDepositAmount("");
      setTimeout(refreshAll, 3000);
    } catch (e) {
      console.error("Deposit error:", e);
    }
  }

  async function handleWithdraw() {
    if (!custodyAddr || !usdcAddr || !address) return;
    const amount = withdrawAmount.trim();
    if (!amount || Number(amount) <= 0) return;
    try {
      const amountWei = parseUnits(amount, 6);
      if (amountWei > custodyBalanceRaw) return;
      const hash = await writeWithdraw({
        address: custodyAddr,
        abi: custodyAbi,
        functionName: "withdraw",
        args: [usdcAddr, amountWei],
      });
      setLastWithdrawTxHash(hash);
      setWithdrawAmount("");
      setTimeout(refreshAll, 3000);
    } catch (e) {
      console.error("Withdraw error:", e);
    }
  }

  function handleCopy() {
    if (!address) return;
    navigator.clipboard.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  if (!address) {
    return (
      <div className="container mx-auto max-w-4xl px-6 py-8">
        <div className="flex flex-col items-center justify-center gap-4 py-24">
          <User className="h-16 w-16 text-muted-foreground/40" />
          <h1 className="text-2xl font-bold">Connect your wallet</h1>
          <p className="text-muted-foreground">Connect your wallet to view your profile, balances, and manage funds.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto max-w-4xl space-y-8 px-6 py-8">
      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Profile</h1>
          <p className="text-muted-foreground">Manage your wallet, deposits, and withdrawals.</p>
        </div>
        <Button variant="outline" size="icon" onClick={refreshAll} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </Button>
      </div>

      {/* Wallet Info */}
      <Card className="card-highlight border-primary/20">
        <CardHeader className="pb-2">
          <CardTitle className="text-lg flex items-center gap-2">
            <User className="h-5 w-5" />
            Wallet
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/20 text-primary font-bold text-sm">
              {address.slice(2, 4).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <code className="text-sm font-mono">{address}</code>
                <button onClick={handleCopy} className="text-muted-foreground hover:text-foreground transition-colors">
                  {copied ? <Check className="h-4 w-4 text-win" /> : <Copy className="h-4 w-4" />}
                </button>
                <a
                  href={addressExplorerUrl(address, connectedChainId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-muted-foreground hover:text-primary transition-colors"
                >
                  <ExternalLink className="h-4 w-4" />
                </a>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">Connected on {chainName(connectedChainId)}</p>
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 rounded-xl border border-border/60 bg-muted/20 p-4">
            <div>
              <p className="text-xs text-muted-foreground">ETH Balance</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">
                {nativeBalance ? `${Number(formatUnits(nativeBalance.value, 18)).toFixed(4)}` : "—"}
              </p>
              <p className="text-xs text-muted-foreground">{nativeBalance?.symbol ?? "ETH"}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">USDC in Wallet</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{usdcWalletFormatted}</p>
              <p className="text-xs text-muted-foreground">USDC</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">USDC in Custody</p>
              <p className="mt-1 text-lg font-semibold tabular-nums">{custodyBalanceFormatted}</p>
              <p className="text-xs text-muted-foreground">USDC</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Deposit & Withdraw side by side */}
      <div className="grid gap-6 md:grid-cols-2">
        {/* Deposit */}
        <Card className="card-highlight border-primary/30">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ArrowDownToLine className="h-5 w-5 text-win" />
              Deposit
            </CardTitle>
            <CardDescription>
              Deposit USDC into Yellow custody to bet off-chain.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                placeholder="Amount"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="flex-1"
                min={0}
                step="0.01"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDepositAmount(usdcWalletFormatted !== "—" ? usdcWalletFormatted : "")}
              >
                Max
              </Button>
            </div>
            <Button
              onClick={handleDeposit}
              disabled={isDepositPending || !depositAmount.trim() || Number(depositAmount) <= 0}
              className="w-full"
            >
              {isDepositPending ? "Depositing…" : `Deposit ${depositAmount || "0"} USDC`}
            </Button>
            {lastDepositTxHash && (
              <p className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
                <span className="text-win">Sent:</span>
                <a
                  href={blockExplorerUrl(lastDepositTxHash, connectedChainId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  {lastDepositTxHash.slice(0, 10)}…{lastDepositTxHash.slice(-8)}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </p>
            )}
          </CardContent>
        </Card>

        {/* Withdraw */}
        <Card className="card-highlight">
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <ArrowUpFromLine className="h-5 w-5 text-amber-400" />
              Withdraw
            </CardTitle>
            <CardDescription>
              Withdraw USDC from custody back to your wallet.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Input
                type="number"
                placeholder="Amount"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                className="flex-1"
                min={0}
                step="0.01"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setWithdrawAmount(custodyBalanceFormatted)}
              >
                Max
              </Button>
            </div>
            <Button
              variant="outline"
              onClick={handleWithdraw}
              disabled={isWithdrawPending || custodyBalanceRaw === 0n || !withdrawAmount.trim()}
              className="w-full"
            >
              {isWithdrawPending ? "Withdrawing…" : `Withdraw ${withdrawAmount || "0"} USDC`}
            </Button>
            {lastWithdrawTxHash && (
              <p className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
                <span className="text-win">Sent:</span>
                <a
                  href={blockExplorerUrl(lastWithdrawTxHash, connectedChainId)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline inline-flex items-center gap-1"
                >
                  {lastWithdrawTxHash.slice(0, 10)}…{lastWithdrawTxHash.slice(-8)}
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Transaction History */}
      <Card className="card-highlight">
        <CardHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-lg">Transaction History</CardTitle>
              <CardDescription>On-chain custody deposits & withdrawals</CardDescription>
            </div>
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={chainId}
              onChange={(e) => setChainId(parseInt(e.target.value, 10))}
            >
              <option value={11155111}>Sepolia</option>
              <option value={8453}>Base</option>
              <option value={84532}>Base Sepolia</option>
            </select>
          </div>
        </CardHeader>
        <CardContent>
          {tradesError && (
            <p className="mb-3 rounded-lg border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {tradesError}
            </p>
          )}
          {transactions.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {tradesError ? "Couldn't load transactions." : "No custody activity on this chain yet."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Chain</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead className="w-20">Link</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactions.slice(0, 20).map((tx, i) => (
                  <TableRow key={`${tx.txHash}-${tx.blockNumber}-${i}`}>
                    <TableCell>
                      <span className={tx.type === "Deposit" ? "text-win" : "text-amber-400"}>
                        {tx.type === "Deposit" ? <ArrowDownToLine className="mr-1 inline h-4 w-4" /> : <ArrowUpFromLine className="mr-1 inline h-4 w-4" />}
                        {tx.type}
                      </span>
                    </TableCell>
                    <TableCell>{chainName(tx.chainId)}</TableCell>
                    <TableCell>{(Number(tx.amount) / 1e6).toFixed(2)} USDC</TableCell>
                    <TableCell>
                      <a
                        href={blockExplorerUrl(tx.txHash, tx.chainId)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
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
