"use client";

import {
  PAYROLL_STATUS_LABELS,
  isSelectableMonth,
  nearestSelectableMonth,
  recordYears,
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
import { SerialCell, SerialHead, TableScroll, Th } from "@/components/ui/table";
import { ApiError } from "@/lib/api-client";
import { payrollApi, type PayrollRunDto } from "@/lib/payroll";

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
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
        icon="payments"
        description="One run a month. Nothing leaves the bank until you say so."
        actions={
          canWrite ? (
            <Button
              variant="primary"
              size="md"
              onClick={() => setCreating(true)}
            >
              <Plus className="size-4" />
              New month
            </Button>
          ) : null
        }
      />

      {initialPage.items.length === 0 ? (
        <Card className="flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="flex size-[52px] items-center justify-center rounded-full bg-primary/15 text-primary-text">
            <Wallet className="size-6" />
          </span>
          <div>
            <p className="text-lg font-semibold">No payroll runs yet</p>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Start a month, build the salary sheet, type in each person&apos;s
              tax, then mark it paid — that last step is what moves money.
            </p>
          </div>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <TableScroll>
            <table className="table-data min-w-[820px] text-sm">
              <thead>
                <tr className="text-left">
                  <SerialHead />
                  <Th width="w-28">Paid on</Th>
                  <Th width="w-40">Month</Th>
                  <Th width="w-32" align="right">
                    Gross
                  </Th>
                  <Th width="w-32" align="right">
                    Tax withheld
                  </Th>
                  <Th width="w-32" align="right">
                    Net paid
                  </Th>
                  <Th width="w-28">Status</Th>
                </tr>
              </thead>
              <tbody>
                {initialPage.items.map((run, index) => (
                  <tr key={run.id} className="row-finance">
                    <SerialCell n={index + 1} />
                    <td className="num text-muted-foreground">
                      {run.paymentDate ?? "—"}
                    </td>
                    <td>
                      {/* One link per row — see the note in team-screen.tsx. */}
                      <Link
                        href={`/payroll/${run.id}`}
                        prefetch={false}
                        className="font-medium hover:text-primary hover:underline"
                      >
                        {run.label}
                      </Link>
                    </td>
                    <td className="text-right">
                      <Amount
                        value={run.totalGross}
                        tone="neutral"
                        className="block"
                      />
                    </td>
                    <td className="text-right">
                      <Amount
                        value={run.totalTds}
                        tone="neutral"
                        className="block"
                      />
                    </td>
                    <td className="text-right">
                      <Amount
                        value={run.totalNet}
                        tone="neutral"
                        className="block font-medium"
                      />
                    </td>
                    <td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
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

  const currentYear = Number(today.slice(0, 4));
  const currentMonth = Number(today.slice(5, 7));

  /**
   * Controlled, so the month list can grey out what the chosen year cannot
   * have.
   *
   * These were uncontrolled `defaultValue` selects, which meant the two boxes
   * could not see each other: picking a year could not tell the month list that
   * half its options had just become impossible. This is the picker that
   * *writes* — an accidental payroll run for a month that has not happened
   * creates a period, generates lines from today's salaries, and has to be
   * unpicked by hand.
   */
  const [year, setYear] = useState(currentYear);
  const [month, setMonth] = useState(currentMonth);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const data = new FormData(event.currentTarget);
    try {
      const run = await payrollApi.createRun({
        periodYear: year,
        periodMonth: month,
        notes: String(data.get("notes") ?? "") || undefined,
      });
      onCreated(run.id);
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not start that run.",
      );
      setPending(false);
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title="Start a payroll month">
      <form id="run-form" onSubmit={onSubmit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Month" required>
            <Select
              value={month}
              onChange={(event) => setMonth(Number(event.target.value))}
            >
              {MONTHS.map((name, index) => (
                <option
                  key={name}
                  value={index + 1}
                  disabled={!isSelectableMonth(year, index + 1)}
                >
                  {name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Year" required>
            {/*
              2026 onwards, growing on its own. It used to offer next year as
              well — a payroll month that has not happened, generated from
              today's salaries and frozen against a period nobody has worked.
            */}
            <Select
              value={year}
              onChange={(event) => {
                const next = Number(event.target.value);
                setYear(next);
                // Changing the year can strand the month: December in a past
                // year is fine, December in this one is not yet.
                setMonth((current) => nearestSelectableMonth(next, current));
              }}
            >
              {recordYears().map((option) => (
                <option key={option} value={option}>
                  {option}
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
        <Button
          type="submit"
          form="run-form"
          variant="primary"
          disabled={pending}
        >
          {pending ? <LoaderCircle className="size-4 animate-spin" /> : null}
          Start
        </Button>
      </div>
    </Drawer>
  );
}
