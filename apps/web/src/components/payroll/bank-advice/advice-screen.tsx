"use client";

import { formatMoney } from "@finance/shared";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/ssr/ArrowLeft";
import { BankIcon } from "@phosphor-icons/react/dist/ssr/Bank";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/ssr/CheckCircle";
import { DownloadSimpleIcon } from "@phosphor-icons/react/dist/ssr/DownloadSimple";
import { FileXlsIcon } from "@phosphor-icons/react/dist/ssr/FileXls";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/ssr/PencilSimple";
import { PlusIcon } from "@phosphor-icons/react/dist/ssr/Plus";
import { WarningIcon } from "@phosphor-icons/react/dist/ssr/Warning";
import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useState, type ReactNode } from "react";

import { useCan } from "@/components/auth/session-provider";
import {
  AdviceDetailsDrawer,
  LineDrawer,
} from "@/components/payroll/bank-advice/advice-drawers";
import { AdviceStatus } from "@/components/payroll/bank-advice/advice-list-screen";
import { useSettings } from "@/components/settings-provider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { DeleteDialog } from "@/components/ui/delete-dialog";
import { PageHeader } from "@/components/ui/page-header";
import { RowDetails, rowOpener } from "@/components/ui/row-details";
import { RowActions, RowActionsHead } from "@/components/ui/row-actions";
import {
  SerialCell,
  SerialHead,
  TableMessageRow,
  TableScroll,
  Th,
} from "@/components/ui/table";
import { ApiError } from "@/lib/api-client";
import {
  PAYMENT_TYPE_LABELS,
  SCB_CODE,
  bankAdviceApi,
  type BankAdviceDto,
  type BankAdviceLineDto,
} from "@/lib/bank-advice";
import type { AccountDto } from "@/lib/masters";
import { formatDate } from "@/lib/utils";

const COLUMNS = 9;

/**
 * One bank advice: its payments as a table, what still has to be filled in,
 * and the two downloads — the CSV the bank's S2B takes, and the bank's own
 * workbook to read and keep.
 *
 * Nothing downloads while a payment is incomplete: the bank rejects the whole
 * upload for one bad row, and a file refused at the bank is a salary paid
 * late. Each row says what is missing; a click on it opens the payment.
 */
export function AdviceScreen({
  initial,
  accounts,
}: {
  initial: BankAdviceDto;
  accounts: AccountDto[];
}) {
  const settings = useSettings();
  const canPay = useCan("payroll.pay");
  const [advice, setAdvice] = useState(initial);
  const [editingDetails, setEditingDetails] = useState(false);
  const [editing, setEditing] = useState<BankAdviceLineDto | "new" | null>(
    null,
  );
  const [viewing, setViewing] = useState<BankAdviceLineDto | null>(null);
  const [removing, setRemoving] = useState<BankAdviceLineDto | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [removePending, setRemovePending] = useState(false);
  const [downloading, setDownloading] = useState<"csv" | "xlsx" | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const money = (value: string) =>
    formatMoney(value, { format: settings.numberFormat });
  const broken = advice.lines.filter((line) => line.problems.length > 0);
  const ready = advice.problems.length === 0 && broken.length === 0;

  /**
   * Fetched and handed to the browser as a file, rather than navigated to:
   * a refusal then arrives as a sentence on this page instead of a page of
   * JSON, and the advice is read again after, for its Downloaded stamp.
   */
  async function download(kind: "csv" | "xlsx") {
    setDownloading(kind);
    setDownloadError(null);
    try {
      const response = await fetch(bankAdviceApi.fileUrl(advice.id, kind), {
        credentials: "include",
        headers: { "X-Requested-With": "finance-web" },
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as {
          message?: string;
        } | null;
        throw new Error(body?.message ?? "The file could not be made.");
      }
      const blob = await response.blob();
      const header = response.headers.get("Content-Disposition") ?? "";
      const named = /filename\*=UTF-8''([^;]+)/.exec(header)?.[1];
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = named ? decodeURIComponent(named) : `Bank advice.${kind}`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(link.href), 10_000);
      setAdvice(await bankAdviceApi.get(advice.id));
    } catch (caught) {
      setDownloadError(
        caught instanceof Error
          ? caught.message
          : "The file could not be made.",
      );
    } finally {
      setDownloading(null);
    }
  }

  function removeLine(reason: string) {
    void reason;
    if (!removing) return;
    setRemovePending(true);
    setRemoveError(null);
    bankAdviceApi
      .removeLine(advice.id, removing.id)
      .then((saved) => {
        setAdvice(saved);
        setRemoving(null);
      })
      .catch((caught: unknown) =>
        setRemoveError(
          caught instanceof ApiError ? caught.message : "That did not work.",
        ),
      )
      .finally(() => setRemovePending(false));
  }

  const account = accounts.find((one) => one.id === advice.accountId) ?? null;

  return (
    <>
      <PageHeader
        title={advice.title}
        eyebrow="Bank Advice"
        icon={BankIcon}
        description={
          advice.runLabel
            ? `Built from the ${advice.runLabel} salary sheet.`
            : "Not from a salary sheet."
        }
        actions={
          <>
            <Link
              href="/payroll/bank-advice"
              className="sv-button-quiet inline-flex h-11 items-center gap-2 rounded-lg bg-surface px-4 text-[14px] font-extrabold transition-colors"
            >
              <ArrowLeftIcon weight="bold" size={15} />
              All advices
            </Link>
            {canPay ? (
              <>
                <Button
                  variant="secondary"
                  onClick={() => void download("xlsx")}
                  disabled={!ready || downloading !== null}
                  title={ready ? undefined : "Fill in what is missing first"}
                  data-advice-xlsx
                >
                  {downloading === "xlsx" ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <FileXlsIcon weight="duotone" size={17} />
                  )}
                  Bank&apos;s Excel
                </Button>
                <Button
                  variant="primary"
                  onClick={() => void download("csv")}
                  disabled={!ready || downloading !== null}
                  title={ready ? undefined : "Fill in what is missing first"}
                  data-advice-csv
                >
                  {downloading === "csv" ? (
                    <LoaderCircle className="size-4 animate-spin" />
                  ) : (
                    <DownloadSimpleIcon weight="bold" size={16} />
                  )}
                  S2B upload file (CSV)
                </Button>
              </>
            ) : null}
          </>
        }
      />

      {/* The file at a glance. */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Fact label="Payments" value={String(advice.lineCount)} />
        <Fact label="Total" value={money(advice.totalAmount)} strong />
        <Fact
          label="Paid from"
          value={account?.name ?? advice.accountName ?? "N/A"}
          sub={advice.debitAccountNo || "No account number"}
        />
        <Fact
          label="Value date"
          value={formatDate(advice.valueDate)}
          sub={
            <span className="inline-flex items-center gap-2">
              <AdviceStatus row={advice} />
            </span>
          }
        />
      </div>

      {ready ? (
        <p
          className="flex items-center gap-2 rounded-[11px] bg-(--sv-pos-tint) px-4 py-3 text-[13.5px] text-(--sv-pos)"
          data-advice-ready
        >
          <CheckCircleIcon weight="fill" size={18} />
          <span>
            <span className="font-extrabold">Ready for the bank.</span>{" "}
            {advice.downloadedAt
              ? `Downloaded ${formatDate(advice.downloadedAt.slice(0, 10))} at ${advice.downloadedAt.slice(11, 16)}${advice.downloadedByName ? ` by ${advice.downloadedByName}` : ""}.`
              : "Download the S2B upload file and upload it on S2B."}
          </span>
        </p>
      ) : (
        <div
          className="flex flex-col gap-1.5 rounded-[11px] bg-(--sv-warn-tint) px-4 py-3 text-[13.5px] text-(--sv-warn)"
          data-advice-not-ready
        >
          <p className="flex items-center gap-2 font-extrabold">
            <WarningIcon weight="fill" size={18} />
            Not ready for the bank yet
          </p>
          <ul className="flex flex-col gap-0.5 pl-7">
            {advice.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
            {broken.length > 0 ? (
              <li>
                {broken.length === 1
                  ? "One payment needs"
                  : `${broken.length} payments need`}{" "}
                filling in — marked below.
              </li>
            ) : null}
          </ul>
        </div>
      )}

      {/*
        Which file is which, said once where both are downloaded. The owner,
        29 Sep 2026: "kono kichu missing thakle r format thik na thakle bank
        accept korbena" — and the one way a correct file goes wrong is being
        opened in Excel and saved again on the way to the bank.
      */}
      {canPay ? (
        <div
          className="grid gap-3 rounded-[11px] bg-(--sv-subtle) px-4 py-3.5 text-[13px] sm:grid-cols-2"
          data-advice-files
        >
          <p>
            <span className="font-extrabold">S2B upload file (CSV)</span> — the
            file the bank&apos;s instructions end with: the Bank Standard
            Format, row 1 deleted, saved as CSV (Comma delimited). Upload it to
            S2B as it is.{" "}
            <span className="text-(--sv-warn)">
              Do not open it in Google Sheets or Excel — both read the account
              and routing numbers as figures and drop their leading zeros
              (0001702374701 shows as 1702374701), and saved again the bank
              refuses it.
            </span>
          </p>
          <p>
            <span className="font-extrabold">Bank&apos;s Excel</span> — the
            bank&apos;s own &ldquo;Bank Standard Format&rdquo; sheet with these
            payments filled in, every other cell as the bank made it. Open this
            one to check the file: its account numbers, routing numbers and date
            are text cells, so the zeros show. Following the bank&apos;s steps
            with it (delete row 1, Save As → CSV (Comma delimited)) gives the
            same file as the CSV.
          </p>
        </div>
      ) : null}

      {downloadError ? (
        <p
          role="alert"
          className="rounded-lg bg-(--sv-neg-tint) px-3 py-2 text-sm text-(--sv-neg)"
          data-advice-download-error
        >
          {downloadError}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-[17px] font-extrabold tracking-[-0.01em]">
          Payments
        </h2>
        {canPay ? (
          <div className="flex flex-wrap gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setEditingDetails(true)}
              data-advice-edit
            >
              <PencilSimpleIcon weight="duotone" size={15} />
              Edit details
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={() => setEditing("new")}
              data-advice-add-line
            >
              <PlusIcon weight="bold" size={14} />
              Add payment
            </Button>
          </div>
        ) : null}
      </div>

      <Card className="overflow-hidden p-0">
        <TableScroll>
          <table className="table-data w-full min-w-[1120px]">
            <thead>
              <tr>
                <SerialHead />
                <Th>Type</Th>
                <Th>Beneficiary</Th>
                <Th>Bank</Th>
                <Th>Account No.</Th>
                <Th>Payment details</Th>
                <Th align="right">Amount</Th>
                <Th>Check</Th>
                <RowActionsHead deletable={canPay} />
              </tr>
            </thead>
            <tbody>
              {advice.lines.length === 0 ? (
                <TableMessageRow colSpan={COLUMNS}>
                  No payments yet
                  {canPay ? " — Add payment puts the first one in." : "."}
                </TableMessageRow>
              ) : (
                advice.lines.map((line, index) => (
                  <tr
                    key={line.id}
                    className="row-finance"
                    data-line-ok={line.problems.length === 0 ? "" : undefined}
                    {...rowOpener(
                      () => (canPay ? setEditing(line) : setViewing(line)),
                      line.id,
                    )}
                  >
                    <SerialCell n={index + 1} />
                    <td>
                      <Badge tone="primary">{line.paymentType}</Badge>
                    </td>
                    <td>
                      <div className="flex flex-col">
                        <span className="font-extrabold">
                          {line.beneficiaryName}
                        </span>
                        {line.email ? (
                          <span className="text-[11.5px] text-muted-foreground">
                            {line.email}
                          </span>
                        ) : null}
                      </div>
                    </td>
                    <td>
                      <BankCell code={line.bankCode} />
                    </td>
                    <td className="num whitespace-nowrap">
                      {line.accountNo || (
                        <span className="text-(--sv-neg)">Missing</span>
                      )}
                    </td>
                    <td className="max-w-[240px] truncate text-sm text-muted-foreground">
                      {line.paymentDetails || "N/A"}
                    </td>
                    <td className="text-right font-extrabold whitespace-nowrap tabular-nums">
                      {money(line.amount)}
                    </td>
                    <td>
                      {line.problems.length === 0 ? (
                        <Badge tone="positive">Ready</Badge>
                      ) : (
                        <span title={line.problems.join("\n")}>
                          <Badge tone="warning">
                            {line.problems.length === 1
                              ? line.problems[0]
                              : `${line.problems.length} to fix`}
                          </Badge>
                        </span>
                      )}
                    </td>
                    <RowActions
                      onEdit={canPay ? () => setEditing(line) : undefined}
                      second="delete"
                      onSecond={
                        canPay
                          ? () => {
                              setRemoveError(null);
                              setRemoving(line);
                            }
                          : undefined
                      }
                    />
                  </tr>
                ))
              )}
            </tbody>
            {advice.lines.length > 0 ? (
              <tfoot>
                <tr>
                  <td colSpan={6} className="text-right font-extrabold">
                    Total · {advice.lineCount} payments
                  </td>
                  <td className="text-right font-extrabold whitespace-nowrap tabular-nums">
                    {money(advice.totalAmount)}
                  </td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            ) : null}
          </table>
        </TableScroll>
      </Card>

      {advice.note ? (
        <p className="text-[13px] text-(--sv-muted)">Note: {advice.note}</p>
      ) : null}

      {editingDetails ? (
        <AdviceDetailsDrawer
          advice={advice}
          accounts={accounts}
          onClose={() => setEditingDetails(false)}
          onSaved={(saved) => {
            setAdvice(saved);
            setEditingDetails(false);
          }}
        />
      ) : null}

      {editing ? (
        <LineDrawer
          key={editing === "new" ? "new" : editing.id}
          adviceId={advice.id}
          line={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setAdvice(saved);
            setEditing(null);
          }}
        />
      ) : null}

      <RowDetails
        open={Boolean(viewing)}
        onClose={() => setViewing(null)}
        title={viewing ? `Payment to ${viewing.beneficiaryName}` : ""}
        sections={
          viewing
            ? [
                {
                  items: [
                    {
                      label: "Type",
                      value: PAYMENT_TYPE_LABELS[viewing.paymentType],
                    },
                    { label: "Beneficiary", value: viewing.beneficiaryName },
                    { label: "Bank code", value: viewing.bankCode },
                    { label: "Account No.", value: viewing.accountNo },
                    { label: "Amount", value: money(viewing.amount) },
                    { label: "Email", value: viewing.email },
                    {
                      label: "Payment details",
                      value: viewing.paymentDetails,
                      block: true,
                    },
                  ],
                },
              ]
            : []
        }
      />

      <DeleteDialog
        open={Boolean(removing)}
        mode="delete"
        subject="payment"
        askForReason={false}
        title="Take this payment off the advice?"
        intro="It comes off this file only. The salary sheet and the person's record do not change."
        summary={
          removing ? (
            <div className="flex flex-col">
              <span className="font-medium">{removing.beneficiaryName}</span>
              <span className="text-xs text-muted-foreground">
                {money(removing.amount)} · {removing.accountNo || "no account"}
              </span>
            </div>
          ) : null
        }
        consequences="Add payment puts it back by hand if it was a mistake."
        pending={removePending}
        error={removeError}
        onCancel={() => setRemoving(null)}
        onConfirm={removeLine}
      />
    </>
  );
}

function Fact({
  label,
  value,
  sub,
  strong = false,
}: {
  label: string;
  value: string;
  sub?: ReactNode;
  strong?: boolean;
}) {
  return (
    <Card className="flex flex-col gap-1 px-5 py-4">
      <span className="text-[11px] font-extrabold tracking-[0.12em] text-(--sv-muted) uppercase">
        {label}
      </span>
      <span
        className={
          strong
            ? "num text-[22px] font-extrabold tracking-[-0.02em]"
            : "text-[17px] font-extrabold"
        }
      >
        {value}
      </span>
      {sub ? (
        <span className="num text-[12.5px] text-(--sv-muted)">{sub}</span>
      ) : null}
    </Card>
  );
}

/** SCB, or another bank by its routing number — as the file writes it. */
function BankCell({ code }: { code: string }) {
  if (!code) return <span className="text-(--sv-neg)">Missing</span>;
  if (code === SCB_CODE) {
    return (
      <span className="flex flex-col">
        <span className="font-extrabold">Standard Chartered</span>
        <span className="num text-[11.5px] text-muted-foreground">{code}</span>
      </span>
    );
  }
  return (
    <span className="flex flex-col">
      <span className="text-sm">Another bank</span>
      <span className="num text-[11.5px] text-muted-foreground">{code}</span>
    </span>
  );
}
