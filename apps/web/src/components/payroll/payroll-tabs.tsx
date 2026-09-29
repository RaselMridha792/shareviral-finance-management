import { BankIcon } from "@phosphor-icons/react/dist/ssr/Bank";
import { MoneyIcon } from "@phosphor-icons/react/dist/ssr/Money";
import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Payroll and Bank Advice, as two tabs over both screens.
 *
 * The owner, 29 Sep 2026: *"eta payroll page er arekta tab hisebe thakuk,
 * etar alada ekta page hobe"* — a tab of the payroll page, with a page of its
 * own. So each is its own address (and its own row in the rail, under
 * Payroll & Bank), and this strip at the top of both moves between them.
 *
 * Links rather than the `Segmented` buttons it is drawn like: each tab is a
 * page, which a link says to the browser and to a screen reader — it opens
 * in a new tab, it is in the history, Back returns to it.
 */
const TABS = [
  { key: "payroll", href: "/payroll", label: "Payroll", icon: MoneyIcon },
  {
    key: "bank-advice",
    href: "/payroll/bank-advice",
    label: "Bank Advice",
    icon: BankIcon,
  },
] as const;

export function PayrollTabs({ active }: { active: "payroll" | "bank-advice" }) {
  return (
    <nav
      aria-label="Payroll and bank"
      className="sv-card inline-flex max-w-full shrink-0 flex-wrap gap-1 self-start rounded-[11px] bg-(--sv-surface) p-1"
      data-payroll-tabs
    >
      {TABS.map((tab) => {
        const on = tab.key === active;
        const Icon = tab.icon;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={on ? "page" : undefined}
            className={cn(
              "inline-flex h-9 items-center gap-[7px] rounded-lg px-3.5 text-[13.5px] whitespace-nowrap transition-colors duration-300 motion-reduce:transition-none",
              on
                ? "bg-(--sv-accent) font-extrabold text-(--sv-on-accent)"
                : "font-semibold text-(--sv-muted) hover:bg-(--sv-subtle) hover:text-(--sv-ink)",
            )}
          >
            <Icon weight="duotone" size={17} />
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
