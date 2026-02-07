import { getDefaultConfig } from "@rainbow-me/rainbowkit";
import { base, baseSepolia, sepolia } from "wagmi/chains";

export const config = getDefaultConfig({
  appName: "Molty Dashboard",
  projectId: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "demo-project-id",
  chains: [base, sepolia, baseSepolia],
  ssr: true,
});
