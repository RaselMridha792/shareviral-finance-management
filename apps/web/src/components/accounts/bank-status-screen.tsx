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
                    <MoneyCell value={row.opening} exact={row.usdExact} />
                    <MoneyCell value={row.moneyIn} exact={row.usdExact} />
                    <MoneyCell value={row.moneyOut} exact={row.usdExact} />
                    <MoneyCell value={row.fee} exact={row.usdExact} />
                    <MoneyCell
                      value={row.closing}
                      exact={row.usdExact}
                      strong
                    />
                    <td>
                      <CheckMark reconciled={status.reconciled} />
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
        had none and was read at that day&apos;s rate. Check reads Matched once
        a statement covering the month is reconciled in Reports.
      </p>
    </>
  );
}

/** Taka, and the dollars the rows carried small under it. */
function MoneyCell({
  value,
  exact,
  strong = false,
}: {
  value: BothCurrencies;
  exact: boolean;
  strong?: boolean;
}) {
  return (
    <td className="text-right">
      <Amount
        value={value.bdt}
        showCounterpart={false}
        className={strong ? "block font-extrabold" : "block"}
      />
      <Amount
        value={value.usd}
        currency="USD"
        approximate={!exact}
        showCounterpart={false}
        className="block text-xs font-normal text-muted-foreground"
      />
    </td>
  );
}

/** Never typed: the app's own reconciliation decides it. */
function CheckMark({ reconciled }: { reconciled: boolean }) {
  return reconciled ? (
    <StatusPill tone="positive">Matched</StatusPill>
  ) : (
    <span className="text-muted-foreground">—</span>
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
