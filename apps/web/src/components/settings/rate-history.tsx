"use client";

import { todayInDhaka } from "@finance/shared";
import { LoaderCircle, Plus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { DateInput, Field, Input } from "@/components/ui/field";
import { useRowDelete } from "@/components/ui/use-row-delete";
import { RowActions, RowActionsHead } from "@/components/ui/row-actions";
import {
  SerialCell,
  SerialHead,
  TableMessageRow,
  TableScroll,
  Th,
} from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { ApiError } from "@/lib/api-client";
import { fxApi, type FxRateDto } from "@/lib/reports";
import { formatDate } from "@/lib/utils";

/**
 * The daily USD rate, kept as a history rather than one current number.
 *
 * A report for July has to be translatable at July's rate long after July —
 * otherwise re-opening an old month shows different dollars every time,
 * and none of them are wrong, which is worse.
 */
export function RateHistory() {
  const canWrite = useCan("settings.write");
  const [rates, setRates] = useState<FxRateDto[] | null>(null);
  /** A failed load is not an empty one, and must not read as one. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The row being asked about, not a boolean — the dialog names the day. */


  async function load(target = page) {
    try {
      setLoadError(null);
      // Was `rates(30)` — a cap, so the thirty-first rate existed and could
      // not be reached from anywhere.
      const result = await fxApi.rates(target);
      setRates(result.items);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch (caught) {
      /*
       * This set `[]`, which the table renders as "No rates recorded. Until one
       * is, USD reports show taka and say so rather than guessing." — a
       * confident, specific, wrong statement about the company's books, printed
       * because a request failed.
       *
       * A request that did not answer says nothing about how many rates exist.
       */
      setRates(null);
      setLoadError(
        caught instanceof ApiError
          ? caught.message
          : "Could not load the rate history.",
      );
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    try {
      await fxApi.set({
        rate: String(data.get("rate") ?? "").trim(),
        rateDate: String(data.get("rateDate") ?? ""),
        notes: String(data.get("notes") ?? "") || undefined,
      });
      setAdding(false);
      await load();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not record that rate.",
      );
    } finally {
      setPending(false);
    }
  }

  /*
   * The rate goes to the trash like everything else now, rather than out of
   * the database on one click.
   *
   * This screen had the app's only real delete, and it was the reason: a rate
   * is a claim about a day, so there is nothing to void. But irreversible was
   * never part of that argument — it was simply the only kind of delete that
   * existed. A wrong rate typed for the wrong day is now recoverable like any
   * other mistake, and the warning below is the one this screen already had,
   * because it says the thing worth saying.
   */
  const del = useRowDelete<FxRateDto>({
    kind: "fx-rate",
    subject: "rate",
    describe: (rate) => (
      <div className="flex flex-col">
        <span className="font-medium">
          <span className="num">{Number(rate.rate).toFixed(2)}</span> per USD
        </span>
        <span className="text-xs text-muted-foreground">{formatDate(rate.rateDate)}</span>
      </div>
    ),
    consequences: (
      <p>
        Every USD figure for that day is translated at this rate. Without it,
        the period falls back to the nearest earlier rate, or shows taka if
        there is none — so a report you have already sent somebody may read
        differently the next time it is opened.
      </p>
    ),
    onDone: () => void load(),
  });

  return (
    <>
      <Card className="overflow-hidden">
        <CardHeader
          title="Rate history"
          description="One rate per day. A report is translated at the rate that applied to its period, not today's."
          action={
            canWrite ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={() => setAdding(!adding)}
              >
                <Plus className="size-3.5" />
                Record a rate
              </Button>
            ) : null
          }
        />

        {adding ? (
          <form
            onSubmit={onSubmit}
            className="flex flex-col gap-4 border-b border-border bg-surface-muted/30 px-4 py-4"
          >
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Date" required>
                <DateInput
                  name="rateDate"
                  defaultValue={todayInDhaka()}
                  max={todayInDhaka()}
                />
              </Field>
              <Field label="BDT for one USD" required>
                <Input
                  name="rate"
                  className="num"
                  placeholder="118.40"
                  autoFocus
                />
              </Field>
              <Field label="Note">
                <Input name="notes" placeholder="Where it came from" />
              </Field>
            </div>

            {error ? (
              <p role="alert" className="text-sm text-negative">
                {error}
              </p>
            ) : null}

            <div className="flex gap-2">
              <Button
                type="submit"
                variant="primary"
                size="sm"
                disabled={pending}
              >
                {pending ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : null}
                Save
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setAdding(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : null}

        <TableScroll>
          <table className="table-data min-w-140 text-sm">
            <thead>
              <tr className="text-left">
                <SerialHead />
                <Th>Date</Th>
                <Th align="right">USD rate</Th>
                <Th>Note</Th>
                <RowActionsHead />
              </tr>
            </thead>
            <tbody>
              {loadError ? (
                <TableMessageRow colSpan={5} tone="error">
                  {loadError}
                </TableMessageRow>
              ) : rates === null ? (
                <TableMessageRow colSpan={5}>Loading…</TableMessageRow>
              ) : rates.length === 0 ? (
                <TableMessageRow colSpan={5}>
                  No rates recorded. Until one is, USD reports show taka and say
                  so rather than guessing.
                </TableMessageRow>
              ) : (
                rates.map((rate, index) => (
                  <tr key={rate.id} className="row-finance">
                    <SerialCell n={index + 1} />
                    <td className="num">{formatDate(rate.rateDate)}</td>
                    <td className="num text-right font-medium">
                      {Number(rate.rate).toFixed(2)}
                    </td>
                    <td className="cell-prose text-muted-foreground">
                      {rate.notes ?? "N/A"}
                    </td>
                    {/*
                      There is no per-row editor to open — a day's number is
                      corrected by recording it again through the form above. So
                      Edit renders disabled rather than absent, and a reader who
                      cannot write sees the same pair greyed out: an empty cell
                      here would read as a rendering fault, not as a refusal.
                    */}
                    <RowActions
                      second="delete"
                      onSecond={canWrite ? () => del.ask(rate) : undefined}
                    />
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </TableScroll>
      </Card>

      {/* Outside the Card, so it survives the page that has no rows on it —
          which is the page somebody most needs it to get back from. */}
      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        noun="rate"
        onPage={setPage}
      />

      {/*
        A rate is not one row's worth of data — it governs every dollar figure
        printed for its period. Deleting it on a misclick would quietly change
        numbers on reports nobody happens to be looking at, so it is asked for
        first, with the day and the number in the question.
      */}
      {del.dialog}
    </>
  );
}
