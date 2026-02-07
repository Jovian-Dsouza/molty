"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

const DashboardContent = dynamic(
  () => import("@/components/dashboard-content").then((m) => m.default),
  {
    ssr: false,
    loading: () => (
      <div className="container mx-auto max-w-6xl space-y-8 px-4 py-8">
        <Skeleton className="h-10 w-48" />
        <div className="grid gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-24" />
          ))}
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <Skeleton className="h-64" />
          <Skeleton className="h-64" />
        </div>
      </div>
    ),
  }
);

export default function DashboardPage() {
  return <DashboardContent />;
}
