import type { Metadata } from "next";

// Self-hosted, not Google CDN: no third-party request at render time, and no
// layout jump if a CDN is slow or blocked.
//
// Instrument Sans carries the prose. IBM Plex Sans carries every figure, date,
// rate and id — as a proportional face with tabular figures, not a monospaced
// one, because `tabular-nums` is what makes a money column align and a terminal
// font on a payslip reads as somebody's developer tool.
import "@fontsource/instrument-sans/400.css";
import "@fontsource/instrument-sans/500.css";
import "@fontsource/instrument-sans/600.css";
import "@fontsource/instrument-sans/700.css";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-sans/700.css";
// The icon face. `index.css` is the outline axis at FILL 0, which is the
// default the design asks for; the active nav item switches to FILL 1 through
// `font-variation-settings` rather than a second file.
import "@fontsource-variable/material-symbols-rounded";

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
