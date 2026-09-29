"use client";

import { BankIcon } from "@phosphor-icons/react/dist/ssr/Bank";
import { FilePlusIcon } from "@phosphor-icons/react/dist/ssr/FilePlus";
import { PlusCircleIcon } from "@phosphor-icons/react/dist/ssr/PlusCircle";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { Amount } from "@/components/money/amount";
import {
  AdviceDetailsDrawer,
  FromPayrollDrawer,
} from "@/components/payroll/bank-advice/advice-drawers";
import { PayrollTabs } from "@/components/payroll/payroll-tabs";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/patterns";
import { rowOpener } from "@/components/ui/row-details";
import { RowActions, RowActionsHead } from "@/components/ui/row-actions";
import { SearchField } from "@/components/ui/search-field";
import {
  SerialCell,
  SerialHead,
  TableMessageRow,
  TableScroll,
  Th,
} from "@/components/ui/table";
import { useRowDelete } from "@/components/ui/use-row-delete";
import { bankAdviceApi, type BankAdviceRowDto } from "@/lib/bank-advice";
import type { AccountDto } from "@/lib/masters";
import { serial } from "@/lib/pagination";
import type { PayrollRunDto } from "@/lib/payroll";
import { formatDate } from "@/lib/utils";

const COLUMNS = 10;

/**
 * Bank Advice — every payment file made for the bank, newest first.
 *
 * The owner, 29 Sep 2026: *"amake every month bank a ekta excel sheet submit
 * korte hoy jeta manually banano onek problem ... etay sobgula excel sundor
 * vabe table a list kora thakbe edit delete update kora jabe. eta mainly
 * generate hobe payroll theke"*.
 *
 * A row is a file: which month's salaries, the account they leave from, the
 * value date, how many payments and how much, and whether it has gone to the
 * bank yet (downloaded, and by whom). A click opens it; the bin sends it to
 * the trash, where Settings → Trashed can put it back.
 */
export function AdviceListScreen({
  runs,
  accounts,
}: {
  runs: PayrollRunDto[];
  accounts: AccountDto[];
}) {
  const router = useRouter();
  const canPay = useCan("payroll.pay");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<BankAdviceRowDto[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await bankAdviceApi.list({ page, q: query || undefined });
      setRows(result.items);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch {
      setError("Could not load the bank advices.");
    } finally {
      setLoading(false);
    }
  }, [page, query]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const del = useRowDelete<BankAdviceRowDto>({
    kind: "bank-advice",
    subject: "bank advice",
    describe: (row) => (
      <div className="flex flex-col">
        <span className="font-medium">{row.title}</span>
        <span className="text-xs text-muted-foreground">
          {row.lineCount} payments · value date {formatDate(row.valueDate)}
        </span>
      </div>
    ),
    consequences: (
      <p>
        The file and its payments leave this list. Nothing in the books changes,
        and nothing already sent to the bank is undone. Settings → Trashed can
        put it back.
      </p>
    ),
    onDone: () => void load(),
  });

  return (
    <>
      <PageHeader
        title="Bank Advice"
        icon={BankIcon}
        description="The payment file for the bank's S2B upload — built from a salary sheet, checked, downloaded."
        actions={
          canPay ? (
            <>
              <Button
                variant="secondary"
                onClick={() => setStarting(true)}
                data-advice-blank
              >
                <FilePlusIcon weight="duotone" size={18} />
                Blank advice
              </Button>
              <Button
                variant="primary"
                onClick={() => setBuilding(true)}
                data-advice-build
              >
                <PlusCircleIcon weight="duotone" size={19} />
                New from payroll
              </Button>
            </>
          ) : null
        }
      />

      <div className="sv-toolbar flex flex-wrap items-center gap-3">
        <PayrollTabs active="bank-advice" />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Name or month…"
          />
        </div>
      </div>

      {error ? (
        <p className="rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative">
          {error}
        </p>
      ) : null}

      {!loading && rows.length === 0 && !error ? (
        <Card>
          <EmptyState
            icon={BankIcon}
            title={query ? "No bank advice matches" : "No bank advice yet"}
          >
            {query
              ? "Try another name, or clear the search."
              : "Build one from a salary sheet with New from payroll — one payment per person, their bank details from the team record — then download the CSV for S2B."}
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <TableScroll>
            <table className="table-data w-full min-w-[1040px]">
              <thead>
                <tr>
                  <SerialHead />
                  <Th>Name</Th>
                  <Th>Salary sheet</Th>
                  <Th>Paid from</Th>
                  <Th>Value date</Th>
                  <Th align="right">Payments</Th>
                  <Th align="right">Total</Th>
                  <Th>Status</Th>
                  <Th>Made by</Th>
                  <RowActionsHead deletable={canPay} />
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <TableMessageRow colSpan={COLUMNS}>Loading…</TableMessageRow>
                ) : (
                  rows.map((row, index) => (
                    <tr
                      key={row.id}
                      className="row-finance"
                      {...rowOpener(
                        () => router.push(`/payroll/bank-advice/${row.id}`),
                        row.id,
                      )}
                    >
                      <SerialCell n={serial(page, index)} />
                      <td className="max-w-[220px] truncate font-extrabold">
                        {row.title}
                      </td>
                      <td className="text-sm whitespace-nowrap text-muted-foreground">
                        {row.runLabel ?? "Not from payroll"}
                      </td>
                      <td>
                        <div className="flex flex-col">
                          <span className="text-sm">
                            {row.accountName ?? "N/A"}
                          </span>
                          <span className="num text-[11.5px] text-muted-foreground">
                            {row.debitAccountNo || "No account number"}
                          </span>
                        </div>
                      </td>
                      <td className="font-extrabold whitespace-nowrap tabular-nums">
                        {formatDate(row.valueDate)}
                      </td>
                      <td className="text-right tabular-nums">
                        <span className="font-extrabold">{row.lineCount}</span>
                      </td>
                      <td>
                        <div className="flex justify-end">
                          <Amount
                            value={row.totalAmount}
                            tone="neutral"
                            showCounterpart={false}
                            className="font-extrabold whitespace-nowrap tabular-nums"
                          />
                        </div>
                      </td>
                      <td>
                        <AdviceStatus row={row} />
                      </td>
                      <td className="text-sm whitespace-nowrap text-muted-foreground">
                        {row.createdByName ?? "N/A"}
                      </td>
                      <RowActions
                        onEdit={() =>
                          router.push(`/payroll/bank-advice/${row.id}`)
                        }
                        second="delete"
                        onDelete={canPay ? () => del.ask(row) : undefined}
                      />
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </TableScroll>
        </Card>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        total={total}
        noun="advice"
        nounPlural="advices"
        onPage={setPage}
      />

      {building ? (
        <FromPayrollDrawer
          runs={runs}
          accounts={accounts}
          onClose={() => setBuilding(false)}
        />
      ) : null}
      {starting ? (
        <AdviceDetailsDrawer
          advice={null}
          accounts={accounts}
          onClose={() => setStarting(false)}
          onSaved={(saved) => router.push(`/payroll/bank-advice/${saved.id}`)}
        />
      ) : null}
      {del.dialog}
    </>
  );
}

/**
 * Where the file stands: payments still to fill in, ready, or downloaded —
 * the last with the day, because "did this month's go to the bank?" is the
 * question this column is for.
 */
export function AdviceStatus({
  row,
}: {
  row: Pick<
    BankAdviceRowDto,
    "incompleteCount" | "lineCount" | "downloadedAt" | "downloadedByName"
  >;
}) {
  if (row.lineCount === 0) return <Badge tone="neutral">Empty</Badge>;
  if (row.incompleteCount > 0) {
    return <Badge tone="warning">{row.incompleteCount} to fill in</Badge>;
  }
  if (row.downloadedAt) {
    return (
      <span
        className="flex flex-col"
        title={row.downloadedByName ? `By ${row.downloadedByName}` : undefined}
      >
        <Badge tone="positive">Downloaded</Badge>
        <span className="mt-0.5 text-[11.5px] text-muted-foreground">
          {formatDate(row.downloadedAt.slice(0, 10))}
        </span>
      </span>
    );
  }
  return <Badge tone="primary">Ready</Badge>;
}
