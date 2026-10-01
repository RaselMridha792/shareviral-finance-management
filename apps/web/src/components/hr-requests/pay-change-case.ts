import type { HrRequestDetailDto } from "@/lib/hr-requests";

/**
 * What approving a pay change would do to the salary record, read from the
 * figures on file (#128). The pop-up's note and the approval drawer's
 * sentence both say it, so both read it from here; the API decides the same
 * way when it approves (`approvePayChange`).
 */
export type PayChangeCase =
  /** A row starts on that date with this figure: nothing is written. */
  | { kind: "same-date" }
  /** This figure is in force for that date from earlier: a row of its own
      is written from that date, and pay does not change. */
  | { kind: "same-figure"; from: string }
  /** A later change starts in the same month: a month's sheet takes the
      figure in force at its end, so this figure reaches no sheet. */
  | { kind: "no-month"; next: string }
  /** A later change is on file: this figure holds until it. */
  | { kind: "until-next"; next: string }
  /** A new figure from that date on. */
  | { kind: "new" };

export function payChangeCase(detail: HrRequestDetailDto): PayChangeCase {
  const same =
    detail.onFileAmount !== null &&
    Number(detail.onFileAmount) === Number(detail.amount);
  if (same && detail.onFileFrom === detail.effectiveOn) {
    return { kind: "same-date" };
  }
  if (same && detail.onFileFrom !== null) {
    return { kind: "same-figure", from: detail.onFileFrom };
  }
  if (detail.nextChangeOn !== null) {
    return reachesNoMonth(detail)
      ? { kind: "no-month", next: detail.nextChangeOn }
      : { kind: "until-next", next: detail.nextChangeOn };
  }
  return { kind: "new" };
}

/**
 * Whether the next change on file starts in the pay change's own month, so
 * that it, not this figure, is what that month's sheet pays. Both dates are
 * YYYY-MM-DD and the next change is after this one, so the same year and
 * month means it starts on or before this month's last day.
 */
export function reachesNoMonth(detail: HrRequestDetailDto): boolean {
  return (
    detail.nextChangeOn !== null &&
    detail.nextChangeOn.slice(0, 7) === detail.effectiveOn.slice(0, 7)
  );
}
