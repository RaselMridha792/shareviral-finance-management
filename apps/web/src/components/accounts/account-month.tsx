"use client";

import { CalendarBlankIcon } from "@phosphor-icons/react/dist/ssr/CalendarBlank";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";

import { Amount } from "@/components/money/amount";
import type { Range } from "@/components/expenses/month-picker";
import { ApiError } from "@/lib/api-client";
import {
  bankStatusApi,
  type BankStatusRow,
  type BothCurrencies,
} from "./bank-status-api";
import { Panel } from "./panel";

/**
 * One account's month: where it opened, what came in and went out, where it
 * closed (the owner, 28 Oct 2026: pick a month at the top of a single
 * account and see its opening and closing).
 *
 * Read off Bank status's own row for the account, so the two screens cannot
 * disagree — the same books month, the same Fee heading, and the same rule
 * for dollars: a dollar account's dollars are its own, a taka account's are
 * its taka at the month's rate. The figure an account is kept in leads.
 */
export function AccountMonth({
  accountId,
  currency,
  month,
}: {
  accountId: string;
  currency: string;
  month: Range;
}) {
  const [row, setRow] = useState<BankStatusRow | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    bankStatusApi
      .month(month.from)
      .then((status) => {
        if (!alive) return;
        setRow(status.rows.find((r) => r.accountId === accountId) ?? null);
        setError(null);
      })
      .catch((caught) => {
        if (!alive) return;
        setError(
          caught instanceof ApiError ? caught.message : "Could not load it.",
        );
      });
    return () => {
      alive = false;
    };
  }, [accountId, month.from]);

  const dollarsLead = currency !== "BDT";
  const tiles: { label: string; value: BothCurrencies; tone?: string }[] = row
    ? [
        { label: "Opening balance", value: row.opening },
        { label: "In", value: row.moneyIn, tone: "text-(--sv-pos)" },
        {
          label: Number(row.fee.bdt) ? "Out, fee apart" : "Out",
          value: row.moneyOut,
          tone: "text-(--sv-neg)",
        },
        ...(Number(row.fee.bdt)
          ? [{ label: "Fee", value: row.fee, tone: "text-(--sv-neg)" }]
          : []),
        { label: "Closing balance", value: row.closing },
      ]
    : [];

  return (
    <Panel
      icon={CalendarBlankIcon}
      title={month.label}
      description="Opening, what moved, and closing — by the month each entry belongs to, as on Bank status"
    >
      {error ? (
        <p className="px-5 py-5 text-sm text-negative">{error}</p>
      ) : row === undefined ? (
        <p className="flex items-center gap-2 px-5 py-5 text-sm text-muted-foreground">
          <LoaderCircle className="size-4 animate-spin" /> Loading…
        </p>
      ) : row === null ? (
        <p className="px-5 py-5 text-sm text-muted-foreground">
          Nothing moved in {month.label}, and the account is archived.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 px-5 py-[18px]">
          {tiles.map((tile) => (
            <div
              key={tile.label}
              className="sv-tile rounded-[11px] bg-(--sv-subtle) p-4"
              data-month-tile={tile.label}
            >
              <p className="text-[11px] font-extrabold tracking-[0.12em] text-(--sv-muted) uppercase">
                {tile.label}
              </p>
              <p
                className={`mt-1.5 text-[20px] font-extrabold tabular-nums ${tile.tone ?? ""}`}
              >
                <Amount
                  value={dollarsLead ? tile.value.usd : tile.value.bdt}
                  currency={dollarsLead ? "USD" : undefined}
                  showCounterpart={false}
                  tone="neutral"
                />
              </p>
              <p className="mt-0.5 text-[12.5px] text-(--sv-muted) tabular-nums">
                ≈{" "}
                <Amount
                  value={dollarsLead ? tile.value.bdt : tile.value.usd}
                  currency={dollarsLead ? undefined : "USD"}
                  showCounterpart={false}
                  tone="neutral"
                />
              </p>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
