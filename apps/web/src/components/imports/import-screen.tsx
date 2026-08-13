"use client";

import {
  CircleAlert,
  CircleCheck,
  Copy,
  FileSpreadsheet,
  LoaderCircle,
  RotateCcw,
  Upload,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ChangeEvent } from "react";

import { Amount } from "@/components/money/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { ApiError } from "@/lib/api-client";
import {
  importsApi,
  type ImportBatch,
  type ImportRow,
  type UploadResult,
} from "@/lib/imports";
import type { AccountDto, CategoryNode } from "@/lib/masters";
import { cn } from "@/lib/utils";

const FIELD_OPTIONS = [
  { value: "", label: "— ignore this column —" },
  { value: "txnDate", label: "Date" },
  { value: "description", label: "Description" },
  { value: "amountIn", label: "Money in" },
  { value: "amountOut", label: "Money out" },
  { value: "amount", label: "Amount (single column)" },
  { value: "direction", label: "In or out" },
  { value: "categoryName", label: "Category" },
  { value: "vendorName", label: "Paid to / received from" },
  { value: "reference", label: "Reference" },
  { value: "paymentMethod", label: "Payment method" },
  { value: "notes", label: "Notes" },
];

const STEPS = ["Choose a file", "Match the columns", "Check it", "Import"];

export function ImportScreen({
  initialBatches,
  accounts,
  categories,
}: {
  initialBatches: ImportBatch[];
  accounts: AccountDto[];
  categories: CategoryNode[];
}) {
  const router = useRouter();

  const [step, setStep] = useState(0);
  const [upload, setUpload] = useState<UploadResult | null>(null);
  const [columnMap, setColumnMap] = useState<Record<string, string | null>>({});
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [skipRows, setSkipRows] = useState<Set<number>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  async function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setBusy(true);
    setError(null);
    try {
      const result = await importsApi.upload(file);
      setUpload(result);
      setColumnMap(result.suggestion);
      setBatch(result.batch);
      setStep(1);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not read that file.",
      );
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function applyMapping(form: FormData) {
    if (!batch) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await importsApi.applyMapping(batch.id, {
        columnMap,
        defaults: {
          accountId: String(form.get("accountId")),
          dateFormat: String(form.get("dateFormat")),
          fallbackCategoryId:
            String(form.get("fallbackCategoryId") || "") || undefined,
          assumeDirection:
            (String(form.get("assumeDirection") || "") as "in" | "out") ||
            undefined,
        },
      });
      setBatch(updated);
      const preview = await importsApi.preview(batch.id);
      setRows(preview.rows);
      // Duplicates start unticked — the safe default is not to import them.
      setSkipRows(
        new Set(
          preview.rows
            .filter((row) => row.status === "duplicate")
            .map((row) => row.rowNumber),
        ),
      );
      setStep(2);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not map that.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    if (!batch) return;
    setBusy(true);
    setError(null);
    try {
      const result = await importsApi.commit(batch.id, [...skipRows]);
      setDone(result.imported);
      setStep(3);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not import.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function revert(id: string) {
    setBusy(true);
    setError(null);
    try {
      await importsApi.revert(id);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not revert.",
      );
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    setStep(0);
    setUpload(null);
    setBatch(null);
    setRows([]);
    setSkipRows(new Set());
    setDone(null);
    setError(null);
  }

  return (
    <>
      <PageHeader
        title="Import from Excel"
        description="Bring in past transactions from a spreadsheet or bank export."
      />

      <ol className="flex flex-wrap gap-2">
        {STEPS.map((label, index) => (
          <li
            key={label}
            className={cn(
              "flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm",
              index === step
                ? "border-primary bg-primary/10 text-primary"
                : index < step
                  ? "border-border text-muted-foreground"
                  : "border-border text-muted-foreground opacity-55",
            )}
          >
            <span className="num text-xs font-semibold">{index + 1}</span>
            {label}
          </li>
        ))}
      </ol>

      {error ? (
        <p
          role="alert"
          className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
        >
          {error}
        </p>
      ) : null}

      {step === 0 ? (
        <Card className="flex flex-col items-center gap-4 px-6 py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
            <FileSpreadsheet className="size-6" />
          </span>
          <div>
            <p className="text-sm font-semibold">Choose a spreadsheet</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              An .xlsx file or a CSV from your bank. The first row must be the
              column headings. Nothing is saved until you have checked it.
            </p>
          </div>
          <label className="cursor-pointer">
            <input
              type="file"
              accept=".xlsx,.xls,.csv"
              onChange={onFile}
              disabled={busy}
              className="sr-only"
            />
            <span className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition hover:opacity-90">
              {busy ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Upload className="size-4" />
              )}
              Choose file
            </span>
          </label>
        </Card>
      ) : null}

      {step === 1 && upload ? (
        <form
          action={applyMapping}
          className="flex flex-col gap-4"
        >
          <Card>
            <CardHeader
              title="Match the columns"
              description={`${upload.batch.filename} — ${upload.batch.totalRows} rows`}
            />
            <CardBody className="flex flex-col gap-4">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[560px] text-sm">
                  <thead>
                    <tr className="border-b border-border text-left">
                      <th className="px-3 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        Your column
                      </th>
                      <th className="px-3 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        First few values
                      </th>
                      <th className="px-3 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                        Becomes
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {upload.headers.map((header) => (
                      <tr key={header}>
                        <td className="px-3 py-2 font-medium">{header}</td>
                        <td className="px-3 py-2 text-xs text-muted-foreground">
                          {upload.sample
                            .map((row) => row[header])
                            .filter(Boolean)
                            .slice(0, 3)
                            .join(" · ") || "—"}
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={columnMap[header] ?? ""}
                            onChange={(event) =>
                              setColumnMap((prev) => ({
                                ...prev,
                                [header]: event.target.value || null,
                              }))
                            }
                            className="h-9 w-full rounded-lg border border-border bg-surface-muted px-2 text-sm outline-none focus-visible:border-primary"
                          >
                            {FIELD_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Applies to every row"
              description="What the spreadsheet does not say"
            />
            <CardBody className="grid gap-4 sm:grid-cols-2">
              <Field label="Which account" required>
                <Select name="accountId" required defaultValue={accounts[0]?.id}>
                  {accounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field
                label="How dates are written"
                hint="05/08/2026 is 5 August or 8 May depending on this"
              >
                <Select name="dateFormat" defaultValue="dmy">
                  <option value="dmy">Day first — 05/08/2026 is 5 August</option>
                  <option value="mdy">Month first — 05/08/2026 is 8 May</option>
                  <option value="ymd">Year first — 2026-08-05</option>
                  <option value="auto">Work it out from the file</option>
                </Select>
              </Field>

              <Field
                label="Category when the file has none"
                hint="Rows without a recognised category use this"
              >
                <Select name="fallbackCategoryId" defaultValue="">
                  <option value="">— none, flag those rows —</option>
                  {categories.map((group) => (
                    <optgroup key={group.id} label={group.name}>
                      <option value={group.id}>{group.name} (general)</option>
                      {group.children.map((child) => (
                        <option key={child.id} value={child.id}>
                          {child.name}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </Select>
              </Field>

              <Field
                label="If there is one unsigned amount column"
                hint="Only used when nothing else says which way money went"
              >
                <Select name="assumeDirection" defaultValue="">
                  <option value="">— do not assume —</option>
                  <option value="out">All money out</option>
                  <option value="in">All money in</option>
                </Select>
              </Field>
            </CardBody>
          </Card>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={reset}>
              Start over
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
              Check it
            </Button>
          </div>
        </form>
      ) : null}

      {step === 2 && batch ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            <Stat
              label="Ready to import"
              value={batch.validRows}
              tone="positive"
            />
            <Stat
              label="Look like duplicates"
              value={batch.duplicateRows}
              tone="warning"
              hint="Unticked by default"
            />
            <Stat label="Have problems" value={batch.errorRows} tone="negative" />
          </div>

          <Card className="overflow-hidden">
            <CardHeader
              title="Every row"
              description="Untick anything you do not want brought in"
            />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted/50 text-left">
                    <th className="w-10 px-3 py-2" />
                    <th className="w-12 px-3 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      #
                    </th>
                    <th className="w-28 px-3 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      Date
                    </th>
                    <th className="px-3 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      Description
                    </th>
                    <th className="w-32 px-3 py-2 text-right text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      Amount
                    </th>
                    <th className="w-44 px-3 py-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.map((row) => {
                    const bad = row.status === "error";
                    const mapped = row.mapped as
                      | { txnDate?: string; description?: string; amount?: string; direction?: "in" | "out" }
                      | null;
                    return (
                      <tr
                        key={row.id}
                        className={cn("row-finance", bad && "opacity-70")}
                      >
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            disabled={bad}
                            checked={!bad && !skipRows.has(row.rowNumber)}
                            onChange={(event) => {
                              setSkipRows((prev) => {
                                const next = new Set(prev);
                                if (event.target.checked) next.delete(row.rowNumber);
                                else next.add(row.rowNumber);
                                return next;
                              });
                            }}
                            className="size-4 accent-primary"
                          />
                        </td>
                        <td className="num px-3 py-2 text-xs text-muted-foreground">
                          {row.rowNumber}
                        </td>
                        <td className="num px-3 py-2">{mapped?.txnDate ?? "—"}</td>
                        <td className="px-3 py-2">
                          {mapped?.description ??
                            Object.values(row.raw).filter(Boolean)[0] ??
                            "—"}
                        </td>
                        <td className="px-3 py-2">
                          {mapped?.amount ? (
                            <Amount
                              value={mapped.amount}
                              showSign={false}
                              tone={mapped.direction === "in" ? "in" : "out"}
                              className="block"
                            />
                          ) : (
                            <span className="col-amount block text-muted-foreground">
                              —
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {row.status === "error" ? (
                            <span className="text-xs text-negative">
                              {row.errors?.join("; ")}
                            </span>
                          ) : row.status === "duplicate" ? (
                            <Badge tone="warning">
                              <Copy className="size-3" />
                              probably already recorded
                            </Badge>
                          ) : (
                            <Badge tone="positive">ready</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              <span className="num">
                {rows.filter(
                  (r) => r.status !== "error" && !skipRows.has(r.rowNumber),
                ).length}
              </span>{" "}
              will be imported
            </p>
            <div className="flex gap-2">
              <Button variant="secondary" onClick={reset}>
                Start over
              </Button>
              <Button variant="primary" onClick={commit} disabled={busy}>
                {busy ? <LoaderCircle className="size-4 animate-spin" /> : null}
                Import them
              </Button>
            </div>
          </div>
        </>
      ) : null}

      {step === 3 ? (
        <Card className="flex flex-col items-center gap-4 px-6 py-14 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-positive/15 text-positive">
            <CircleCheck className="size-6" />
          </span>
          <div>
            <p className="text-sm font-semibold">
              <span className="num">{done}</span> entries imported
            </p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              They are in the ledger now. If the whole file turns out to be
              wrong, it can be reverted below — but only while none of its
              entries have been edited.
            </p>
          </div>
          <Button variant="primary" onClick={reset}>
            Import another file
          </Button>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Past imports" description="Most recent first" />
        <CardBody className="p-0">
          {initialBatches.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">
              Nothing imported yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <tbody className="divide-y divide-border">
                  {initialBatches.map((entry) => (
                    <tr key={entry.id} className="row-finance">
                      <td className="px-5 py-2.5 font-medium">
                        {entry.filename}
                      </td>
                      <td className="num px-5 py-2.5 text-xs text-muted-foreground">
                        {entry.createdAt.slice(0, 10)}
                      </td>
                      <td className="num px-5 py-2.5 text-xs text-muted-foreground">
                        {entry.importedRows} of {entry.totalRows} rows
                      </td>
                      <td className="px-5 py-2.5">
                        <Badge
                          tone={
                            entry.status === "committed"
                              ? "positive"
                              : entry.status === "reverted"
                                ? "negative"
                                : "neutral"
                          }
                        >
                          {entry.status}
                        </Badge>
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        {entry.status === "committed" ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => revert(entry.id)}
                          >
                            <RotateCcw className="size-3.5" />
                            Revert
                          </Button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </>
  );
}

function Stat({
  label,
  value,
  tone,
  hint,
}: {
  label: string;
  value: number;
  tone: "positive" | "warning" | "negative";
  hint?: string;
}) {
  const Icon = tone === "positive" ? CircleCheck : CircleAlert;
  return (
    <Card className="p-5">
      <div className="flex items-center gap-2">
        <Icon
          className={cn(
            "size-4",
            tone === "positive" && "text-positive",
            tone === "warning" && "text-warning",
            tone === "negative" && "text-negative",
          )}
        />
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          {label}
        </p>
      </div>
      <p className="num mt-2 text-2xl font-semibold">{value}</p>
      {hint ? (
        <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      ) : null}
    </Card>
  );
}
