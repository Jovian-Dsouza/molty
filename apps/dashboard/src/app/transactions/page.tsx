"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

const TransactionsContent = dynamic(
  () => import("@/components/transactions-content").then((m) => m.default),
  {
    ssr: false,
    loading: () => (
      <div className="container mx-auto max-w-6xl space-y-6 px-4 py-8">
        <Skeleton className="h-10 w-48" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    ),
  }
);

export default function TransactionsPage() {
  return <TransactionsContent />;
}
