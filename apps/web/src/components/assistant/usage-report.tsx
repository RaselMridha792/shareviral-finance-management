"use client";

import { ChartBarIcon } from "@phosphor-icons/react/dist/ssr/ChartBar";
import {
  AI_MODEL_LABELS,
  type AiModel,
  type AiUsageReport,
  type AiUsageTotals,
} from "@finance/shared";
import { LoaderCircle } from "lucide-react";
import { useCallback, useEffect, useState, type FormEvent } from "react";

import { useAssistant } from "@/components/assistant/assistant-provider";
import {
  monthName,
  tokens,
  usd,
} from "@/components/assistant/usage-panel";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { TableScroll, Th } from "@/components/ui/table";
import { ApiError } from "@/lib/api-client";
import { aiApi } from "@/lib/ai";

/** The columns every breakdown shares: the calls, the tokens, the estimate. */
function TotalsCells({ totals }: { totals: AiUsageTotals }) {
  return (
    <>
      <td className="col-amount num">{tokens(totals.calls)}</td>
      <td className="col-amount num">{tokens(totals.inputTokens)}</td>
      <td className="col-amount num">{tokens(totals.cacheReadTokens)}</td>
      <td className="col-amount num">{tokens(totals.cacheWriteTokens)}</td>
      <td className="col-amount num">
        {tokens(totals.outputTokens + totals.thinkingTokens)}
      </td>
      <td className="col-amount num font-extrabold">
        {usd(totals.costUsd)}
        {totals.unpricedCalls ? (
          <span className="block text-[11px] font-normal text-(--sv-muted)">
            {tokens(totals.unpricedCalls)} not priced
          </span>
        ) : null}
      </td>
    </>
  );
}

function Breakdown<T extends AiUsageTotals>({
  title,
  first,
  rows,
  name,
  rowKey,
}: {
  title: string;
  first: string;
  rows: T[];
  name: (row: T) => string;
  rowKey: (row: T) => string;
}) {
  return (
    <section className="flex flex-col gap-2" data-usage-table={title}>
      <h3 className="text-[14px] font-extrabold">{title}</h3>
      {rows.length ? (
        <TableScroll>
          <table className="table-data w-full min-w-[640px]">
            <thead>
              <tr>
                <Th>{first}</Th>
                <Th align="right">Calls</Th>
                <Th align="right">Input</Th>
                <Th align="right">Cache read</Th>
                <Th align="right">Cache write</Th>
                <Th align="right">Output</Th>
                <Th align="right">Estimate</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={rowKey(row)}>
                  <td className="font-extrabold">{name(row)}</td>
                  <TotalsCells totals={row} />
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      ) : (
        <p className="text-[13px] text-(--sv-muted)">Nothing this month.</p>
      )}
    </section>
  );
}

/** "2026-10-04" as "4 Oct". */
function dayName(day: string): string {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date)).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/**
 * What the Assistant spends, in its settings (B3, 4 Oct 2026): a month by
 * day, person and model, the last twelve months, the prices the estimate is
 * worked out with, and the company's monthly limit.
 *
 * The CFO reads all of it and changes nothing (B2's answer); the limit is
 * the Super Admin's. Every dollar figure is an estimate from the tokens
 * each call counted and the providers' published prices, and says so: the
 * invoices are the real figures.
 */
export function UsageReportCard({ canConfigure }: { canConfigure: boolean }) {
  const { loadUsage } = useAssistant();
  const [month, setMonth] = useState<string | undefined>(undefined);
  const [report, setReport] = useState<AiUsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState("");
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async (asked?: string) => {
    try {
      const read = await aiApi.usageReport(asked);
      setReport(read);
      setLimit(read.limitUsd ?? "");
      setError(null);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "What it spends could not be read.",
      );
    }
  }, []);

  useEffect(() => {
    // Fetching the month asked for, which is what effects are for; the rule
    // cannot tell that from a cascading render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(month);
  }, [load, month]);

  async function save(next: string | null) {
    setSaving(true);
    setNote(null);
    setError(null);
    try {
      const summary = await aiApi.setUsageLimit(next);
      setNote(
        summary.limitUsd
          ? `The limit is $${summary.limitUsd} a month, from the next message.`
          : "There is no limit now.",
      );
      await Promise.all([load(month), loadUsage()]);
    } catch (caught) {
      // The field's own reason ("more than zero") rather than "Validation
      // failed".
      setError(
        caught instanceof ApiError
          ? (Object.values(caught.fieldErrors ?? {})[0]?.[0] ?? caught.message)
          : "The limit could not be saved.",
      );
    } finally {
      setSaving(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void save(limit.trim() ? limit.trim() : null);
  }

  const months = report
    ? [...new Set([report.month, ...report.months.map((one) => one.month)])]
        .sort()
        .reverse()
    : [];

  return (
    <Card id="usage">
      <CardHeader
        title="What it spends"
        icon={ChartBarIcon}
        description="Estimated from the tokens each call counted, at the providers' published prices. The invoices from Anthropic and Google are the real figures."
        action={
          months.length > 1 ? (
            <Select
              aria-label="Month"
              value={report?.month ?? ""}
              onChange={(event) => setMonth(event.target.value)}
              className="w-44"
            >
              {months.map((one) => (
                <option key={one} value={one}>
                  {monthName(one)}
                </option>
              ))}
            </Select>
          ) : null
        }
      />
      <CardBody className="flex flex-col gap-6">
        {error ? (
          <p role="alert" className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative">
            {error}
          </p>
        ) : null}

        {!report ? (
          <p className="flex items-center gap-2 text-sm text-(--sv-muted)">
            <LoaderCircle className="size-4 animate-spin" /> Reading…
          </p>
        ) : (
          <>
            <div className="grid gap-4 sm:grid-cols-3" data-usage-totals>
              <div>
                <p className="text-[12px] font-extrabold tracking-[0.06em] text-(--sv-muted) uppercase">
                  {monthName(report.month)}
                </p>
                <p className="num mt-1 text-[24px] font-extrabold">
                  {usd(report.totals.costUsd)}
                </p>
                <p className="text-[12px] text-(--sv-muted)">an estimate</p>
              </div>
              <div>
                <p className="text-[12px] font-extrabold tracking-[0.06em] text-(--sv-muted) uppercase">
                  Calls
                </p>
                <p className="num mt-1 text-[24px] font-extrabold">
                  {tokens(report.totals.calls)}
                </p>
                <p className="text-[12px] text-(--sv-muted)">
                  every round of a turn, every file read, every Test
                </p>
              </div>
              <div>
                <p className="text-[12px] font-extrabold tracking-[0.06em] text-(--sv-muted) uppercase">
                  Tokens
                </p>
                <p className="num mt-1 text-[24px] font-extrabold">
                  {tokens(
                    report.totals.inputTokens +
                      report.totals.cacheReadTokens +
                      report.totals.cacheWriteTokens +
                      report.totals.outputTokens +
                      report.totals.thinkingTokens,
                  )}
                </p>
                <p className="text-[12px] text-(--sv-muted)">
                  in and out, the cache included
                </p>
              </div>
            </div>

            {canConfigure ? (
              <form
                onSubmit={submit}
                className="flex flex-wrap items-end gap-3"
                data-usage-limit
              >
                <Field
                  label="Monthly limit, in dollars of estimated cost"
                  hint="One for the whole company. At 80% the chat warns; at 100% the Assistant stops until the 1st."
                  className="w-full max-w-sm"
                >
                  <Input
                    value={limit}
                    inputMode="decimal"
                    placeholder="No limit"
                    onChange={(event) => setLimit(event.target.value)}
                  />
                </Field>
                <Button type="submit" variant="primary" disabled={saving}>
                  {saving ? <LoaderCircle className="size-4 animate-spin" /> : null}
                  Save the limit
                </Button>
                {report.limitUsd ? (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={saving}
                    onClick={() => void save(null)}
                  >
                    Remove the limit
                  </Button>
                ) : null}
                {note ? (
                  <p className="w-full text-[13px] text-(--sv-muted)">{note}</p>
                ) : null}
              </form>
            ) : (
              <p className="text-[13.5px]" data-usage-limit>
                <span className="text-(--sv-muted)">Monthly limit: </span>
                <strong>
                  {report.limitUsd ? usd(report.limitUsd) : "none"}
                </strong>
                <span className="text-(--sv-muted)">
                  {" "}
                  — set by a Super Admin.
                </span>
              </p>
            )}

            <Breakdown
              title="By model"
              first="Model"
              rows={report.byModel}
              name={(row) => row.label}
              rowKey={(row) => `${row.provider}|${row.model}`}
            />
            <Breakdown
              title="By person"
              first="Person"
              rows={report.byPerson}
              name={(row) => row.name}
              rowKey={(row) => row.userId ?? "nobody"}
            />
            <Breakdown
              title="By day"
              first="Day"
              rows={report.byDay}
              name={(row) => dayName(row.day)}
              rowKey={(row) => row.day}
            />
            <Breakdown
              title="By month"
              first="Month"
              rows={report.months}
              name={(row) => monthName(row.month)}
              rowKey={(row) => row.month}
            />

            <details className="text-[13px]">
              <summary className="cursor-pointer font-extrabold">
                The prices the estimate is worked out with
              </summary>
              <TableScroll className="mt-2">
                <table className="table-data w-full min-w-[640px]">
                  <thead>
                    <tr>
                      <Th>Model</Th>
                      <Th>When</Th>
                      <Th align="right">Input</Th>
                      <Th align="right">Cache read</Th>
                      <Th align="right">Cache write</Th>
                      <Th align="right">Output</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {report.prices.map((price) => (
                      <tr key={`${price.model}|${price.provider}|${price.from ?? ""}`}>
                        <td className="font-extrabold">
                          {AI_MODEL_LABELS[price.model as AiModel] ?? price.model},{" "}
                          {price.provider === "vertex" ? "Google Cloud" : "Anthropic key"}
                          <span className="block text-[11px] font-normal text-(--sv-muted)">
                            {price.source}
                          </span>
                        </td>
                        <td>
                          {price.from ? `from ${price.from}` : price.until ? `to ${price.until}` : "always"}
                          {price.long ? (
                            <span className="block text-[11px] text-(--sv-muted)">
                              over 200K prompt tokens: ${price.long.input} / ${price.long.output}
                            </span>
                          ) : null}
                        </td>
                        <td className="col-amount num">${price.input}</td>
                        <td className="col-amount num">${price.cacheRead}</td>
                        <td className="col-amount num">${price.cacheWrite}</td>
                        <td className="col-amount num">${price.output}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
              <p className="mt-2 text-(--sv-muted)">
                US dollars per million tokens. Gemini&rsquo;s thinking is billed
                as output.
              </p>
            </details>
          </>
        )}
      </CardBody>
    </Card>
  );
}
