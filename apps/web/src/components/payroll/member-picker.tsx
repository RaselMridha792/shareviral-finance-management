"use client";

import { formatMoney } from "@finance/shared";
import { LoaderCircle } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { EligibleMemberDto } from "@/lib/payroll";
import { cn } from "@/lib/utils";

/**
 * Who goes on the sheet — the checklist both payroll doors share.
 *
 * The same list appears when a month is started and again, for as long as the
 * run stays a draft, behind the sheet's "People" button. One component rather
 * than two, because the two moments must agree about what a person's row says:
 * the name, what they would be paid, and — for somebody with no pay recorded —
 * why they cannot be ticked.
 *
 * That last rule is the picker's one opinion. The server skips a person with
 * no compensation rather than paying them nothing; a tickable box that the
 * server would quietly ignore is a lie, so the box is disabled and the row
 * says what to do about it instead.
 */
export function MemberPicker({
  eligible,
  selected,
  onToggle,
  onAll,
  onNone,
  loading = false,
}: {
  eligible: EligibleMemberDto[] | null;
  selected: Set<string>;
  onToggle: (id: string) => void;
  onAll: () => void;
  onNone: () => void;
  loading?: boolean;
}) {
  if (loading || eligible === null) {
    return (
      <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" />
        Finding who was employed that month…
      </div>
    );
  }

  if (eligible.length === 0) {
    return (
      <p className="py-4 text-sm text-muted-foreground">
        Nobody was employed in that month. Add team members first — the sheet
        can only pay people who exist.
      </p>
    );
  }

  const payable = eligible.filter((m) => m.monthlyGross !== null);
  const chosenGross = payable
    .filter((m) => selected.has(m.id))
    .reduce((sum, m) => sum + Number(m.monthlyGross), 0);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-muted-foreground">
          <span className="num font-medium text-foreground">
            {selected.size}
          </span>{" "}
          of {payable.length} on the sheet ·{" "}
          <span className="num">{formatMoney(chosenGross.toFixed(2))}</span>{" "}
          gross
        </p>
        <span className="flex gap-1">
          <Button type="button" variant="ghost" size="sm" onClick={onAll}>
            Everyone
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onNone}>
            Nobody
          </Button>
        </span>
      </div>

      <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
        {eligible.map((member) => {
          const noPay = member.monthlyGross === null;
          return (
            <label
              key={member.id}
              className={cn(
                "flex items-center gap-3 border-b border-border px-3 py-2 text-sm last:border-b-0",
                noPay
                  ? "cursor-not-allowed opacity-60"
                  : "cursor-pointer hover:bg-surface-muted",
              )}
            >
              <input
                type="checkbox"
                className="size-4 shrink-0 accent-[var(--primary)]"
                checked={selected.has(member.id)}
                disabled={noPay}
                onChange={() => onToggle(member.id)}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">
                  {member.fullName}
                </span>
                <span className="block truncate text-xs text-muted-foreground">
                  {member.designation ?? member.department ?? "—"}
                </span>
              </span>
              {noPay ? (
                <span className="shrink-0 text-xs text-warning">
                  no pay recorded — set it on their profile
                </span>
              ) : (
                <span className="num shrink-0 text-muted-foreground">
                  {formatMoney(member.monthlyGross ?? "0")}
                </span>
              )}
            </label>
          );
        })}
      </div>
    </div>
  );
}
