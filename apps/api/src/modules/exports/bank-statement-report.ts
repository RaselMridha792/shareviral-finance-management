import { formatMoney, type NumberFormat } from "@finance/shared";

import type {
  PdfPage,
  PdfPagedBlock,
  PdfPagedSpec,
  PdfStackCell,
  PdfWaterfallStep,
} from "./pdf.service";

/**
 * One account's statement, as a document rather than a grid.
 *
 * The owner asked for *"bank statement. Sundor Ekta Graphical PDF version a"*
 * — the register already comes out as a spreadsheet, and a spreadsheet is what
 * you reconcile with, not what you hand to somebody. So this is the same
 * figures shaped as paper: a cover that states the position, a page that shows
 * how the balance got from one end of the period to the other, and only then
 * the line-by-line.
 *
 * It recomputes nothing. Everything on these pages comes off the one
 * `register()` result the Excel export uses, so the two files cannot disagree
 * — and if the closing figure on the cover were ever wrong, it would be wrong
 * on the screen too, which is where it would get found.
 */

export type RegisterAccount = {
  name: string;
  type: string;
  bankName: string | null;
  accountNumber: string | null;
  currency: string;
};

export type RegisterRow = {
  txnDate: string;
  description: string | null;
  refNo: string | null;
  invoiceNo?: string | null;
  categoryName: string | null;
  vendorName: string | null;
  counterparty: string | null;
  direction: "in" | "out";
  amount: string;
  runningBalance: string;
  voidedAt: string | Date | null;
};

export type RegisterResult = {
  account: RegisterAccount;
  openingBalance: string;
  totalIn: string;
  totalOut: string;
  closingBalance: string;
  rows: RegisterRow[];
};

export type BankStatementOptions = {
  companyName: string;
  numberFormat: NumberFormat;
  /** The window asked for, as typed. Either end may be open. */
  from?: string;
  to?: string;
  generatedOn: string;
  accountTypeLabel: string;
};

/** How many outflow headings get their own arc before the rest become "Other". */
const DONUT_SLICES = 5;

export function buildBankStatementReport(
  register: RegisterResult,
  options: BankStatementOptions,
): PdfPagedSpec {
  const fmt = options.numberFormat;
  const { account, rows } = register;

  const money = (value: string) => formatMoney(value, { format: fmt });
  const short = (value: string) =>
    formatMoney(value, { format: fmt, hideDecimals: true });

  /* Voided rows are printed struck out of the arithmetic, never counted — the
     same rule the register itself follows, restated here so the document
     cannot drift from the screen. */
  const live = rows.filter((row) => !row.voidedAt);
  const period = describePeriod(options.from, options.to, rows);
  const accountLine = [
    account.bankName,
    maskAccount(account.accountNumber),
    options.accountTypeLabel,
  ]
    .filter(Boolean)
    .join(" · ");

  const net = Number(register.totalIn) - Number(register.totalOut);

  /* ---------------------------------------------------------------- cover */

  const cover: PdfPage = {
    theme: "dark",
    eyebrowLeft: "</>",
    eyebrowRight: `${account.name} · Bank statement`,
    footer: {
      left: [options.companyName, accountLine].filter(Boolean).join(" · "),
      right: `${period.label} · Confidential`,
      pageNumber: false,
      rule: false,
    },
    blocks: [
      { kind: "gap", height: 78 },
      {
        /*
         * 40pt, not 58. The owner: *"ekhane font gula onek boro boro
         * dekhacche etar ui ke sundor koro."* A statement is a document
         * somebody reads, not a poster — the words "Bank Statement" filling a
         * third of the sheet is scale standing in for hierarchy. Smaller type
         * with more air around it reads as more considered, not less.
         */
        kind: "display",
        eyebrow: `${account.name} · ${period.label}`,
        lines: ["Bank", "Statement."],
        size: 40,
      },
      { kind: "gap", height: 10 },
      {
        kind: "lede",
        size: 10.5,
        width: 330,
        text:
          `Every movement through ${account.name} for ${period.lower}, in date order, ` +
          `carried from the balance the account opened the period with to the balance ` +
          `it closed on. Figures are stated in taka. ` +
          `${describeVoided(rows.length - live.length)}`,
      },
      { kind: "gap", height: 26 },
      {
        kind: "figureBoxes",
        size: 21,
        height: 92,
        items: [
          {
            label: "Opening balance",
            primary: short(register.openingBalance),
            secondary: period.openedOn,
            source: accountLine || account.name,
          },
          {
            label: "Closing balance",
            primary: short(register.closingBalance),
            secondary: period.closedOn,
            source: `${live.length} ${live.length === 1 ? "entry" : "entries"} · ${options.companyName}`,
          },
        ],
      },
      // Fixed to the foot of the sheet rather than to the flow above it, so a
      // long account name cannot push the figures off the page.
      { kind: "anchor", fromBottom: 186 },
      {
        kind: "bigFigures",
        size: 23,
        height: 84,
        items: [
          { value: short(register.totalIn), label: "Money in" },
          { value: short(register.totalOut), label: "Money out" },
          {
            value: `${net >= 0 ? "+" : "−"}${short(Math.abs(net).toFixed(2))}`,
            label: "Net for the period",
            align: "right",
          },
        ],
      },
      { kind: "gap", height: 12 },
      {
        kind: "capsRow",
        left: [accountLine, account.currency].filter(Boolean).join("  ×  "),
      },
      { kind: "gap", height: 2 },
      { kind: "rule" },
    ],
  };

  /* ------------------------------------------------------------ the shape */

  const outflow = shareOfOutflow(live, fmt);

  const movement: PdfPage = {
    ...sheet("How it moved", `${account.name} · Movement`),
    blocks: [
      { kind: "gap", height: 8 },
      { kind: "display", lines: ["The movement."], size: 25 },
      { kind: "gap", height: 6 },
      {
        kind: "lede",
        size: 10,
        text:
          `Where the balance started, what came in, what went out, and where it ` +
          `finished — the whole of ${period.lower} in one shape, after the ` +
          `line-by-line that precedes it.`,
      },
      { kind: "gap", height: 14 },
      {
        kind: "waterfall",
        title: "Balance through the period",
        subtitle: `${account.name} · ${period.label}`,
        steps: waterfall(register, money, short),
      },
      ...(outflow.length > 1
        ? ([
            { kind: "gap", height: 18 },
            {
              kind: "donut",
              title: "Where the money went",
              subtitle: `${short(register.totalOut)} out over ${period.lower}`,
              centreLabel: "Total out",
              centreValue: short(register.totalOut),
              slices: outflow,
            },
          ] as PdfPagedBlock[])
        : []),
      { kind: "gap", height: 18 },
      {
        kind: "notes",
        items: [
          `Opening balance is what the account held the day before ${period.openedOn}. ` +
            `It is not a movement and has no line of its own in the ledger; every ` +
            `balance in that column is built on it.`,
          `Voided entries are listed for the record and excluded from every total, ` +
            `including the running balance — a voided row leaves the balance exactly ` +
            `where the row above it left it.`,
          `Prepared from the same query as the on-screen register and its spreadsheet ` +
            `export, so all three carry identical figures. Generated ${options.generatedOn}.`,
        ],
      },
    ],
  };

  /* ----------------------------------------------------------- the ledger */

  /*
   * FOUR columns, and Description is not one of them.
   *
   * The owner: *"ekhane line by line table ta theke description bad daw. ekhane
   * date, debit credit, and ballance field gulake rakho kono kichu jeno kata na
   * pore."* Description was taking 37% of the sheet and every other column was
   * being cut to pay for it — the date read "09/06/20..", the figures
   * "৳8,54,000.0..". Dropping it gives that 37% back to the four columns that
   * carry money, and nothing is cut any more.
   *
   * The transaction number stays, as a small line under the date. It is not a
   * description — it is the handle you match a row to the bank's own statement
   * by, and a statement whose rows cannot be identified is not one you can
   * reconcile. It costs no width, because it sits in the space the date's own
   * row already occupies.
   *
   * DEBIT then CREDIT, in that order, because that is what the screen this
   * document mirrors says — `bank-statement-screen.tsx` puts `direction ===
   * "out"` under Debit and `"in"` under Credit. It used to read "In" then
   * "Out", which is the same two figures in the other order under other names:
   * two documents of the same account that a reader has to check the headings
   * of before trusting either.
   */
  const ledger: PdfPage = {
    ...sheet("Line by line", `${account.name} · Ledger`),
    blocks: [
      { kind: "gap", height: 8 },
      { kind: "display", lines: ["Line by line."], size: 25 },
      { kind: "gap", height: 6 },
      {
        kind: "lede",
        size: 10,
        text:
          `${rows.length} ${rows.length === 1 ? "entry" : "entries"} for ${period.lower}, ` +
          `oldest first, with the balance after each. Debit is money out, credit is ` +
          `money in — the reading the account's own statement uses. How the balance ` +
          `moved across the period is set out overleaf.`,
      },
      { kind: "gap", height: 12 },
      {
        kind: "sectionHead",
        ordinal: "01",
        title: account.name,
        right: accountLine,
      },
      {
        kind: "stackTable",
        scale: 0.86,
        columns: [
          { header: "Date", width: 0.22 },
          { header: "Debit", width: 0.24, align: "right" },
          { header: "Credit", width: 0.24, align: "right" },
          { header: "Balance", width: 0.3, align: "right" },
        ],
        rows: rows.map((row) => ledgerRow(row, money)),
        total: [
          { kind: "caps", text: "Closing" },
          { kind: "money", primary: money(register.totalOut), tone: "out" },
          { kind: "money", primary: money(register.totalIn), tone: "in" },
          {
            kind: "money",
            primary: money(register.closingBalance),
            large: true,
          },
        ],
      },
    ],
  };

  return {
    title: `Bank statement — ${account.name}`,
    /*
     * Ledger BEFORE the charts — *"line by line statement take surute rakho
     * tarpor graph chart gulake nice rakho."* Right, and not only a
     * preference: the line-by-line is the thing somebody opens a statement
     * to read, and the charts are a summary of it. A summary before the
     * thing it summarises asks the reader to take it on trust.
     */
    pages: rows.length === 0 ? [cover, movement] : [cover, ledger, movement],
  };

  function sheet(left: string, right: string): Omit<PdfPage, "blocks"> {
    return {
      theme: "cream",
      eyebrowLeft: left,
      eyebrowRight: right,
      footer: { left: `${account.name} — ${options.companyName}` },
    };
  }
}

/* -------------------------------------------------------------------------- */
/*  The pieces                                                                 */
/* -------------------------------------------------------------------------- */

function ledgerRow(
  row: RegisterRow,
  money: (value: string) => string,
): PdfStackCell[] {
  const voided = Boolean(row.voidedAt);

  return [
    /*
     * The date, with the transaction number beneath it.
     *
     * A `label` rather than plain text, because the number has to go
     * somewhere now that Description is gone and this is the only cell with a
     * second line to put it on. A voided row says so here too — it used to be
     * marked in the description's detail line, which no longer exists, and a
     * void that does not announce itself is a figure a reader will add up.
     */
    {
      kind: "label",
      text: formatDay(row.txnDate),
      detail:
        [voided ? "VOIDED" : null, row.refNo].filter(Boolean).join(" · ") ||
        null,
    },
    /*
     * Debit is money OUT, credit is money IN. The order and the naming both
     * come from the on-screen statement, so the two cannot be read against
     * each other and disagree.
     *
     * A voided row shows its figure in the column it was in and contributes
     * nothing. Printing it as blank would be tidier and would also make the
     * document disagree with the screen, which lists it — and the reason to
     * list a void at all is that somebody is looking for the entry they
     * remember making.
     */
    row.direction === "out" && !voided
      ? { kind: "money", primary: money(row.amount), tone: "out" }
      : { kind: "empty" },
    row.direction === "in" && !voided
      ? { kind: "money", primary: money(row.amount), tone: "in" }
      : { kind: "empty" },
    voided
      ? { kind: "caps", text: "void" }
      : { kind: "money", primary: money(row.runningBalance) },
  ];
}

/**
 * Four pillars, never one per entry.
 *
 * A period with ninety movements drawn as ninety pillars is a grey smear. The
 * question a bank statement's first pages answer is where the balance started,
 * what came in, what went out and where it ended — so that is what this draws,
 * and the line-by-line overleaf is where the ninety live.
 */
function waterfall(
  register: RegisterResult,
  money: (value: string) => string,
  short: (value: string) => string,
): PdfWaterfallStep[] {
  const opening = Number(register.openingBalance);
  const inflow = Number(register.totalIn);
  const outflow = Number(register.totalOut);

  const afterIn = opening + inflow;
  const closing = afterIn - outflow;

  return [
    {
      label: "Opening",
      delta: "",
      deltaSecondary: "",
      balance: opening,
      balanceLabel: short(register.openingBalance),
      balanceSecondary: "",
      kind: "opening",
    },
    {
      label: "Money in",
      delta: `+${short(register.totalIn)}`,
      deltaSecondary: "",
      balance: afterIn,
      balanceLabel: short(afterIn.toFixed(2)),
      balanceSecondary: "",
      kind: "in",
    },
    {
      label: "Money out",
      delta: `−${short(register.totalOut)}`,
      deltaSecondary: "",
      balance: closing,
      balanceLabel: short(closing.toFixed(2)),
      balanceSecondary: "",
      kind: "out",
    },
    {
      label: "Closing",
      delta: "",
      deltaSecondary: "",
      balance: closing,
      balanceLabel: money(register.closingBalance),
      balanceSecondary: "",
      kind: "closing",
    },
  ];
}

/**
 * Outflow by heading, largest first, with the tail folded into "Other".
 *
 * `share` is a proportion of the total out — the arc is drawn from it, so a
 * period with no outflow at all must not reach here, or every slice is 0/0.
 * The caller checks that by requiring more than one slice.
 */
function shareOfOutflow(
  rows: RegisterRow[],
  format: NumberFormat,
): Array<{ label: string; share: number; color?: string | null }> {
  const out = rows.filter((row) => row.direction === "out");
  const total = out.reduce((sum, row) => sum + Number(row.amount), 0);
  if (total <= 0) return [];

  const byHeading = new Map<string, number>();
  for (const row of out) {
    const key = row.categoryName ?? "Uncategorised";
    byHeading.set(key, (byHeading.get(key) ?? 0) + Number(row.amount));
  }

  const sorted = [...byHeading.entries()]
    .map(([label, amount]) => ({
      label,
      share: amount / total,
      amount,
      color: null,
    }))
    .sort((a, b) => b.amount - a.amount);

  if (sorted.length <= DONUT_SLICES) {
    return sorted.map(({ label, share, color }) => ({ label, share, color }));
  }

  const head = sorted.slice(0, DONUT_SLICES - 1);
  const tail = sorted.slice(DONUT_SLICES - 1);
  return [
    ...head.map(({ label, share, color }) => ({ label, share, color })),
    {
      label: "Other",
      share: tail.reduce((sum, slice) => sum + slice.share, 0),
      color: null,
    },
  ];
  // `format` is accepted so the signature reads like the rest of this file's
  // money helpers; the donut labels its arcs by name and percentage only.
  void format;
}

/**
 * What the window actually covers, said three ways.
 *
 * Either end may be open — the export offers "leave a box empty to leave that
 * end open" — so the label falls back to the dates the rows themselves carry.
 * Saying "1970 to today" because a `from` was omitted would be a statement
 * about a period the account did not exist for.
 */
function describePeriod(
  from: string | undefined,
  to: string | undefined,
  rows: RegisterRow[],
) {
  const first = rows[0]?.txnDate;
  const last = rows[rows.length - 1]?.txnDate;

  const start = from ?? first;
  const end = to ?? last;

  if (!start && !end) {
    return {
      label: "All entries",
      lower: "the account's whole history",
      openedOn: "account opening",
      closedOn: "today",
    };
  }

  const openedOn = start ? formatDay(start) : "account opening";
  const closedOn = end ? formatDay(end) : "today";
  /*
   * An EN DASH, not an arrow. The embedded subset has no U+2192, and an
   * undrawable character comes out as a space — so every statement printed
   * "05/05/2026 05/09/2026", a range with nothing between its ends. The dash
   * is in the subset, and `SUBSTITUTES` now catches an arrow anyway.
   */
  const label = `${openedOn} – ${closedOn}`;

  return { label, lower: label, openedOn, closedOn };
}

function describeVoided(count: number): string {
  if (count === 0) return "";
  return count === 1
    ? "One voided entry is listed for the record and excluded from every total."
    : `${count} voided entries are listed for the record and excluded from every total.`;
}

/** `2026-08-05` → `05/08/2026`, the reading every screen in this app uses. */
function formatDay(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : iso;
}

/**
 * The last four digits only.
 *
 * A statement is emailed. The account number identifies the account for
 * somebody who already knows it and is a credential to somebody who does not,
 * and the screen this replaces shows it masked for the same reason.
 */
function maskAccount(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length <= 4) return `•••• ${trimmed}`;
  return `•••• ${trimmed.slice(-4)}`;
}
