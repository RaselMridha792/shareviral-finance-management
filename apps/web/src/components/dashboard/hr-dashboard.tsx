import type { PendingItem } from "@finance/shared";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/ssr/ArrowRight";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/ssr/UsersThree";
import Link from "next/link";

import { Greeting } from "@/components/dashboard/greeting";
import { PendingCard } from "@/components/dashboard/pending-card";

/**
 * What HR sees when they sign in.
 *
 * A separate screen rather than the overview with its figures blanked out. An
 * empty tile invites the question "why is this zero"; a page that never asked
 * for the figure has nothing to explain, and the boundary stays a fact about
 * the request rather than a rule about the rendering.
 *
 * It opens with the same greeting card as the overview, so the two dashboards
 * are recognisably one app; under it, the handoff's empty-state card.
 */
export function HrDashboard({
  firstName,
  pending,
}: {
  firstName: string;
  pending: PendingItem[];
}) {
  return (
    <>
      <Greeting lead="Welcome" name={firstName}>
        <p className="mt-2 text-[14.5px] text-(--sv-muted)">
          Your work lives under Team.
        </p>
      </Greeting>

      <div
        className="sv-card sv-rise flex flex-col items-center gap-3 rounded-[14px] bg-(--sv-surface) px-6 py-14 text-center"
        style={{ animationDelay: "0.08s" }}
      >
        <span className="grid size-16 place-items-center rounded-full bg-(--sv-lime-tint) text-(--sv-violet-ink)">
          <UsersThreeIcon weight="duotone" size={30} />
        </span>
        {/*
          This said "balances, payroll and pay are held elsewhere", which
          stopped being true when HR was given compensation and the salary
          sheet. A dashboard that describes the wrong account is worse than an
          empty one: the person believes it and stops looking.
        */}
        <p className="text-[19px] font-extrabold">
          The company&apos;s own figures are not on this account
        </p>
        <p className="max-w-[46ch] text-[14.5px] text-(--sv-muted)">
          Bank balances and the monthly reports sit with Finance. People, pay
          and the salary sheet are yours — they are in the sidebar.
        </p>
        <Link
          href="/team"
          className="inline-flex items-center gap-1.5 text-[14px] font-extrabold text-(--sv-violet-ink) hover:text-(--sv-ink)"
        >
          Go to Team
          <ArrowRightIcon weight="bold" size={14} />
        </Link>
      </div>

      {pending.length ? <PendingCard items={pending} /> : null}
    </>
  );
}
