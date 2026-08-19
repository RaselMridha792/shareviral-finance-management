"use client";

import { todayInDhaka } from "@finance/shared";
import { LoaderCircle, Plus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Button } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { DateInput, Field, Input } from "@/components/ui/field";
import { ApiError } from "@/lib/api-client";
import { fxApi, type FxRateDto } from "@/lib/reports";

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
  const [adding, setAdding] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      setRates(await fxApi.rates(30));
    } catch {
      setRates([]);
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, []);

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

  return (
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

      <div className="overflow-x-auto">
        <table className="table-data min-w-[420px] text-sm">
          <thead>
            <tr className="text-left">
              <th className="px-4 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Date
              </th>
              <th className="px-4 py-2.5 text-right text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Rate
              </th>
              <th className="px-4 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                Note
              </th>
            </tr>
          </thead>
          <tbody>
            {rates === null ? (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                >
                  Loading…
                </td>
              </tr>
            ) : rates.length === 0 ? (
              <tr>
                <td
                  colSpan={3}
                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                >
                  No rates recorded. Until one is, USD reports show taka and say
                  so rather than guessing.
                </td>
              </tr>
            ) : (
              rates.map((rate) => (
                <tr key={rate.id} className="row-finance">
                  <td className="num px-4 py-2.5">{rate.rateDate}</td>
                  <td className="num px-4 py-2.5 text-right font-medium">
                    {Number(rate.rate).toFixed(2)}
                  </td>
                  <td className="cell-prose px-4 py-2.5 text-muted-foreground">
                    {rate.notes ?? "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
