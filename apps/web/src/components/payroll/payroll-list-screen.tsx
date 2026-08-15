"use client";

import {
  PAYROLL_STATUS_LABELS,
  todayInDhaka,
  type Paginated,
} from "@finance/shared";
import { LoaderCircle, Plus, Wallet } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Amount } from "@/components/money/amount";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Drawer } from "@/components/ui/drawer";
import { Field, Select, Textarea } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { ApiError } from "@/lib/api-client";
import { payrollApi, type PayrollRunDto } from "@/lib/payroll";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export function PayrollListScreen({
  initialPage,
}: {
  initialPage: Paginated<PayrollRunDto>;
}) {
  const router = useRouter();
  const canWrite = useCan("payroll.write");
  const [creating, setCreating] = useState(false);

  return (
    <>
      <PageHeader
        title="Payroll"
        description="One run a month. Nothing leaves the bank until you say so."
        actions={
          canWrite ? (
            <Button variant="primary" size="md" onClick={() => setCreating(true)}>
              <Plus className="size-4" />
              New month
            </Button>
          ) : null
        }
      />

      {initialPage.items.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex size-11 items-center justify-center rounded-full bg-surface-muted text-muted-foreground">
            <Wallet className="size-5" />
          </span>
          <div>
            <p className="text-sm font-semibold">No payroll runs yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Start a month, build the salary sheet, type in each person&apos;s
              tax, then mark it paid — that last step is what moves money.
            </p>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="table-data min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-border bg-surface-muted/50 text-left">
                  <th className="px-4 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Month
                  </th>
                  <th className="px-4 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Status
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Gross
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Tax withheld
                  </th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Net paid
                  </th>
                  <th className="px-4 py-2.5 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
                    Paid on
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {initialPage.items.map((run) => (
                  <tr key={run.id} className="row-finance hover:bg-surface-muted/50">
                    <td className="px-4 py-2.5">
                      {/* One link per row — see the note in team-screen.tsx. */}
                      <Link
                        href={`/payroll/${run.id}`}
                        prefetch={false}
                        className="font-medium hover:text-primary hover:underline"
                      >
                        {run.label}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5">
                      <Badge
                        tone={
                          run.status === "paid"
                            ? "positive"
                            : run.status === "finalized"
                              ? "primary"
                              : "neutral"
                        }
                      >
                        {PAYROLL_STATUS_LABELS[run.status]}
                      </Badge>
                    </td>
                    <td className="px-4 py-2.5">
                      <Amount value={run.totalGross} tone="neutral" className="block" />
                    </td>
                    <td className="px-4 py-2.5">
                      <Amount value={run.totalTds} tone="neutral" className="block" />
                    </td>
                    <td className="px-4 py-2.5">
                      <Amount
                        value={run.totalNet}
                        tone="neutral"
                        className="block font-medium"
                      />
                    </td>
                    <td className="num px-4 py-2.5 text-muted-foreground">
                      {run.paymentDate ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <NewRunForm
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(id) => router.push(`/payroll/${id}`)}
      />
    </>
  );
}

function NewRunForm({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const today = todayInDhaka();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    try {
      const run = await payrollApi.createRun({
        periodYear: Number(data.get("periodYear")),
        periodMonth: Number(data.get("periodMonth")),
        notes: String(data.get("notes") ?? "") || undefined,
      });
      onCreated(run.id);
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not start that run.",
      );
      setPending(false);
    }
  }

  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));

  return (
    <Drawer open={open} onClose={onClose} title="Start a payroll month">
      <form id="run-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Month" required>
            <Select name="periodMonth" defaultValue={currentMonth}>
              {MONTHS.map((month, index) => (
                <option key={month} value={index + 1}>
                  {month}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Year" required>
            <Select name="periodYear" defaultValue={currentYear}>
              {[currentYear - 1, currentYear, currentYear + 1].map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label="Notes">
          <Textarea name="notes" />
        </Field>

        {error ? (
          <p
            role="alert"
            className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
          >
            {error}
          </p>
        ) : null}
      </form>

      <div className="mt-6 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" form="run-form" variant="primary" disabled={pending}>
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Start
        </Button>
      </div>
    </Drawer>
  );
}
