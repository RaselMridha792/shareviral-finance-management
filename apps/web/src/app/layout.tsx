import type { Metadata } from "next";

// Self-hosted, not Google CDN: no third-party request at render time, and no
// layout jump if a CDN is slow or blocked.
//
// One face for everything, as the September handoff has it: Plus Jakarta Sans
// for prose AND figures, the figures with `tabular-nums` so a money column
// lines up. (Instrument Sans and IBM Plex Sans were the August design's pair.)
import "@fontsource-variable/plus-jakarta-sans";
// The August icon face, still drawn by <Icon> on every screen that has not
// been rebuilt yet. The new design's icons are Phosphor components; this goes
// when the last <Icon> does.
import "@fontsource-variable/material-symbols-rounded";

import { BootOverlay } from "@/components/boot/boot-overlay";
import { themeScript } from "@/components/layout/theme-toggle";

import "./globals.css";
import "./new-design.css";

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
      <body className="flex min-h-full flex-col">
        {children}
        <BootOverlay />
      </body>
    </html>
  );
}
