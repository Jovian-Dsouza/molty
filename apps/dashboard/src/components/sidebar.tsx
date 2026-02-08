"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, TrendingUp, Target, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";

const links = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/markets", label: "Markets", icon: TrendingUp },
  { href: "/predictions", label: "Predictions", icon: Target },
  { href: "/transactions", label: "Transactions", icon: Receipt },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="fixed left-0 top-0 z-40 flex h-screen w-64 flex-col border-r border-sidebar-border bg-sidebar">
      <div className="flex flex-col gap-2 p-4">
        <Link
          href="/"
          className="mb-2 flex items-center gap-2 rounded-xl px-3 py-2.5 font-semibold transition-colors hover:bg-sidebar-hover"
        >
          <span className="text-xl text-primary">Molty</span>
          <span className="text-sidebar-muted">Predictions</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-0.5">
          {links.map(({ href, label, icon: Icon }) => {
            const isActive = pathname === href;
            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200",
                  isActive
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "text-sidebar-muted hover:bg-sidebar-hover hover:text-sidebar-foreground"
                )}
              >
                <Icon className={cn("h-5 w-5 shrink-0", isActive && "text-primary-foreground")} />
                {label}
              </Link>
            );
          })}
        </nav>
      </div>
    </aside>
  );
}
