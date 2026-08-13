import type { Metadata } from "next";

// Self-hosted, not Google CDN: no third-party request at render time, and no
// layout jump if a CDN is slow or blocked. Only 400/500/600 are loaded.
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/jetbrains-mono/400.css";
import "@fontsource/jetbrains-mono/500.css";
import "@fontsource/jetbrains-mono/600.css";

import { themeScript } from "@/components/layout/theme-toggle";

import "./globals.css";

export const metadata: Metadata = {
  title: "Finance Management",
  description:
    "Payroll, expenses, TDS, bank reconciliation, and reporting in one place.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" suppressHydrationWarning className="h-full antialiased">
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
