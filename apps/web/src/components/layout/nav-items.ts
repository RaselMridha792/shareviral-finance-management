import type { Permission } from "@finance/shared";

export type NavItem = {
  /** Stable identity — the accordion's open/closed state is keyed by this. */
  key: string;
  label: string;
  /**
   * A Material Symbols Rounded ligature — "account_balance", not a component.
   *
   * The design names every icon, so writing the name here means a reviewer can
   * check this file against the handoff by reading it. See `<Icon>`.
   */
  icon: string;
  /**
   * The hue this item's icon is drawn in, as an oklch hue angle.
   *
   * One per item and not one per section: the design colours the rail by
   * destination rather than by group, so a glance finds Payroll by its green
   * before the word is read. Lightness and chroma are fixed in CSS and swapped
   * per theme; only the angle differs, which is what keeps fifteen colours
   * looking like one family.
   */
  hue: number;
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

export type NavGroup = { title: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Overview",
    items: [
      {
        key: "dashboard",
        href: "/",
        label: "Dashboard",
        // A dial, not another panel grid: at 16px the round silhouette is the
        // only one of its kind in the rail, so the first item is unmistakable.
        icon: "space_dashboard",
        hue: 250,
        permission: "dashboard.view",
      },
    ],
  },
  {
    title: "Money",
    items: [
      {
        // No href: the row opens the two screens under it. The bank position
        // itself is "Accounts overview", the first child — a parent that is
        // also a page makes the same row do two things depending on where in
        // it you press.
        key: "accounts",
        label: "Accounts",
        icon: "account_balance",
        hue: 205,
        children: [
          {
            key: "accounts-overview",
            href: "/accounts",
            label: "Accounts overview",
            icon: "account_balance_wallet",
            hue: 205,
            permission: "accounts.read",
          },
          {
            key: "accounts-cash-in",
            href: "/accounts/cash-in",
            label: "Cash In",
            icon: "savings",
            hue: 158,
            permission: "accounts.read",
          },
        ],
      },
      {
        // As above: the row opens the three screens under it, and /expenses is
        // reachable as "Expense overview".
        key: "expenses",
        label: "Expenses",
        icon: "receipt_long",
        hue: 27,
        children: [
          {
            key: "expenses-overview",
            href: "/expenses",
            label: "Expense overview",
            icon: "grid_view",
            hue: 27,
            permission: "transactions.read",
          },
          {
            // The register of plans: what is bought, who is on it, which card
            // renews it. The supplier-and-spend screen that used to sit beside
            // it is gone — it answered "what was paid to whom this month",
            // which the expense screens already answer, and having both meant
            // two places to look for one number.
            key: "expenses-subscriptions",
            href: "/subscriptions",
            label: "AI tools and subscriptions",
            icon: "auto_awesome",
            hue: 295,
            permission: "vendors.read",
          },
          {
            key: "expenses-other",
            href: "/expenses/other",
            label: "Other expenses",
            icon: "shopping_basket",
            hue: 62,
            permission: "transactions.read",
          },
        ],
      },
      {
        key: "transfers",
        href: "/transfers",
        label: "Money Transfer",
        // Horizontal, against All transactions' vertical: money moving
        // *across* between our own accounts, not in or out of the company.
        icon: "swap_horiz",
        hue: 190,
        permission: "transactions.read",
      },
      {
        key: "transactions",
        href: "/transactions",
        label: "All transactions",
        icon: "swap_vert",
        hue: 225,
        permission: "transactions.read",
      },
    ],
  },
  {
    title: "People",
    items: [
      {
        key: "team",
        href: "/team",
        label: "Team",
        icon: "groups",
        hue: 185,
        permission: "team.read",
      },
      {
        key: "payroll",
        href: "/payroll",
        label: "Payroll",
        icon: "payments",
        hue: 138,
        permission: "payroll.read",
      },
    ],
  },
  {
    title: "Tax",
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
        icon: "percent",
        hue: 340,
        permission: "tds.read",
      },
    ],
  },
  {
    title: "Insight",
    items: [
      {
        /**
         * The reconciled position for a period, with its notes and who signed
         * it off. It was called Statement and it is not one — a statement is
         * the bank's own ledger, which is the screen below. This is read, and
         * that is ticked off against paper.
         *
         * Still at /reports, which is the address the thing it replaced had.
         */
        key: "reports",
        href: "/reports",
        label: "Reports",
        icon: "bar_chart",
        hue: 265,
        permission: "reports.view",
      },
      {
        /**
         * One account's movements with the balance after each, which is what
         * the word actually means and what gets ticked off against the bank's
         * paper.
         *
         * `transactions.read` rather than `reports.view`: it is the ledger,
         * line for line, not a figure derived from it.
         */
        key: "statement",
        href: "/statement",
        label: "Bank statement",
        icon: "description",
        hue: 45,
        permission: "transactions.read",
      },
      {
        key: "assistant",
        href: "/assistant",
        label: "AI Assistant",
        icon: "smart_toy",
        hue: 310,
        permission: "ai.use",
      },
    ],
  },
];

/** Pinned to the bottom of the rail. */
export const SECONDARY_NAV: NavItem[] = [
  {
    key: "data",
    // Renamed from `/import` when the screen gained an export tab. `/import`
    // still answers, with a permanent redirect, for anything that bookmarked it.
    href: "/data",
    label: "Import and Export",
    icon: "upload_file",
    hue: 100,
    permission: "imports.run",
  },
  {
    key: "settings",
    href: "/settings",
    label: "Settings",
    icon: "settings",
    hue: 240,
    permission: "settings.read",
  },
];
