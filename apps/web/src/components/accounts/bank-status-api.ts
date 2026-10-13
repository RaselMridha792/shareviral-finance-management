import { apiFetch } from "@/lib/api-client";

/*
 * Accounts ▸ Bank status's two calls, kept beside the screen rather than in
 * `lib/`: nothing else reads them, and `lib/` is shared by every screen.
 */

/** A figure in both currencies. Taka is the ledger's; dollars are the rows'. */
export type BothCurrencies = { bdt: string; usd: string };

export type BankStatusRow = {
  accountId: string;
  name: string;
  bankName: string | null;
  type: string;
  currency: string;
  isActive: boolean;
  opening: BothCurrencies;
  moneyIn: BothCurrencies;
  moneyOut: BothCurrencies;
  fee: BothCurrencies;
  closing: BothCurrencies;
  /** False when some row's dollars were read at the day's rate. */
  usdExact: boolean;
  note: { text: string; updatedAt: string; updatedBy: string | null } | null;
};

export type BankStatus = {
  /** The books month, as its first day. */
  month: string;
  label: string;
  /** A statement covering the whole month is reconciled or audited. */
  reconciled: boolean;
  rows: BankStatusRow[];
  totals: Pick<
    BankStatusRow,
    "opening" | "moneyIn" | "moneyOut" | "fee" | "closing" | "usdExact"
  >;
};

export const bankStatusApi = {
  month: (month: string) =>
    apiFetch<BankStatus>(`/accounts/bank-status?month=${month}`, {
      cache: "no-store",
    }),

  /** Empty clears the note. */
  saveNote: (accountId: string, month: string, note: string) =>
    apiFetch<{ note: { text: string; updatedAt: string } | null }>(
      "/accounts/bank-status/note",
      {
        method: "PUT",
        body: JSON.stringify({ accountId, month, note }),
      },
    ),
};
