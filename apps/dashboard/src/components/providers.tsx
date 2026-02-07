"use client";

import { useState, useEffect } from "react";

export function Providers({ children }: { children: React.ReactNode }) {
  const [WalletProviders, setWalletProviders] = useState<
    React.ComponentType<{ children: React.ReactNode }> | null
  >(null);

  useEffect(() => {
    import("@/components/wallet-providers").then((m) =>
      setWalletProviders(() => m.WalletProviders)
    );
  }, []);

  // Don't render children until WagmiProvider is in the tree, or any
  // component that uses useAccount/useConfig will throw.
  if (!WalletProviders) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      </div>
    );
  }
  return <WalletProviders>{children}</WalletProviders>;
}
