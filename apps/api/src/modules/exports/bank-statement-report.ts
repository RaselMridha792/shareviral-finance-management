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
      { kind: "gap", height: 66 },
      {
        kind: "display",
        eyebrow: `${account.name} · ${period.label}`,
        lines: ["Bank", "Statement."],
        size: 58,
      },
      { kind: "gap", height: 6 },
      {
        kind: "lede",
        size: 12.5,
        width: 366,
        text:
          `Every movement through ${account.name} for ${period.lower}, in date order, ` +
          `carried from the balance the account opened the period with to the balance ` +
          `it closed on. Figures are stated in taka. ` +
          `${describeVoided(rows.length - live.length)}`,
      },
      { kind: "gap", height: 22 },
      {
        kind: "figureBoxes",
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
      { kind: "anchor", fromBottom: 208 },
      {
        kind: "bigFigures",
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
      { kind: "display", lines: ["The movement."], size: 36 },
      { kind: "gap", height: 5 },
      {
        kind: "lede",
        text:
          `Where the balance started, what came in, what went out, and where it ` +
          `finished — the whole of ${period.lower} in one shape, before the ` +
          `line-by-line overleaf.`,
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
            `It is not a movement and does not appear as a line overleaf; every balance ` +
            `in that column is built on it.`,
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

  const ledger: PdfPage = {
    ...sheet("Line by line", `${account.name} · Ledger`),
    blocks: [
      { kind: "gap", height: 8 },
      { kind: "display", lines: ["Line by line."], size: 36 },
      { kind: "gap", height: 5 },
      {
        kind: "lede",
        text:
          `${rows.length} ${rows.length === 1 ? "entry" : "entries"} for ${period.lower}, ` +
          `oldest first, with the balance after each. The paged layout continues this ` +
          `table onto as many sheets as it needs.`,
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
        columns: [
          { header: "Date", width: 0.11 },
          { header: "Description", width: 0.37 },
          { header: "In", width: 0.16, align: "right" },
          { header: "Out", width: 0.16, align: "right" },
          { header: "Balance", width: 0.2, align: "right" },
        ],
        rows: rows.map((row) => ledgerRow(row, money)),
        total: [
          { kind: "caps", text: "Closing" },
          { kind: "empty" },
          { kind: "money", primary: money(register.totalIn), tone: "in" },
          { kind: "money", primary: money(register.totalOut), tone: "out" },
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
    pages: rows.length === 0 ? [cover, movement] : [cover, movement, ledger],
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
  const party = row.vendorName ?? row.counterparty ?? row.categoryName;
  const detail = [voided ? "VOIDED" : null, party, row.refNo]
    .filter(Boolean)
    .join(" · ");

  return [
    { kind: "text", text: formatDay(row.txnDate) },
    {
      kind: "label",
      text: row.description ?? "—",
      detail: detail || null,
    },
    /*
     * A voided row shows its figure in the column it was in and contributes
     * nothing. Printing it as blank would be tidier and would also make the
     * document disagree with the screen, which lists it — and the reason to
     * list a void at all is that somebody is looking for the entry they
     * remember making.
     */
    row.direction === "in" && !voided
      ? { kind: "money", primary: money(row.amount), tone: "in" }
      : { kind: "empty" },
    row.direction === "out" && !voided
      ? { kind: "money", primary: money(row.amount), tone: "out" }
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
  const label = `${openedOn} → ${closedOn}`;

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
