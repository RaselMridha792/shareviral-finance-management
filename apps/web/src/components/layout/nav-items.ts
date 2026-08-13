import type { Permission } from "@finance/shared";
import {
  ArrowLeftRight,
  Banknote,
  ChartPie,
  FileSpreadsheet,
  LayoutDashboard,
  Landmark,
  Receipt,
  Settings,
  Sparkles,
  RefreshCw,
  Upload,
  Users,
  Wallet,
} from "lucide-react";
import type { ComponentType } from "react";

export type NavItem = {
  href: string;
  label: string;
  icon: ComponentType<{ className?: string }>;
  /** Hidden unless the signed-in role holds this. The API enforces the same. */
  permission: Permission;
  /** Not built yet — shown greyed out so the shape of the app is visible. */
  comingSoon?: boolean;
};

export type NavGroup = { title: string; items: NavItem[] };

export const NAV_GROUPS: NavGroup[] = [
  {
    title: "Overview",
    items: [
      {
        href: "/",
        label: "Dashboard",
        icon: LayoutDashboard,
        permission: "dashboard.view",
      },
    ],
  },
  {
    title: "Money",
    items: [
      {
        href: "/expenses",
        label: "Expenses",
        icon: Receipt,
        permission: "transactions.read",
      },
      {
        href: "/transactions",
        label: "All transactions",
        icon: ArrowLeftRight,
        permission: "transactions.read",
      },
      {
        href: "/accounts",
        label: "Accounts",
        icon: Landmark,
        permission: "accounts.read",
      },
      {
        // Still /vendors underneath — the table is the same one, and a URL
        // change would break every bookmark for a label.
        href: "/vendors",
        label: "Subscriptions",
        icon: RefreshCw,
        permission: "vendors.read",
      },
    ],
  },
  {
    title: "People",
    items: [
      {
        href: "/team",
        label: "Team",
        icon: Users,
        permission: "team.read",
      },
      {
        href: "/payroll",
        label: "Payroll",
        icon: Wallet,
        permission: "payroll.read",
      },
    ],
  },
  {
    title: "Tax",
    items: [
      {
        href: "/tax/withholding",
        label: "TDS",
        icon: Banknote,
        permission: "tds.read",
      },
      {
        href: "/tax/income-tax",
        label: "Income tax",
        icon: FileSpreadsheet,
        permission: "incometax.read",
      },
    ],
  },
  {
    title: "Insight",
    items: [
      {
        href: "/reports",
        label: "Reports",
        icon: ChartPie,
        permission: "reports.view",
      },
      {
        href: "/assistant",
        label: "Assistant",
        icon: Sparkles,
        permission: "ai.use",
      },
    ],
  },
];

export const SECONDARY_NAV: NavItem[] = [
  {
    href: "/import",
    label: "Import",
    icon: Upload,
    permission: "imports.run",
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    permission: "settings.read",
  },
];
