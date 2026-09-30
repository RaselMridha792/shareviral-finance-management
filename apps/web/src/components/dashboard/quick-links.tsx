"use client";

import type { Permission } from "@finance/shared";
import type { Icon } from "@phosphor-icons/react";
import { BankIcon } from "@phosphor-icons/react/dist/ssr/Bank";
import { FilePlusIcon } from "@phosphor-icons/react/dist/ssr/FilePlus";
import { MoneyIcon } from "@phosphor-icons/react/dist/ssr/Money";
import { TrayIcon } from "@phosphor-icons/react/dist/ssr/Tray";
import Link from "next/link";

import { useCan } from "@/components/auth/session-provider";
import { WaitingBadge } from "@/components/hr-requests/waiting-badge";

type QuickLink = {
  href: string;
  label: string;
  icon: Icon;
  permission: Permission;
  /** HR Requests carries what waits, as it does in the rail. */
  waiting?: boolean;
};

/**
 * The four screens the owner opens most, a click from the dashboard.
 *
 * The owner, 1 Oct 2026: *"dashboard er ekhane Hr Request, Bank Advise,
 * Payroll, Invoice Builder quicklinks rakho choto icons sohokare"*. The same
 * icons and permissions as the rail (`nav-items.ts`), so a link is shown only
 * to somebody who can open what it opens.
 */
const LINKS: QuickLink[] = [
  {
    href: "/hr-requests",
    label: "HR Requests",
    icon: TrayIcon,
    permission: "hrrequests.read",
    waiting: true,
  },
  {
    href: "/payroll/bank-advice",
    label: "Bank Advice",
    icon: BankIcon,
    permission: "payroll.read",
  },
  {
    href: "/payroll",
    label: "Payroll",
    icon: MoneyIcon,
    permission: "payroll.read",
  },
  {
    href: "/invoices/new",
    label: "Invoice Builder",
    icon: FilePlusIcon,
    permission: "transactions.write",
  },
];

export function QuickLinks() {
  const can = {
    "hrrequests.read": useCan("hrrequests.read"),
    "payroll.read": useCan("payroll.read"),
    "transactions.write": useCan("transactions.write"),
  } as Partial<Record<Permission, boolean>>;
  const shown = LINKS.filter((link) => can[link.permission]);
  if (shown.length === 0) return null;

  return (
    <nav aria-label="Quick links" className="mt-4 flex flex-wrap gap-2">
      {shown.map((link) => {
        const Glyph = link.icon;
        return (
          <Link
            key={link.href}
            href={link.href}
            className="sv-quick-link inline-flex h-9.5 items-center gap-2 rounded-lg bg-(--sv-surface) px-3 text-[13.5px] font-extrabold transition-[transform,box-shadow] duration-200 hover:-translate-y-px hover:shadow-(--sv-shadow)"
            data-quick-link={link.href}
          >
            <Glyph
              weight="duotone"
              size={18}
              className="flex-none text-(--sv-violet)"
            />
            {link.label}
            {link.waiting ? <WaitingBadge /> : null}
          </Link>
        );
      })}
    </nav>
  );
}
