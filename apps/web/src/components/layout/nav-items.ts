import type { Permission } from "@finance/shared";
import type { Icon } from "@phosphor-icons/react";
import { ArrowsDownUpIcon } from "@phosphor-icons/react/dist/ssr/ArrowsDownUp";
import { ArrowsLeftRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowsLeftRight";
import { BankIcon } from "@phosphor-icons/react/dist/ssr/Bank";
import { ChartBarIcon } from "@phosphor-icons/react/dist/ssr/ChartBar";
import { ChartPieSliceIcon } from "@phosphor-icons/react/dist/ssr/ChartPieSlice";
import { CoinsIcon } from "@phosphor-icons/react/dist/ssr/Coins";
import { FileArrowUpIcon } from "@phosphor-icons/react/dist/ssr/FileArrowUp";
import { FilePlusIcon } from "@phosphor-icons/react/dist/ssr/FilePlus";
import { FilesIcon } from "@phosphor-icons/react/dist/ssr/Files";
import { FileTextIcon } from "@phosphor-icons/react/dist/ssr/FileText";
import { GearSixIcon } from "@phosphor-icons/react/dist/ssr/GearSix";
import { HandCoinsIcon } from "@phosphor-icons/react/dist/ssr/HandCoins";
import { InvoiceIcon } from "@phosphor-icons/react/dist/ssr/Invoice";
import { MoneyIcon } from "@phosphor-icons/react/dist/ssr/Money";
import { PercentIcon } from "@phosphor-icons/react/dist/ssr/Percent";
import { PlusCircleIcon } from "@phosphor-icons/react/dist/ssr/PlusCircle";
import { ReceiptIcon } from "@phosphor-icons/react/dist/ssr/Receipt";
import { RobotIcon } from "@phosphor-icons/react/dist/ssr/Robot";
import { SparkleIcon } from "@phosphor-icons/react/dist/ssr/Sparkle";
import { SquaresFourIcon } from "@phosphor-icons/react/dist/ssr/SquaresFour";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/ssr/UsersThree";
import { WalletIcon } from "@phosphor-icons/react/dist/ssr/Wallet";

export type NavItem = {
  /** Stable identity — the accordion's open/closed state is keyed by this. */
  key: string;
  label: string;
  /**
   * The handoff's Phosphor icon for this destination, drawn duotone in the
   * rail's 32px tile and, on a rebuilt screen, filled in its header tile.
   *
   * The component rather than its name, so a missing icon is a compile error
   * instead of an empty square. Written here, a reviewer can still check this
   * file against the handoff's NAV table by reading it.
   */
  icon: Icon;
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
        icon: SquaresFourIcon,
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
        icon: BankIcon,
        children: [
          {
            key: "accounts-overview",
            href: "/accounts",
            label: "Accounts overview",
            icon: WalletIcon,
            permission: "accounts.read",
          },
          {
            key: "accounts-cash-in",
            href: "/accounts/cash-in",
            label: "Cash In",
            icon: HandCoinsIcon,
            permission: "accounts.read",
          },
          {
            key: "accounts-transfers",
            href: "/transfers",
            label: "Money Transfer",
            // Horizontal, against All transactions' vertical: money moving
            // *across* between our own accounts, not in or out of the company.
            icon: ArrowsLeftRightIcon,
            permission: "transactions.read",
          },
        ],
      },
      {
        // As above: the row opens the three screens under it, and /expenses is
        // reachable as "Expense overview".
        key: "expenses",
        label: "Expenses",
        icon: ReceiptIcon,
        children: [
          {
            /*
             * The new overview: a month cut into slices that add up.
             *
             * It takes the name "Expense overview", and the category grid it
             * used to point at becomes "Operational expenses" — which is what
             * that grid actually holds now that salary and tooling have boxes
             * of their own.
             */
            key: "expenses-overview",
            href: "/expenses/overview",
            label: "Expense overview",
            icon: ChartPieSliceIcon,
            permission: "transactions.read",
          },
          {
            key: "expenses-operational",
            href: "/expenses",
            label: "Operational expenses",
            icon: InvoiceIcon,
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
            icon: SparkleIcon,
            permission: "vendors.read",
          },
          /*
           * Other expenses is off the rail, on the owner's instruction — "menu
           * theke other expenses ta remove kore diyo".
           *
           * Its ROUTE and its permission gate stay: things link to it, and the
           * overview's Uncategorised box is one of them. What goes is the
           * standing row, because the screen answers a question the overview
           * now answers better — "what did we spend that is not tooling" was
           * always a subtraction rather than a heading.
           *
           * The breadcrumb reads the rail's hrefs, so `/expenses/other` now
           * names its own last crumb rather than inheriting one.
           */
        ],
      },
      {
        key: "transactions",
        href: "/transactions",
        label: "All transactions",
        icon: ArrowsDownUpIcon,
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
        icon: UsersThreeIcon,
        permission: "team.read",
      },
      {
        /*
         * Payroll and the bank file it produces, together. The owner, 29 Sep
         * 2026: *"akhon jeta peoples ache oitar under a payroll ache etar
         * sidebar structure tao change hobe ... 1. Payroll and Exports:
         * a. Payroll b. Bank data sheet"* — and the names were left to us:
         * "Bank Advice" is what a Bangladeshi finance office calls the
         * salary instruction sent to the bank, and "Payroll & Bank" says
         * what the two rows under it are.
         *
         * The parent carries `payroll.read` too, so a role with neither row
         * does not get an empty heading (see `visibleFor`).
         */
        key: "payroll-bank",
        label: "Payroll & Bank",
        icon: CoinsIcon,
        permission: "payroll.read",
        children: [
          {
            key: "payroll",
            href: "/payroll",
            label: "Payroll",
            icon: MoneyIcon,
            permission: "payroll.read",
          },
          {
            key: "bank-advice",
            href: "/payroll/bank-advice",
            label: "Bank Advice",
            icon: BankIcon,
            permission: "payroll.read",
          },
        ],
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
        icon: PercentIcon,
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
        icon: ChartBarIcon,
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
        icon: FileTextIcon,
        permission: "transactions.read",
      },
      {
        /*
         * The owner's builder, brought in on 28 Sep 2026 under Money, and
         * moved here the next day when invoices started being saved: *"invoice
         * builder take amra sidebar er Insight section a niye jabo oikhane
         * invoice builder name ta expandable thakbe and etar under a duita
         * option thakbe"*. An invoice writes nothing to the books.
         *
         * The parent carries the permission too, not only its two rows: a
         * parent with no permission of its own stays on the rail with nothing
         * under it for a role that can see neither (see `visibleFor`).
         * `transactions.write`, because an invoice asks for money on the
         * company's behalf and prints its bank account.
         */
        key: "invoices",
        label: "Invoice Builder",
        icon: FilePlusIcon,
        permission: "transactions.write",
        children: [
          {
            key: "invoices-all",
            href: "/invoices",
            label: "All Invoices",
            icon: FilesIcon,
            permission: "transactions.write",
          },
          {
            key: "invoices-new",
            href: "/invoices/new",
            label: "Add New",
            icon: PlusCircleIcon,
            permission: "transactions.write",
          },
        ],
      },
      {
        key: "assistant",
        href: "/assistant",
        label: "AI Assistant",
        icon: RobotIcon,
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
    icon: FileArrowUpIcon,
    permission: "imports.run",
  },
  {
    key: "settings",
    href: "/settings",
    label: "Settings",
    icon: GearSixIcon,
    permission: "settings.read",
  },
];
