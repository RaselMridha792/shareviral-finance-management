"use client";

import { monthRange } from "@finance/shared";
import { TableIcon } from "@phosphor-icons/react/dist/ssr/Table";
import { useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { MonthPicker } from "@/components/expenses/month-picker";
import { Amount } from "@/components/money/amount";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/patterns";
import {
  SerialCell,
  SerialHead,
  TableMessageRow,
  TableScroll,
  Th,
} from "@/components/ui/table";
import { ApiError } from "@/lib/api-client";
import {
  bankStatusApi,
  type BankStatus,
  type BankStatusCheck,
  type BankStatusRow,
  type BothCurrencies,
} from "./bank-status-api";

/** SL, Account Name, five money columns, Check, Note. */
const COLUMNS = 9;

/**
 * Accounts ▸ Bank status: the BANK STATUS table the boss opens every month's
 * tab with, one row per account, in the sheet's column order.
 *
 * A month is the month an entry BELONGS to, not the month of its date: May's
 * funding that landed on 9 June is in May's IN, as it is in his May tab
 * (`books-month.ts` on the API). Opening is the previous month's Closing, and
 * Closing is what Accounts shows at the end of the month.
 */
export function BankStatusScreen({ initial }: { initial: BankStatus }) {
  const canWrite = useCan("accounts.write");
  const [status, setStatus] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [year, month] = status.month.split("-").map(Number);
  const range = monthRange(year, month);

  async function show(next: string) {
    setLoading(true);
    setError(null);
    try {
      setStatus(await bankStatusApi.month(next));
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not read the bank status for that month",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Bank status"
        icon={TableIcon}
        description="Every account's month, as the books close it: opening, in, out, fees and closing."
        actions={
          <MonthPicker
            range={{ from: range.start, to: range.end, label: range.label }}
            onChange={(next) => void show(next.from)}
          />
        }
      />

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
        >
          {error}
        </p>
      ) : null}

      <Card className="overflow-hidden" aria-busy={loading}>
        <TableScroll>
          <table
            className="table-data min-w-[1080px] text-sm"
            data-bank-status={status.month}
          >
            <thead>
              <tr>
                <SerialHead />
                <Th>Account Name</Th>
                <Th align="right">Opening</Th>
                <Th align="right">In</Th>
                <Th align="right">Out</Th>
                <Th align="right">Fee</Th>
                <Th align="right">Closing</Th>
                <Th>Check</Th>
                <Th width="w-44">Note</Th>
              </tr>
            </thead>
            <tbody>
              {status.rows.length === 0 ? (
                <TableMessageRow colSpan={COLUMNS}>
                  No accounts yet.
                </TableMessageRow>
              ) : (
                status.rows.map((row, index) => (
                  <tr key={row.accountId} data-account-id={row.accountId}>
                    <SerialCell n={index + 1} />
                    <td>
                      {/* The bank, as the sheet names the account; the
                          account's own name small under it. */}
                      <p className="font-extrabold">
                        {row.bankName || row.name}
                        {row.isActive ? null : (
                          <span className="ml-2 text-xs font-normal text-muted-foreground">
                            Archived
                          </span>
                        )}
                      </p>
                      {row.bankName ? (
                        <p className="text-xs text-muted-foreground">
                          {row.name}
                        </p>
                      ) : null}
                    </td>
                    <MoneyCell
                      value={row.opening}
                      exact={row.usdExact}
                      revaluation={row.revaluation}
                      dollarsFirst={row.currency === "USD"}
                    />
                    <MoneyCell
                      value={row.moneyIn}
                      exact={row.usdExact}
                      dollarsFirst={row.currency === "USD"}
                    />
                    <MoneyCell
                      value={row.moneyOut}
                      exact={row.usdExact}
                      dollarsFirst={row.currency === "USD"}
                    />
                    <MoneyCell
                      value={row.fee}
                      exact={row.usdExact}
                      dollarsFirst={row.currency === "USD"}
                    />
                    <MoneyCell
                      value={row.closing}
                      exact={row.usdExact}
                      dollarsFirst={row.currency === "USD"}
                      strong
                    />
                    <td>
                      <CheckCell
                        key={`${status.month}:${row.accountId}`}
                        row={row}
                        month={status.month}
                        reconciled={status.reconciled}
                        canWrite={canWrite}
                      />
                    </td>
                    <td className="cell-prose">
                      <NoteCell
                        key={`${status.month}:${row.accountId}`}
                        row={row}
                        month={status.month}
                        canWrite={canWrite}
                      />
                    </td>
                  </tr>
                ))
              )}
            </tbody>
            {status.rows.length > 0 ? (
              <tfoot>
                <tr className="font-extrabold">
                  <td />
                  <td>Total</td>
                  <MoneyCell
                    value={status.totals.opening}
                    exact={status.totals.usdExact}
                    revaluation={status.totals.revaluation}
                  />
                  <MoneyCell
                    value={status.totals.moneyIn}
                    exact={status.totals.usdExact}
                  />
                  <MoneyCell
                    value={status.totals.moneyOut}
                    exact={status.totals.usdExact}
                  />
                  <MoneyCell
                    value={status.totals.fee}
                    exact={status.totals.usdExact}
                  />
                  <MoneyCell
                    value={status.totals.closing}
                    exact={status.totals.usdExact}
                    strong
                  />
                  <td>
                    <CheckMark reconciled={status.reconciled} />
                  </td>
                  <td />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </TableScroll>
      </Card>

      <p className="text-[12.5px] text-(--sv-muted)">
        A month is the month an entry belongs to, which can differ from its
        date. Fee is the Bank charges heading; Out is every other payment and
        transfer out. Dollars are each entry&apos;s own; a ~ means some entry
        had none and was read at that day&apos;s rate. A dollar account shows
        its dollars first and the taka under them. Check reads Matched when
        the row is ticked by hand, or once a statement covering the month is
        reconciled in Reports; the cell says which.
      </p>
    </>
  );
}

/**
 * Taka, and the dollars the rows carried small under it. On the Opening, a
 * month's revaluation is in the hover text only (see below).
 */
function MoneyCell({
  value,
  exact,
  strong = false,
  revaluation,
  dollarsFirst = false,
}: {
  value: BothCurrencies;
  exact: boolean;
  strong?: boolean;
  revaluation?: BothCurrencies;
  /**
   * A dollar account reads in dollars, with the taka small under it (the
   * owner, 29 Oct 2026: "jegular currency USD oigulake USD amount ta boro kore
   * dekhate hobe"). The Total row stays taka-first: it adds both kinds.
   */
  dollarsFirst?: boolean;
}) {
  const revalued = revaluation && Number(revaluation.bdt) !== 0;
  const big = strong ? "block font-extrabold" : "block";
  const small = "block text-xs font-normal text-muted-foreground";
  const taka = (
    <Amount
      value={value.bdt}
      showCounterpart={false}
      className={dollarsFirst ? small : big}
    />
  );
  const dollars = (
    <Amount
      value={value.usd}
      currency="USD"
      approximate={!exact}
      showCounterpart={false}
      className={dollarsFirst ? big : small}
    />
  );
  /*
   * Quiet, as the sheet is (the owner, 27 Oct 2026: a line saying "incl.
   * ৳525.40 revaluation" would confuse the CEO). The Opening is the figure
   * the sheet opens on and says nothing more; the revaluation inside it is a
   * hover away, for whoever goes looking.
   */
  return (
    <td
      className="text-right"
      data-revaluation={revalued ? revaluation.bdt : undefined}
      title={
        revalued
          ? `Includes ৳${Number(revaluation.bdt).toLocaleString("en-IN", {
              minimumFractionDigits: 2,
            })} from re-reading the dollar balance at this month's rate`
          : undefined
      }
    >
      {dollarsFirst ? dollars : taka}
      {dollarsFirst ? taka : dollars}
    </td>
  );
}

/** The Total row: only the app's own reconciliation decides it. */
function CheckMark({ reconciled }: { reconciled: boolean }) {
  return reconciled ? (
    <StatusPill tone="positive">Matched</StatusPill>
  ) : (
    <span className="text-muted-foreground">—</span>
  );
}

/**
 * A row's Check: Matched when the row is ticked by hand or the month is
 * reconciled, and the line under it says which. Writers get the tick box;
 * unticking removes the hand tick only, so a reconciled month stays Matched.
 */
function CheckCell({
  row,
  month,
  reconciled,
  canWrite,
}: {
  row: BankStatusRow;
  month: string;
  reconciled: boolean;
  canWrite: boolean;
}) {
  const [check, setCheck] = useState<BankStatusCheck | null>(row.check);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const matched = Boolean(check) || reconciled;
  const byHand = check
    ? `Ticked by ${check.checkedBy ?? "someone since removed"} on ${new Date(
        check.checkedAt,
      ).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}`
    : undefined;
  const source = check
    ? reconciled
      ? "By hand · reconciled"
      : "By hand"
    : reconciled
      ? "Reconciled"
      : null;

  async function toggle(next: boolean) {
    setSaving(true);
    setMessage(null);
    try {
      const result = await bankStatusApi.saveCheck(row.accountId, month, next);
      setCheck(result.check);
    } catch (caught) {
      setMessage(
        caught instanceof ApiError
          ? caught.message
          : "Could not save the check",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <div data-check={check ? "hand" : reconciled ? "reconciled" : "none"}>
      <div className="flex items-center gap-2">
        {canWrite ? (
          <input
            type="checkbox"
            aria-label={`Check ${row.bankName || row.name} by hand`}
            checked={Boolean(check)}
            disabled={saving}
            title={byHand ?? "Tick when this row agrees with the bank"}
            onChange={(event) => void toggle(event.target.checked)}
            className="size-4 accent-primary"
          />
        ) : null}
        {matched ? (
          <span title={byHand}>
            <StatusPill tone="positive">Matched</StatusPill>
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>
      {source ? (
        <p className="mt-0.5 text-xs text-muted-foreground" title={byHand}>
          {source}
        </p>
      ) : null}
      {message ? (
        <p role="alert" className="mt-1 text-xs text-negative">
          {message}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The Note, typed in the row. Saved when the box loses focus or on Enter;
 * Escape puts back what was there. Read-only for anyone without
 * `accounts.write`.
 */
function NoteCell({
  row,
  month,
  canWrite,
}: {
  row: BankStatusRow;
  month: string;
  canWrite: boolean;
}) {
  const [saved, setSaved] = useState(row.note?.text ?? "");
  const [draft, setDraft] = useState(saved);
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  const who = row.note?.updatedBy;

  if (!canWrite) {
    return saved ? (
      <span title={who ? `Written by ${who}` : undefined}>{saved}</span>
    ) : (
      <span className="text-muted-foreground">—</span>
    );
  }

  async function save() {
    const next = draft.trim();
    if (next === saved) {
      setDraft(saved);
      return;
    }
    setState("saving");
    setMessage(null);
    try {
      const result = await bankStatusApi.saveNote(row.accountId, month, next);
      const text = result.note?.text ?? "";
      setSaved(text);
      setDraft(text);
      setState("idle");
    } catch (caught) {
      setState("error");
      setMessage(
        caught instanceof ApiError ? caught.message : "Could not save the note",
      );
    }
  }

  return (
    <div>
      <Input
        aria-label={`Note for ${row.bankName || row.name}`}
        value={draft}
        maxLength={500}
        placeholder="Add a note"
        disabled={state === "saving"}
        title={who ? `Last written by ${who}` : undefined}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void save()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setDraft(saved);
            setState("idle");
            setMessage(null);
          }
        }}
      />
      {message ? (
        <p role="alert" className="mt-1 text-xs text-negative">
          {message}
        </p>
      ) : null}
    </div>
  );
}
