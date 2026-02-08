"use client";

import dynamic from "next/dynamic";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

const ConnectButton = dynamic(
  () =>
    import("@rainbow-me/rainbowkit").then((mod) => mod.ConnectButton),
  { ssr: false }
);

interface TopNavbarProps {
  className?: string;
}

export function TopNavbar({ className }: TopNavbarProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-30 flex h-14 items-center justify-between gap-4 border-b border-border/60 bg-background/80 px-6 backdrop-blur-md",
        className
      )}
    >
      <div className="flex flex-1 items-center gap-4">
        <span className="hidden rounded bg-primary/20 px-2.5 py-1 text-xs font-semibold uppercase tracking-wider text-primary sm:inline-block">
          Live
        </span>
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search markets..."
            className="h-9 w-full rounded-lg border border-border/60 bg-muted/40 pl-9 pr-3 text-sm text-foreground placeholder:text-muted-foreground focus:border-primary/50 focus:outline-none focus:ring-1 focus:ring-primary/30"
          />
        </div>
      </div>
      <div className="[&_button]:!h-9 [&_button]:!rounded-lg [&_button]:!text-sm">
        <ConnectButton showBalance={false} />
      </div>
    </header>
  );
}
