"use client";

import { useChainId, useSwitchChain } from "wagmi";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

const CHAINS: { id: number; name: string; color: string }[] = [
  { id: 11155111, name: "Sepolia", color: "bg-violet-500" },
  { id: 8453, name: "Base", color: "bg-blue-500" },
  { id: 84532, name: "Base Sepolia", color: "bg-blue-400" },
];

interface NetworkSelectorProps {
  compact?: boolean;
}

export function NetworkSelector({ compact }: NetworkSelectorProps) {
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const current = CHAINS.find((c) => c.id === chainId) ?? CHAINS[0];

  return (
    <Select
      value={String(chainId)}
      onValueChange={(v) => switchChain?.({ chainId: Number(v) })}
    >
      <SelectTrigger
        className={cn(
          "h-auto border-sidebar-border py-2 pl-3 pr-2",
          compact
            ? "w-auto min-w-[140px] rounded-lg border border-border bg-muted/40 text-foreground hover:bg-muted/60"
            : "w-full rounded-xl bg-sidebar-hover/80 text-sidebar-foreground hover:bg-sidebar-hover"
        )}
      >
        <div className="flex flex-1 items-center gap-2">
          <span
            className={cn("h-2.5 w-2.5 shrink-0 rounded-full", current.color)}
          />
          <SelectValue>{current.name}</SelectValue>
        </div>
      </SelectTrigger>
      <SelectContent align="start" className="min-w-[180px]">
        {CHAINS.map((chain) => (
          <SelectItem key={chain.id} value={String(chain.id)}>
            <div className="flex items-center gap-2">
              <span
                className={cn("h-2.5 w-2.5 rounded-full", chain.color)}
              />
              {chain.name}
            </div>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
