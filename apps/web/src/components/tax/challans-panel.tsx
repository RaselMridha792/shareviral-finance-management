"use client";

import { formatMoney } from "@finance/shared";
import { LoaderCircle, Paperclip, Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { useCan } from "@/components/auth/session-provider";
import { DocumentViewer } from "@/components/ui/overlay";
import { DataPanel } from "@/components/ui/patterns";
import { RowActions, RowActionsHead } from "@/components/ui/row-actions";
import {
  SerialCell,
  SerialHead,
  TableMessageRow,
  TableScroll,
  Th,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { ApiError, fileHref, type StoredFile } from "@/lib/api-client";
import { listChallanFiles, tdsApi, type TdsDepositDto } from "@/lib/tax";

import { ChallanForm } from "./challan-form";

/**
 * The challans, under the deductions they pay for.
 *
 * A second table rather than a column on the first, and that is the shape of
 * the thing rather than a layout preference: one A-Challan usually settles the
 * tax withheld from many people at once, so a challan number on a person's row
 * would be the same number written down seventeen times, and the amount beside
 * it would belong to none of them.
 *
 * `tds_deposits` and `tds_deposit_allocations` have existed since the first
 * build and no screen has ever read them. This is that screen.
 */
export function ChallansPanel({ year }: { year: number }) {
  const canWrite = useCan("tds.write");
  const toast = useToast();

  const [rows, setRows] = useState<TdsDepositDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<TdsDepositDto | null>(null);
  const [creating, setCreating] = useState(false);

  /** Which challan's scan is open, and the file itself once it has loaded. */
  const [viewing, setViewing] = useState<StoredFile | null>(null);
  /** Deposit id → whether a scan is attached. Drawn as the paperclip. */
  const [scans, setScans] = useState<Record<string, StoredFile | undefined>>(
    {},
  );

  const load = useCallback(async () => {
    try {
      setError(null);
      const result = await tdsApi.deposits(year);
      setRows(result.items);

      // One request per challan, which is fine at this volume — a company
      // files twelve a year — and is what lets the number itself be the link
      // to the scan rather than a second click to find out there isn't one.
      const found = await Promise.all(
        result.items.map(async (row) => {
          const files = await listChallanFiles(row.id).catch(() => []);
          return [row.id, files[0]] as const;
        }),
      );
      setScans(Object.fromEntries(found));
    } catch (caught) {
      /*
       * Not an empty list. A request that did not answer says nothing about
       * how many challans exist, and rendering "nothing deposited yet" because
       * of a network failure is a confident, specific, wrong statement about
       * the company's tax.
       */
      setRows(null);
      setError(
        caught instanceof ApiError
          ? caught.message
          : "Could not load the challans.",
      );
    }
  }, [year]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const COLUMNS = 8;

  return (
    <>
      <DataPanel
        title={`Challans · ${year}`}
        icon="receipt_long"
        iconTone="text-positive"
        description="What was actually deposited against the tax withheld above. One challan usually covers many people."
        actions={
          canWrite ? (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setCreating(true)}
            >
              <Plus className="size-3.5" />
              Record a challan
            </Button>
          ) : null
        }
      >
        <TableScroll>
          <table className="table-data min-w-[900px]">
            <thead>
              <tr>
                <SerialHead />
                <Th width="w-28">Deposit date</Th>
                <Th>Challan number</Th>
                <Th width="w-28">Challan date</Th>
                <Th width="w-32" align="right">
                  Amount
                </Th>
                <Th width="w-36">Bank</Th>
                <Th width="w-32">For</Th>
                <RowActionsHead />
              </tr>
            </thead>
            <tbody>
              {error ? (
                <TableMessageRow colSpan={COLUMNS} tone="error">
                  {error}
                </TableMessageRow>
              ) : rows === null ? (
                <TableMessageRow colSpan={COLUMNS}>
                  <LoaderCircle className="mx-auto size-4 animate-spin" />
                </TableMessageRow>
              ) : rows.length === 0 ? (
                <TableMessageRow colSpan={COLUMNS}>
                  Nothing deposited in {year} yet. Record a challan once the
                  bank has taken the money, and attach what it gave you.
                </TableMessageRow>
              ) : (
                rows.map((row, index) => {
                  const scan = scans[row.id];
                  return (
                    <tr key={row.id} className="row-finance">
                      <SerialCell n={index + 1} />
                      <td className="num whitespace-nowrap">
                        {row.depositDate}
                      </td>
                      <td>
                        {/*
                          The number is the link to the scan, which is the
                          owner's ask: the thing somebody wants when they read
                          a challan number is the paper behind it.
                        */}
                        {scan ? (
                          <button
                            type="button"
                            onClick={() => setViewing(scan)}
                            className="num inline-flex cursor-pointer items-center gap-1.5 rounded-sm text-primary-text underline-offset-2 hover:underline"
                          >
                            <Paperclip className="size-3.5" />
                            {row.challanNumber}
                          </button>
                        ) : (
                          <span
                            className="num text-muted-foreground"
                            title="No scan attached yet — the edit button adds one."
                          >
                            {row.challanNumber}
                          </span>
                        )}
                      </td>
                      <td className="num whitespace-nowrap">
                        {row.challanDate}
                      </td>
                      <td className="col-amount text-right">
                        {formatMoney(row.amount, { currency: "BDT" })}
                      </td>
                      <td className="text-muted-foreground">
                        {row.bankName ?? "—"}
                      </td>
                      <td className="text-muted-foreground">
                        {row.periodLabel}
                      </td>
                      <RowActions
                        second="delete"
                        onEdit={canWrite ? () => setEditing(row) : undefined}
                        // No second action: a challan is the bank's receipt for
                        // money that has left the company, and deleting the
                        // record of it does not get the money back. A wrong one
                        // is corrected, not removed.
                        onSecond={undefined}
                      />
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </TableScroll>
      </DataPanel>

      <ChallanForm
        key={editing?.id ?? "new"}
        open={creating || Boolean(editing)}
        deposit={editing ?? undefined}
        year={year}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSaved={async (message) => {
          toast.show(message, "success");
          await load();
        }}
      />

      {/* `?inline=1` is what makes a PDF render in the panel instead of
          downloading — the same thing the documents popup does. */}
      <DocumentViewer
        open={Boolean(viewing)}
        src={viewing ? `${fileHref(viewing.id)}?inline=1` : null}
        name={viewing?.originalName ?? ""}
        downloadHref={viewing ? fileHref(viewing.id) : ""}
        onClose={() => setViewing(null)}
      />
    </>
  );
}
