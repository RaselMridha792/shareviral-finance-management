import { todayInDhaka } from "@finance/shared";
import type { ReactNode } from "react";

/**
 * The card the dashboard opens with, as the September 2026 handoff draws it:
 * violet tint, a soft violet blob and a lime one drifting behind the words, the
 * day written out, and the greeting with the reader's name in violet.
 *
 * Shared by the two dashboards — the one with the company's figures and the
 * one HR sees — so both open the same way; what sits under the greeting and at
 * the right-hand end is each one's own.
 */
export function Greeting({
  lead,
  name,
  children,
  aside,
}: {
  /** "Overview" or "Welcome" — the word before the name. */
  lead: string;
  name: string;
  /** Under the greeting: the chips, or a line of explanation. */
  children?: ReactNode;
  /** The right-hand end: the period, and the one figure worth a glance. */
  aside?: ReactNode;
}) {
  return (
    <div className="sv-hero sv-rise flex flex-wrap items-center gap-5.5 rounded-[11px] bg-(--sv-violet-tint) px-6.5 py-6">
      <div aria-hidden="true" className="sv-hero-decor absolute inset-0">
        <span className="blob-violet" />
        <span className="blob-lime" />
        <span className="square" />
      </div>

      <div className="relative min-w-65 flex-1">
        <p className="text-[12px] tracking-[0.14em] text-(--sv-violet-ink) uppercase">
          {longDate(todayInDhaka())}
        </p>
        <h1 className="mt-1.5 text-[32px] leading-[1.15] font-extrabold tracking-[-0.02em]">
          {lead}, <span className="text-(--sv-violet)">{name}</span>
        </h1>
        {children}
      </div>

      {aside ? (
        <div className="relative flex flex-col items-end gap-2.5">{aside}</div>
      ) : null}
    </div>
  );
}

/**
 * "Sunday, 27 September 2026" — the day in Dhaka, written out.
 *
 * Formatted as a UTC date on purpose: `todayInDhaka()` has already decided the
 * day, and formatting it in the browser's own timezone could move it by one.
 */
function longDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const parts = new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).formatToParts(new Date(Date.UTC(y, m - 1, d)));
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${part("weekday")}, ${part("day")} ${part("month")} ${part("year")}`;
}
