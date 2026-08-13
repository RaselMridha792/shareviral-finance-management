import {
  formatMoney,
  type NumberFormat,
  type OverviewReport,
  type PendingItem,
} from "@finance/shared";

import type { PdfBlock, PdfDocumentSpec } from "./pdf.service";

/**
 * What goes in the overview PDF, as opposed to how a PDF is drawn.
 *
 * This is the file that changes when a required format arrives — the layout
 * engine underneath it does not have to. Everything here is a decision about
 * content and order; nothing here knows about pages or fonts.
 */

/**
 * Amounts carry their ৳ sign.
 *
 * They did not for a while: PDFKit's built-in fonts are Latin-1 and the taka
 * sign is not in them, so it was stripped and the currency stated once at the
 * top instead. A company's accounts printed with no currency symbol on any
 * figure is not what the report they replace looks like — the layer that draws
 * these pages now embeds a face that has the glyph, so the sign goes back where
 * it belongs.
 */
function money(value: string, format: NumberFormat): string {
  return formatMoney(value, { format, hideDecimals: false });
}

function shortMoney(value: string, format: NumberFormat): string {
  return formatMoney(value, { format, hideDecimals: true });
}

function percent(current: string, previous: string | undefined): string {
  if (previous === undefined) return "";
  const before = Number(previous);
  if (before === 0) return "";
  const change = ((Number(current) - before) / before) * 100;
  const sign = change >= 0 ? "+" : "−";
  return `${sign}${Math.abs(change).toFixed(1)}% on last period`;
}

export function buildOverviewReport(
  report: OverviewReport,
  pending: PendingItem[],
  options: {
    companyName: string;
    numberFormat: NumberFormat;
    generatedBy: string;
    generatedOn: string;
  },
): PdfDocumentSpec {
  const { numberFormat: fmt } = options;
  const { totals, previous } = report;

  const blocks: PdfBlock[] = [];

  /* --- the figures --------------------------------------------------- */

  blocks.push({ kind: "heading", text: "Position" });
  blocks.push({
    kind: "stats",
    items: [
      {
        label: "Cash in hand",
        value: money(totals.cashInHand, fmt),
        hint: "every account, today",
      },
      {
        label: "Money in",
        value: money(totals.moneyIn, fmt),
        hint: percent(totals.moneyIn, previous?.moneyIn),
      },
      {
        label: "Money out",
        value: money(totals.moneyOut, fmt),
        hint: percent(totals.moneyOut, previous?.moneyOut),
      },
      {
        label: "Net",
        value: money(totals.net, fmt),
        hint: `${totals.entries} entries`,
      },
      {
        label: "Salary paid",
        value: money(totals.salaryPaid, fmt),
        hint: `${report.headcount.employees} on payroll`,
      },
      {
        label: "Funding received",
        value: money(totals.fundingReceived, fmt),
        hint: "from abroad",
      },
      {
        label: "Tax withheld",
        value: money(totals.taxWithheld, fmt),
        hint: `${shortMoney(totals.taxDeposited, fmt)} deposited`,
      },
      {
        label: "Tax not deposited",
        value: money(totals.taxOutstanding, fmt),
        hint: "all time",
      },
    ],
  });

  /* --- accounts ------------------------------------------------------- */

  if (report.balances.length) {
    blocks.push({ kind: "heading", text: "Accounts" });
    blocks.push({
      kind: "table",
      columns: [
        { header: "Account", width: 46 },
        { header: "Type", width: 24 },
        { header: "Balance", width: 30, align: "right" },
      ],
      rows: report.balances.map((account) => [
        account.name,
        account.type.replace(/_/g, " "),
        money(account.balance, fmt),
      ]),
      total: [
        "Total",
        "",
        money(
          report.balances
            .reduce((sum, a) => sum + Number(a.balance), 0)
            .toFixed(2),
          fmt,
        ),
      ],
    });
  }

  /* --- month by month -------------------------------------------------- */

  blocks.push({ kind: "heading", text: "Twelve months" });
  blocks.push({
    kind: "table",
    columns: [
      { header: "Month", width: 26 },
      { header: "In", width: 18, align: "right" },
      { header: "Out", width: 18, align: "right" },
      { header: "Net", width: 18, align: "right" },
      { header: "Closing balance", width: 20, align: "right" },
    ],
    rows: report.months.map((month) => [
      month.label,
      shortMoney(month.moneyIn, fmt),
      shortMoney(month.moneyOut, fmt),
      shortMoney(month.net, fmt),
      shortMoney(month.closingBalance, fmt),
    ]),
  });

  /* --- where it went --------------------------------------------------- */

  if (report.spendByCategory.length) {
    const biggest = Number(report.spendByCategory[0].total);
    blocks.push({ kind: "heading", text: "Where the money went" });
    blocks.push({
      kind: "bars",
      items: report.spendByCategory.slice(0, 8).map((line) => ({
        label: `${line.name}  ${line.share.toFixed(0)}%`,
        value: money(line.total, fmt),
        fraction: biggest > 0 ? Number(line.total) / biggest : 0,
      })),
    });
  }

  if (report.topVendors.length) {
    const biggest = Number(report.topVendors[0].total);
    blocks.push({ kind: "heading", text: "Paid the most" });
    blocks.push({
      kind: "bars",
      items: report.topVendors.map((vendor) => ({
        label: `${vendor.name}  (${vendor.entries})`,
        value: money(vendor.total, fmt),
        fraction: biggest > 0 ? Number(vendor.total) / biggest : 0,
      })),
    });
  }

  /* --- what is owed ---------------------------------------------------- */

  if (pending.length) {
    blocks.push({ kind: "heading", text: "Waiting on you" });
    blocks.push({
      kind: "table",
      columns: [
        { header: "What", width: 40 },
        { header: "Detail", width: 38 },
        { header: "Due", width: 22, align: "right" },
      ],
      rows: pending.map((item) => [
        item.title,
        item.detail,
        `${item.status === "overdue" ? "overdue " : ""}${item.dueOn}`,
      ]),
    });
  }

  /* --- the latest entries ---------------------------------------------- */

  if (report.recent.length) {
    blocks.push({ kind: "heading", text: "Latest entries" });
    blocks.push({
      kind: "table",
      columns: [
        { header: "Date", width: 15 },
        { header: "Ref", width: 18 },
        { header: "Description", width: 35 },
        { header: "Category", width: 16 },
        // Wide enough for a crore with the ৳ on it. The symbol costs the
        // column about half a digit, and an amount is the one cell here that
        // may not be cut.
        { header: "Amount", width: 16, align: "right" },
      ],
      rows: report.recent.map((entry) => [
        entry.txnDate,
        entry.refNo,
        entry.description,
        entry.categoryName ?? "—",
        (entry.direction === "out" ? "− " : "") + money(entry.amount, fmt),
      ]),
    });
  }

  const currencyLine =
    report.currency === "USD" && report.fx
      ? `All figures in USD — ${report.fx.caption}`
      : `All figures in ${report.currency}`;

  return {
    title: `${options.companyName} — Overview`,
    subtitle: [
      `${report.period.label}  ·  ${report.period.start} to ${report.period.end}`,
      currencyLine,
    ],
    footer: `Generated by ${options.generatedBy} on ${options.generatedOn}. Figures are as recorded at that moment; the app is the record.`,
    blocks,
  };
}
