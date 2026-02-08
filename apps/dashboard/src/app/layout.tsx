import type { Metadata } from "next";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Sidebar } from "@/components/sidebar";
import { TopNavbar } from "@/components/top-navbar";

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-sans",
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Molty",
  description: "Prediction markets — create, trade, resolve. Settled in USDC.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className={`${dmSans.variable} font-sans min-h-screen bg-background antialiased`}>
        <Providers>
          <div className="flex min-h-screen">
            <Sidebar />
            <div className="flex min-h-screen flex-1 flex-col pl-64">
              <TopNavbar />
              <main className="flex-1 bg-dashboard-pattern">{children}</main>
            </div>
          </div>
        </Providers>
      </body>
    </html>
  );
}
