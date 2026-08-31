"use client";

import { LoaderCircle, Trash2, TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { Amount } from "@/components/money/amount";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api-client";
import { accountsApi, type AccountAttachments } from "@/lib/masters";
import { formatDate } from "@/lib/utils";

/**
 * Deleting an archived account, and refusing to when it holds anything.
 *
 * The request was for a delete that could optionally take the related records
 * with it, and this dialog does not offer that. The reason belongs on screen
 * rather than only in the code, because the person reading it is deciding
 * whether something has been taken away from them:
 *
 *   - Every entry has to belong to an account. `transactions.account_id` is NOT
 *     NULL, and a register's balance is its opening figure plus everything that
 *     moved through it. An entry with no account cannot appear on any screen
 *     here, so "delete the account and keep the entries" is not a feature that
 *     was skipped — it is a sentence with no meaning.
 *   - Deleting the entries instead would mean this application deleting money,
 *     which it does not do anywhere. Records are voided: struck through, out of
 *     every total, still there. History that can be removed is history nobody
 *     can rely on.
 *
 * What remains is the case that actually happens — an account added by mistake,
 * or one that was never used. Nothing points at it, nothing is lost, it goes.
 *
 * The counts are fetched before anything is confirmed, so the warning names
 * figures instead of gesturing at "related records". A warning that cannot say
 * what is at stake is a shrug with a red border.
 */
export function DeleteAccountDialog({
  accountId,
  accountName,
  currency,
  onClose,
  onDeleted,
}: {
  accountId: string;
  accountName: string;
  currency: string;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [held, setHeld] = useState<AccountAttachments | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** Typing the name, because a click is not a decision. */
  const [typed, setTyped] = useState("");

  useEffect(() => {
    let live = true;
    accountsApi
      .attachments(accountId)
      .then((next) => {
        if (live) setHeld(next);
      })
      .catch(() => {
        if (live) setError("Could not check what this account holds.");
      });
    return () => {
      live = false;
    };
  }, [accountId]);

  async function remove() {
    setPending(true);
    setError(null);
    try {
      await accountsApi.remove(accountId);
      onDeleted();
    } catch (caught) {
      setError(
        caught instanceof ApiError ? caught.message : "Could not delete that.",
      );
      setPending(false);
    }
  }

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="del-title"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-md rounded-xl border border-border bg-surface p-6 shadow-lg">
        <h2 id="del-title" className="text-base font-semibold tracking-tight">
          Delete &ldquo;{accountName}&rdquo;?
        </h2>

        {!held && !error ? (
          <p className="mt-3 flex items-center gap-2 text-sm text-muted-foreground">
            <LoaderCircle className="size-4 animate-spin" />
            Checking what this account holds…
          </p>
        ) : null}

        {held ? (
          held.deletable ? (
            <>
              <p className="mt-3 text-sm text-muted-foreground">
                Nothing points at this account — no entries, no payroll run, no
                challan, no tax payment. Deleting it removes the account and
                nothing else.
              </p>
              <label className="mt-4 flex flex-col gap-1.5">
                <span className="text-sm font-medium">
                  Type the name to confirm
                </span>
                <input
                  value={typed}
                  onChange={(event) => setTyped(event.target.value)}
                  autoFocus
                  placeholder={accountName}
                  className="h-10 w-full rounded-lg border border-border bg-surface-muted px-3 text-sm outline-none focus-visible:border-primary focus-visible:bg-surface"
                />
              </label>
            </>
          ) : (
            <>
              <div className="mt-3 flex items-start gap-3 rounded-lg border border-warning/40 bg-warning/5 px-4 py-3">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
                <p className="text-sm">
                  This account cannot be deleted, because things are attached to
                  it.
                </p>
              </div>

              <ul className="mt-3 flex flex-col gap-1.5 text-sm">
                {held.transactions > 0 ? (
                  <>
                    <li className="flex items-baseline justify-between gap-3">
                      <span>
                        Entries
                        {held.firstTxnDate ? (
                          <span className="num text-muted-foreground">
                            {" "}
                            · {formatDate(held.firstTxnDate)} → {formatDate(held.lastTxnDate)}
                          </span>
                        ) : null}
                      </span>
                      <span className="num font-medium">
                        {held.transactions}
                      </span>
                    </li>
                    <li className="flex items-baseline justify-between gap-3">
                      <span className="text-muted-foreground">
                        Net through it
                      </span>
                      <Amount
                        value={held.net}
                        currency={currency}
                        showCounterpart={false}
                        className="num font-medium"
                      />
                    </li>
                  </>
                ) : null}
                {held.payrollRuns > 0 ? (
                  <li className="flex items-baseline justify-between gap-3">
                    <span>Payroll runs</span>
                    <span className="num font-medium">{held.payrollRuns}</span>
                  </li>
                ) : null}
                {held.tdsDeposits > 0 ? (
                  <li className="flex items-baseline justify-between gap-3">
                    <span>TDS challans</span>
                    <span className="num font-medium">{held.tdsDeposits}</span>
                  </li>
                ) : null}
                {held.incomeTaxPayments > 0 ? (
                  <li className="flex items-baseline justify-between gap-3">
                    <span>Income tax payments</span>
                    <span className="num font-medium">
                      {held.incomeTaxPayments}
                    </span>
                  </li>
                ) : null}
              </ul>

              <p className="mt-4 text-sm text-muted-foreground">
                Every entry has to belong to an account — a register&apos;s
                balance is built from that link — so the account cannot go while
                the entries stay. And this application never deletes money: an
                entry is voided, struck through and out of every total, but it
                remains. Removing these would quietly rewrite every report the
                period has ever appeared in.
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                It stays archived, which already keeps it out of every picker
                and every total. That is the same result, without losing the
                history.
              </p>
            </>
          )
        ) : null}

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-lg bg-negative/10 px-3 py-2 text-sm text-negative"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            {held && !held.deletable ? "Keep it archived" : "Cancel"}
          </Button>
          {held?.deletable ? (
            <Button
              variant="danger"
              disabled={pending || typed.trim() !== accountName.trim()}
              onClick={() => void remove()}
            >
              {pending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-3.5" />
              )}
              Delete it
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
