import type { Permission } from "@finance/shared";
import {
  ArrowLeftRight,
  BadgePercent,
  Banknote,
  Bot,
  ChartColumn,
  FileText,
  FileUp,
  Gauge,
  HandCoins,
  Landmark,
  LayoutGrid,
  Receipt,
  Settings,
  ShoppingBag,
  Sparkles,
  Store,
  UsersRound,
} from "lucide-react";
import type { ComponentType } from "react";

/**
 * The section accent, named after a chart token in globals.css.
 *
 * A name rather than a class string because the class has to be written out in
 * full somewhere Tailwind's scanner can see it — that map lives in
 * `sidebar.tsx`. Never a hex here: both themes swap these tokens.
 */
export type NavAccent =
  | "chart-1"
  | "chart-2"
  | "chart-3"
  | "chart-4"
  | "chart-5"
  | "chart-6";

export type NavItem = {
  /** Stable identity — the accordion's open/closed state is keyed by this. */
  key: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /**
   * Omitted on a parent that only opens its children: that row navigates
   * nowhere, it toggles.
   */
  href?: string;
  /** Hidden unless the signed-in role holds this. The API enforces the same. */
  permission?: Permission;
  /**
   * Sub-items. A parent survives the permission filter only if at least one of
   * these does, so a role that can see only subscriptions still gets to them
   * through Expenses.
   */
  children?: NavItem[];
  /** Not built yet — shown greyed out so the shape of the app is visible. */
  comingSoon?: boolean;
};

export type NavGroup = { title: string; accent: NavAccent; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Overview",
    accent: "chart-1",
    items: [
      {
        key: "dashboard",
        href: "/",
        label: "Dashboard",
        // A dial, not another panel grid: at 16px the round silhouette is the
        // only one of its kind in the rail, so the first item is unmistakable.
        icon: Gauge,
        permission: "dashboard.view",
      },
    ],
  },
  {
    title: "Money",
    accent: "chart-3",
    items: [
      {
        key: "accounts",
        href: "/accounts",
        label: "Accounts",
        icon: Landmark,
        permission: "accounts.read",
        children: [
          {
            key: "accounts-cash-in",
            href: "/accounts/cash-in",
            label: "Cash-In",
            icon: HandCoins,
            permission: "accounts.read",
          },
        ],
      },
      {
        // No href: the parent opens the three screens under it. /expenses is
        // reachable as "Overview", the first child.
        key: "expenses",
        label: "Expenses",
        icon: Receipt,
        children: [
          {
            key: "expenses-overview",
            href: "/expenses",
            label: "Overview",
            icon: LayoutGrid,
            permission: "transactions.read",
          },
          {
            // The register of plans: what is bought, who is on it, which card
            // renews it. /vendors is still there and still answers a different
            // question — what was actually *paid*, to whom, in a month.
            key: "expenses-subscriptions",
            href: "/subscriptions",
            label: "AI tools and subscriptions",
            icon: Sparkles,
            permission: "vendors.read",
          },
          {
            key: "expenses-vendors",
            href: "/vendors",
            label: "Suppliers and spend",
            icon: Store,
            permission: "vendors.read",
          },
          {
            key: "expenses-other",
            href: "/expenses/other",
            label: "Other expenses",
            icon: ShoppingBag,
            permission: "transactions.read",
          },
        ],
      },
      {
        key: "transactions",
        href: "/transactions",
        label: "All transactions",
        icon: ArrowLeftRight,
        permission: "transactions.read",
      },
    ],
  },
  {
    title: "People",
    accent: "chart-2",
    items: [
      {
        key: "team",
        href: "/team",
        label: "Team",
        icon: UsersRound,
        permission: "team.read",
      },
      {
        key: "payroll",
        href: "/payroll",
        label: "Payroll",
        icon: Banknote,
        permission: "payroll.read",
      },
    ],
  },
  {
    title: "Tax",
    accent: "chart-6",
    items: [
      {
        // The only tax screen. Income tax was retired from the UI on the
        // owner's instruction — TDS is where withholding lives now. Its data
        // and its API endpoints are untouched; see
        // `apps/api/src/modules/income-tax/income-tax.service.ts`.
        key: "tds",
        href: "/tax/withholding",
        label: "TDS",
        // Withholding is a percentage taken off a bill — the percent badge says
        // that; a banknote said "money", which every other tax item is too.
        icon: BadgePercent,
        permission: "tds.read",
      },
    ],
  },
  {
    title: "Insight",
    accent: "chart-4",
    items: [
      {
        key: "reports",
        href: "/reports",
        label: "Reports",
        icon: ChartColumn,
        permission: "reports.view",
      },
      {
        /**
         * Its own screen, straight after Reports.
         *
         * It was the fourth tab there, filed beside three reports — which made
         * the one document somebody signs and sends out look like a fourth way
         * of slicing the same figures. A report is read; a statement is
         * issued.
         *
         * `reports.view` is the same permission: it is built from the same
         * ledger by the same service, and the PDF inside asks for
         * `dashboard.money` on top, which the screen checks for itself.
         */
        key: "statement",
        href: "/statement",
        label: "Statement",
        icon: FileText,
        permission: "reports.view",
      },
      {
        key: "assistant",
        href: "/assistant",
        label: "AI Assistant",
        icon: Bot,
        permission: "ai.use",
      },
    ],
  },
];

/** Pinned to the bottom of the rail. */
export const SECONDARY_NAV: NavItem[] = [
  {
    key: "import",
    href: "/import",
    label: "Imports",
    icon: FileUp,
    permission: "imports.run",
  },
  {
    key: "settings",
    href: "/settings",
    label: "Settings",
    icon: Settings,
    permission: "settings.read",
  },
];

export const SECONDARY_ACCENT: NavAccent = "chart-5";
