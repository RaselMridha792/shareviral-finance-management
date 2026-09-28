"use client";

import { formatMoney } from "@finance/shared";
import { FilesIcon } from "@phosphor-icons/react/dist/ssr/Files";
import { PlusCircleIcon } from "@phosphor-icons/react/dist/ssr/PlusCircle";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import {
  STATUSES,
  STATUS_COLOURS,
  type InvoiceStatus,
} from "@/components/invoice-builder/invoice-draft";
import { InvoiceViewer } from "@/components/invoice-builder/invoice-viewer";
import { Amount } from "@/components/money/amount";
import { useSettings } from "@/components/settings-provider";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/patterns";
import { rowOpener } from "@/components/ui/row-details";
import { RowActions, RowActionsHead } from "@/components/ui/row-actions";
import { SearchField } from "@/components/ui/search-field";
import { Segmented } from "@/components/ui/segmented";
import {
  SerialCell,
  SerialHead,
  TableMessageRow,
  TableScroll,
  Th,
} from "@/components/ui/table";
import { useRowDelete } from "@/components/ui/use-row-delete";
import { invoicesApi, type InvoiceRowDto } from "@/lib/invoices";
import { serial } from "@/lib/pagination";
import { formatDate } from "@/lib/utils";

const STATUS_TABS: ReadonlyArray<{ id: InvoiceStatus | "all"; label: string }> =
  [
    { id: "all", label: "All" },
    ...STATUSES.map((status) => ({
      id: status,
      label: status.charAt(0) + status.slice(1).toLowerCase(),
    })),
  ];

/** Columns: SL, eight, and the row's buttons. */
const COLUMNS = 10;

/**
 * All invoices — the ones saved from the Invoice Builder (#118).
 *
 * The owner, 29 Sep 2026: *"All invoice a table format a invoice gula save
 * thakbe. okhan theke view kora jabe, edit kora jabe, delete kora jabe ...
 * table a jekono jaygay click korlei popup a invoice ta view kora jabe"*.
 *
 * A click anywhere on a row opens the invoice as it prints; Edit opens it in
 * the builder; the bin sends it to the trash like every other row in the app,
 * so Settings → Trashed can put it back. Newest first, twenty to a page.
 *
 * The dollar column is at each invoice's own rate — the one typed on it — not
 * today's: an invoice states its dollars once, when it is written.
 */
export function InvoicesScreen() {
  const router = useRouter();
  const settings = useSettings();
  const [tab, setTab] = useState<InvoiceStatus | "all">("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<InvoiceRowDto[]>([]);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showing, setShowing] = useState<InvoiceRowDto | null>(null);

  // Only the pause at the end of typing queries, so a slow early answer
  // cannot land after a fast later one.
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
      const result = await invoicesApi.list({
        page,
        q: query || undefined,
        status: tab === "all" ? undefined : tab,
      });
      setRows(result.items);
      setTotal(result.total);
      setTotalPages(result.totalPages);
    } catch {
      setError("Could not load the invoices.");
    } finally {
      setLoading(false);
    }
  }, [page, query, tab]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const del = useRowDelete<InvoiceRowDto>({
    kind: "invoice",
    subject: "invoice",
    describe: (row) => (
      <div className="flex flex-col">
        <span className="font-medium">{row.invoiceNumber}</span>
        <span className="text-xs text-muted-foreground">
          {row.clientName ?? "No client named"} ·{" "}
          {formatMoney(row.totalAmount, { format: settings.numberFormat })}
          {row.issuedOn ? ` · ${formatDate(row.issuedOn)}` : ""}
        </span>
      </div>
    ),
    consequences: (
      <p>
        It leaves this list. Nothing in the books changes — an invoice is a
        document, not a payment. Settings → Trashed can put it back.
      </p>
    ),
    onDone: () => void load(),
  });

  return (
    <>
      <PageHeader
        title="All invoices"
        icon={FilesIcon}
        description="Every invoice saved from the builder. Click one to see it as it prints."
        actions={
          <Link
            href="/invoices/new"
            className="inline-flex h-11 items-center gap-2 rounded-lg border border-transparent bg-primary px-[18px] text-[14px] font-extrabold text-primary-foreground shadow-[0_6px_16px_rgb(150_200_0/0.28)] transition-[background-color,transform] duration-200 hover:-translate-y-px hover:bg-(--sv-accent-hover)"
            data-invoices-add
          >
            <PlusCircleIcon weight="duotone" size={19} />
            Add New
          </Link>
        }
      />

      <div className="sv-toolbar flex flex-wrap items-center gap-3">
        <Segmented
          options={STATUS_TABS}
          value={tab}
          onChange={(next) => {
            setTab(next);
            setPage(1);
          }}
          label="Invoice status"
        />
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <SearchField
            value={search}
            onChange={setSearch}
            placeholder="Number, client, project…"
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
            icon={FilesIcon}
            title={
              query || tab !== "all"
                ? "No invoice matches"
                : "No invoices saved yet"
            }
            action={
              query || tab !== "all" ? null : (
                <Link
                  href="/invoices/new"
                  className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary px-[18px] text-[14px] font-extrabold text-primary-foreground"
                >
                  <PlusCircleIcon weight="duotone" size={19} />
                  Add New
                </Link>
              )
            }
          >
            {query || tab !== "all"
              ? "Try another status, or clear the search."
              : "Build one on Add New and press Save invoice — it lands here."}
          </EmptyState>
        </Card>
      ) : (
        <Card className="overflow-hidden p-0">
          <TableScroll>
            <table className="table-data w-full min-w-[1100px]">
              <thead>
                <tr>
                  <SerialHead />
                  <Th>Invoice No.</Th>
                  <Th>Invoice To</Th>
                  <Th>Project</Th>
                  <Th>Invoice Date</Th>
                  <Th>Due Date</Th>
                  <Th>Status</Th>
                  <Th align="right">Amount</Th>
                  <Th>Saved by</Th>
                  <RowActionsHead deletable />
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
                      {...rowOpener(() => setShowing(row), row.id)}
                    >
                      <SerialCell n={serial(page, index)} />
                      <td className="font-extrabold whitespace-nowrap">
                        {row.invoiceNumber}
                      </td>
                      <td className="max-w-[260px] truncate">
                        {row.clientName ?? (
                          <span className="text-muted-foreground">N/A</span>
                        )}
                      </td>
                      <td className="max-w-[260px] truncate text-sm text-muted-foreground">
                        {row.projectTitle ?? "N/A"}
                      </td>
                      <td className="font-extrabold whitespace-nowrap tabular-nums">
                        {formatDate(row.issuedOn)}
                      </td>
                      <td className="whitespace-nowrap tabular-nums text-muted-foreground">
                        {formatDate(row.dueOn)}
                      </td>
                      <td>
                        <StatusPill status={row.status} />
                      </td>
                      <td>
                        <div className="flex flex-col items-end">
                          <Amount
                            value={row.totalAmount}
                            tone="neutral"
                            showCounterpart={false}
                            className="font-extrabold whitespace-nowrap tabular-nums"
                          />
                          {Number(row.usdRate) > 0 ? (
                            <span
                              className="num text-[11.5px] leading-tight text-muted-foreground"
                              title={`At the invoice's own rate, ${row.usdRate} per dollar`}
                            >
                              ≈{" "}
                              {formatMoney(
                                (
                                  Number(row.totalAmount) / Number(row.usdRate)
                                ).toFixed(2),
                                { currency: "USD" },
                              )}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td className="text-sm whitespace-nowrap text-muted-foreground">
                        {row.createdByName ?? "N/A"}
                      </td>
                      <RowActions
                        onEdit={() => router.push(`/invoices/${row.id}/edit`)}
                        second="delete"
                        onDelete={() => del.ask(row)}
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
        noun="invoice"
        onPage={setPage}
      />

      {showing ? (
        <InvoiceViewer
          row={showing}
          onClose={() => setShowing(null)}
          onDelete={(row) => {
            setShowing(null);
            del.ask(row);
          }}
        />
      ) : null}

      {del.dialog}
    </>
  );
}

/** The status in its badge colour — the same one the sheet prints. */
function StatusPill({ status }: { status: InvoiceStatus }) {
  const colour = STATUS_COLOURS[status] ?? STATUS_COLOURS.DRAFT;
  return (
    <span
      className="inline-flex items-center rounded-full px-2.5 py-[3px] text-[12px] leading-[1.35] font-extrabold whitespace-nowrap"
      style={{
        color: colour,
        background: `color-mix(in srgb, ${colour} 14%, transparent)`,
      }}
      data-invoice-status={status}
    >
      {status.charAt(0) + status.slice(1).toLowerCase()}
    </span>
  );
}
