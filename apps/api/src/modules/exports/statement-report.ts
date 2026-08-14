import {
  formatMoney,
  type AccountLedger,
  type FinancialStatement,
  type Money2,
  type NumberFormat,
  type OutflowShare,
  type StatementLine,
  type WaterfallStep,
} from "@finance/shared";

import type {
  PdfPage,
  PdfPagedBlock,
  PdfPagedSpec,
  PdfStackCell,
  PdfWaterfallStep,
} from "./pdf.service";

/**
 * The six pages of the financial statement.
 *
 * This is the file that knows the document: which figure belongs on the cover,
 * what the notes say, where the ledger breaks. The layer underneath knows
 * nothing about money — it draws pages, tables and arcs. That split is why a
 * change to the wording of a note does not risk the pagination, and a change to
 * the pagination cannot silently alter a figure.
 *
 * Everything here comes from one `FinancialStatement`. Nothing is recomputed:
 * if a total on page 2 disagreed with the ledger on page 4, that would be the
 * statement service's bug to fix, not something to paper over here.
 */

/* -------------------------------------------------------------------------- */
/*  Money on the page                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Taka, with the ৳ on it.
 *
 * The sign used to be stripped: PDFKit's built-in fonts are Latin-1 and it is
 * not in them, so it came out as mojibake and the currency was left to the
 * column heading. The layer that draws these pages now embeds a face that has
 * the glyph, so a statement of a Bangladeshi company's accounts reads in taka
 * the way the hand-made document it replaces always did — and the ৳ against the
 * `$` on the line beneath tells the two currencies apart at a glance, rather
 * than by remembering which line is which.
 */
function bdt(value: string, format: NumberFormat): string {
  return formatMoney(value, { format, hideDecimals: true });
}

/**
 * The dollar line under a taka figure.
 *
 * Always grouped western, whatever the company's number format: a dollar
 * amount written as $40,15,5.87 is not a dollar amount. `~` marks a figure the
 * statement flagged as translated at a period rate rather than at the entry's
 * own — the document has always distinguished the two, and a reader cannot ask
 * the page which it is looking at.
 */
function usd(money: Money2): string {
  if (money.usd === null) return "";
  const body = formatMoney(money.usd, {
    currency: "USD",
    format: "western",
    hideDecimals: false,
  });
  return money.estimated ? `~${body}` : body;
}

/**
 * Puts a sign on a dollar figure without burying the estimate marker.
 *
 * `~` belongs in front of the whole thing: "+~$269.47" reads as an arithmetic
 * accident, "~+$269.47" reads as "about plus".
 */
function signDollars(dollars: string, sign: string): string {
  if (!dollars) return "";
  const estimated = dollars.startsWith("~");
  return `${estimated ? "~" : ""}${sign}${estimated ? dollars.slice(1) : dollars}`;
}

function signed(money: Money2, direction: "in" | "out", format: NumberFormat) {
  const sign = direction === "in" ? "+" : "−";
  return {
    primary: `${sign}${bdt(money.bdt, format)}`,
    secondary: signDollars(usd(money), sign),
  };
}

/**
 * A waterfall delta, signed once.
 *
 * The sign is stripped from the figure and put back deliberately, because
 * `formatMoney` already writes a typographic minus (U+2212) and stripping only
 * the ASCII one left "−−$12,226.57" on the chart.
 */
function deltaOf(step: WaterfallStep, format: NumberFormat) {
  if (!step.delta) return { primary: "", secondary: "" };
  const negative = Number(step.delta.bdt) < 0 || step.kind === "out";
  const unsign = (value: string) => value.replace(/[-−]/g, "");
  const sign = negative ? "−" : "+";
  return {
    primary: `${sign}${bdt(unsign(step.delta.bdt), format)}`,
    secondary: signDollars(unsign(usd(step.delta)), sign),
  };
}

/* -------------------------------------------------------------------------- */
/*  The document                                                               */
/* -------------------------------------------------------------------------- */

export type StatementReportOptions = {
  numberFormat: NumberFormat;
  generatedOn: string;
};

export function buildStatementReport(
  statement: FinancialStatement,
  options: StatementReportOptions,
): PdfPagedSpec {
  const fmt = options.numberFormat;
  const { period, company, summary, composition } = statement;

  const reconciled = statement.status === "reconciled";
  const stateWord = reconciled ? "Reconciled" : "Draft";
  const auditWord = statement.audited ? "Audited" : "Unaudited";
  const cycle = `${period.label.match(/\d{4}/)?.[0] ?? ""} · Cycle ${String(
    statement.cycle,
  ).padStart(2, "0")}`.trim();

  const bank = summary.closing.bank;
  const card = summary.closing.card;

  const inflow = summary.lines.find((line) => line.basis === "Inflow");
  const totalIn = inflow?.amount ?? { bdt: "0.00", usd: null, rate: null };

  /**
   * The card box has to name the account its figure came from.
   *
   * `summary.closing.card` is the total of the non-base-currency accounts, so
   * taking the *second* ledger for the label put "Petty cash" above the card's
   * balance — a right number under a wrong name, which is the kind of error a
   * reader has no way to catch. Find the ledger the figure actually belongs
   * to; fall back to the second only when there is no foreign-currency account
   * at all.
   */
  const bankLedger = statement.ledgers[0] ?? null;
  const base = bankLedger?.currency ?? "BDT";
  const cardLedger =
    statement.ledgers.find((ledger) => ledger.currency !== base) ??
    statement.ledgers[1] ??
    null;

  /**
   * Every account, split by currency — not one of each.
   *
   * `bankLedger` and `cardLedger` above pick a single ledger each, which is
   * fine for naming the two figures on the cover and nowhere else. The ledger
   * pages used them directly, so with three accounts the third was simply
   * never printed: Standard Chartered — the main account, holding ৳34,41,700
   * and eight of the period's nine entries — was missing from the document,
   * and page 4 showed the petty-cash tin's two rows with the rest of the page
   * blank. A statement that silently omits an account is worse than no
   * statement, because it looks complete.
   *
   * Ordinals run across both lists so the section numbers stay sequential
   * however many accounts there are.
   */
  const bankLedgers = statement.ledgers.filter(
    (ledger) => ledger.currency === base,
  );
  const otherLedgers = statement.ledgers.filter(
    (ledger) => ledger.currency !== base,
  );
  const ordinalOf = (ledger: (typeof statement.ledgers)[number]) =>
    String(statement.ledgers.indexOf(ledger) + 4).padStart(2, "0");

  return {
    title: `${company.name} — Financial Report — ${period.label}`,
    pages: [
      cover(),
      executiveSummary(),
      fundMovement(),
      ...ledgerPages(),
      closing(),
    ],
  };

  /* --- 1. the cover ---------------------------------------------------- */

  function cover(): PdfPage {
    const accounts = [
      bankLedger && `BDT · ${bankLedger.subtitle ?? bankLedger.name}`,
      cardLedger && `${cardLedger.name} · ${cardLedger.subtitle ?? "prepaid"}`,
      auditWord,
    ].filter(Boolean);

    return {
      theme: "dark",
      eyebrowLeft: "</>",
      eyebrowRight: `${shortName(company.name)} · Financial Report   ${cycle}`,
      footer: {
        left: [company.counterparty, company.name].filter(Boolean).join(" · "),
        right: `${period.label} · Confidential`,
        pageNumber: false,
        rule: false,
      },
      blocks: [
        { kind: "gap", height: 66 },
        {
          kind: "display",
          eyebrow: `${describeGranularity(period.granularity)} financial statement · ${period.label}`,
          lines: ["Financial", "Report."],
          size: 58,
        },
        { kind: "gap", height: 6 },
        {
          kind: "lede",
          size: 12.5,
          width: 366,
          text:
            `A consolidated statement of intercompany transfers received, payroll and ` +
            `operating expenditure, tax movements and cash position across the ` +
            `Bangladesh operation of the ${company.name} group for the period. All figures ` +
            `are stated in taka with USD equivalents and reconciled to closing balance.`,
        },
        { kind: "gap", height: 22 },
        {
          kind: "figureBoxes",
          items: [
            {
              // The currency is on the figure, where a statement puts it. It
              // rode in the label — "Closing bank balance · BDT" — only for as
              // long as the ৳ could not be drawn.
              label: "Closing bank balance",
              primary: bdt(bank.bdt, fmt),
              secondary: usd(bank),
              source: bankLedger
                ? `${bankLedger.subtitle ?? bankLedger.name} · ${company.name}`
                : company.name,
            },
            ...(card
              ? [
                  {
                    label: `${cardLedger?.name ?? "Prepaid card"} balance`,
                    primary: bdt(card.bdt, fmt),
                    secondary: usd(card),
                    source: cardLedger
                      ? `${cardLedger.name} · ${cardLedger.subtitle ?? "prepaid"}`
                      : "Prepaid card",
                  },
                ]
              : []),
          ],
        },
        // The foot of the cover is fixed to the sheet, not to the flow above
        // it, so a longer company name cannot push it off the page.
        { kind: "anchor", fromBottom: 208 },
        {
          kind: "bigFigures",
          items: [
            {
              value: bdt(totalIn.bdt, fmt),
              secondary: usd(totalIn),
              label: "Transfer received",
            },
            {
              value: bdt(statement.outflow.total.bdt, fmt),
              secondary: usd(statement.outflow.total),
              label: "Total outflow",
            },
            {
              value: stateWord,
              label: "Period status",
              align: "right",
              word: true,
            },
          ],
        },
        { kind: "gap", height: 12 },
        { kind: "capsRow", left: accounts.join("  ×  ") },
        { kind: "gap", height: 2 },
        { kind: "rule" },
      ],
    };
  }

  /* --- 2. executive summary -------------------------------------------- */

  function executiveSummary(): PdfPage {
    return {
      ...sheet("Month by month", "Executive summary · 01 / 01"),
      blocks: [
        { kind: "gap", height: 8 },
        { kind: "display", lines: ["The money log."], size: 36 },
        { kind: "gap", height: 5 },
        {
          kind: "lede",
          text:
            `Transfers, payroll and tooling for ${period.label} — how ` +
            `${bdt(totalIn.bdt, fmt)} arrived` +
            `${company.counterparty ? ` from ${company.counterparty}` : ""}, how the ` +
            `${bdt(statement.outflow.total.bdt, fmt)} outflow was applied, and how the ` +
            `closing bank balance splits between company cash and tax held for the ` +
            `government.`,
        },
        { kind: "gap", height: 9 },
        {
          kind: "periodMark",
          // The mark draws the ordinal beside the label, and on a yearly
          // statement the ordinal is literally "FY" while the label is
          // "FY 2026-27" — printed together they read "FY  FY 2026-27".
          // Dropped where the label already opens with it.
          ordinal: period.label.startsWith(period.ordinal)
            ? ""
            : period.ordinal,
          label: period.label,
          right: `${reconciled ? "Reconciled" : "Draft"} · ${statement.lineItems} line items`,
        },
        { kind: "gap", height: 20 },
        {
          kind: "sectionHead",
          ordinal: "01",
          title: "Executive summary",
          right: card ? "Bank & card" : "Bank",
        },
        {
          kind: "stackTable",
          columns: [
            { header: "Measure", width: 50 },
            { header: "Basis", width: 18, align: "right" },
            { header: "Amount (BDT / USD)", width: 32, align: "right" },
          ],
          // The statement is a position, not a list: it has always shown the
          // handful of measures that explain the period, so a longer one that
          // grew a fifth category still fits on one page.
          rows: summary.lines.slice(0, 6).map((line) => [
            labelCell(line),
            { kind: "text", text: line.basis },
            {
              kind: "money",
              primary: bdt(line.amount.bdt, fmt),
              secondary: usd(line.amount),
            },
          ]),
          total: [
            { kind: "caps", text: "Closing position" },
            { kind: "caps", text: card ? "Bank / Card" : "Bank" },
            {
              kind: "money",
              large: true,
              primary: card
                ? `${bdt(bank.bdt, fmt)} · ${bdt(card.bdt, fmt)}`
                : bdt(bank.bdt, fmt),
              secondary: card
                ? [usd(bank), usd(card)].filter(Boolean).join(" · ")
                : usd(bank),
            },
          ],
        },
        { kind: "gap", height: 26 },
        {
          kind: "sectionHead",
          ordinal: "02",
          title: "Cash composition",
          right: "BDT bank at period end",
        },
        {
          kind: "stackTable",
          columns: [
            { header: "Component", width: 50 },
            { header: "Nature", width: 18, align: "right" },
            { header: "Amount (BDT / USD)", width: 32, align: "right" },
          ],
          rows: compositionRows(),
          total: [
            { kind: "caps", text: "BDT bank balance" },
            { kind: "empty" },
            {
              kind: "money",
              large: true,
              primary: bdt(composition.total.bdt, fmt),
              secondary: usd(composition.total),
            },
          ],
        },
      ],
    };
  }

  function compositionRows(): PdfStackCell[][] {
    const rows: PdfStackCell[][] = [
      [
        {
          kind: "label",
          text: "Unrestricted company cash",
          detail:
            composition.committedForward && composition.committedForwardNote
              ? `Incl. ${bdt(composition.committedForward.bdt, fmt)} ${composition.committedForwardNote}`
              : "Free to spend",
        },
        { kind: "text", text: "Free" },
        {
          kind: "money",
          primary: bdt(composition.free.bdt, fmt),
          secondary: usd(composition.free),
        },
      ],
    ];

    if (Number(composition.restricted.bdt) !== 0) {
      rows.push([
        {
          kind: "label",
          text: "Withholding tax held",
          detail: "Deducted this period, not yet handed to the treasury",
        },
        { kind: "text", text: "Restricted" },
        {
          kind: "money",
          tone: "out",
          primary: bdt(composition.restricted.bdt, fmt),
          secondary: usd(composition.restricted),
        },
      ]);
    }

    return rows;
  }

  /* --- 3. fund movement -------------------------------------------------- */

  function fundMovement(): PdfPage {
    const steps = waterfallSteps();
    const shares = topShares(statement.outflow.shares);

    return {
      ...sheet("How it moved", "Fund movement · 01 / 01"),
      blocks: [
        { kind: "gap", height: 8 },
        { kind: "display", lines: ["The movement."], size: 36 },
        { kind: "gap", height: 5 },
        {
          kind: "lede",
          text:
            `Every movement from opening bank balance to closing position, and the ` +
            `share each category took of the ${bdt(statement.outflow.total.bdt, fmt)} ` +
            `total outflow for the period.`,
        },
        { kind: "gap", height: 12 },
        {
          kind: "sectionHead",
          ordinal: "03",
          title: "Fund movement",
          right: bankLedger ? bankLedger.name : "Bank account",
        },
        {
          kind: "waterfall",
          title: "Cash flow waterfall",
          subtitle:
            "From opening bank balance through every transfer in, then payroll, " +
            "facility and other costs, to closing position. All figures in BDT, " +
            "with USD beneath.",
          steps,
        },
        { kind: "gap", height: 17 },
        {
          kind: "donut",
          title: "Outflow breakdown",
          subtitle: "Share of each category in the period's total outflow.",
          centreLabel: "Total outflow",
          centreValue: bdt(statement.outflow.total.bdt, fmt),
          // Deliberately not `share.color`. Those are the app's category
          // colours, chosen so categories are told apart on a screen; dropped
          // into this document they turn a signed statement into a pie chart
          // from a different report. The ring uses the statement's own ramp, so
          // recolouring a category in settings cannot restyle a signed PDF.
          slices: shares.map((share) => ({
            label: share.label,
            share: share.share,
            color: null,
          })),
        },
      ],
    };
  }

  /**
   * The waterfall, capped at eight pillars.
   *
   * A year has more outflow groups than a month, and a chart with fourteen
   * columns is a table drawn badly. The smallest are merged into one "other"
   * pillar so the shape of the period still reads at a glance — and every one
   * of them is still on the ledger pages, line by line, which is where somebody
   * checking a figure goes anyway.
   */
  function waterfallSteps(): PdfWaterfallStep[] {
    const MAX = 8;
    const steps = [...statement.waterfall];

    if (steps.length > MAX) {
      const opening = steps[0];
      const closing = steps[steps.length - 1];
      const middle = steps.slice(1, -1);
      const keep = middle.slice(0, MAX - 3);
      const merged = middle.slice(MAX - 3);
      const total = merged.reduce(
        (sum, step) => sum + Math.abs(Number(step.delta?.bdt ?? 0)),
        0,
      );
      const last = merged[merged.length - 1];
      steps.length = 0;
      steps.push(opening, ...keep, {
        label: "Other",
        kind: "out",
        delta: { bdt: `-${total.toFixed(2)}`, usd: null, rate: null },
        balance: last.balance,
      });
      steps.push(closing);
    }

    return steps.map((step) => {
      const delta = deltaOf(step, fmt);
      return {
        label: step.label,
        kind: step.kind,
        delta: delta.primary,
        deltaSecondary: delta.secondary,
        balance: Number(step.balance.bdt),
        balanceLabel: bdt(step.balance.bdt, fmt),
        balanceSecondary: usd(step.balance),
      };
    });
  }

  /** Six slices at most; the tail becomes one, so the ring stays readable. */
  function topShares(shares: OutflowShare[]): OutflowShare[] {
    if (shares.length <= 6) return shares;
    const head = shares.slice(0, 5);
    const tail = shares.slice(5);
    return [
      ...head,
      {
        label: "Other",
        amount: tail[0].amount,
        share: tail.reduce((sum, s) => sum + s.share, 0),
        color: null,
      },
    ];
  }

  /* --- 4 and 5. the ledgers ---------------------------------------------- */

  function ledgerPages(): PdfPage[] {
    const pages: PdfPage[] = [];

    if (bankLedgers.length) {
      pages.push({
        ...sheet("Line by line", "Account ledgers · 01 / 01"),
        footer: {
          left:
            bankLedgers.length === 1
              ? `Account ledgers — ${bankLedgers[0].name}`
              : "Account ledgers",
        },
        blocks: [
          { kind: "gap", height: 8 },
          { kind: "display", lines: ["The ledgers."], size: 36 },
          { kind: "gap", height: 5 },
          {
            kind: "lede",
            text:
              `Line-by-line reconciliation of ${describeAccountCount(statement.ledgers.length)} ` +
              `for ${period.label}, from opening balance carried forward to closing position.`,
          },
          { kind: "gap", height: 12 },
          // Every taka account, not just the first. The paged engine flows
          // these onto continuation sheets when they do not fit.
          ...bankLedgers.flatMap((ledger): PdfPagedBlock[] => [
            {
              kind: "sectionHead",
              ordinal: ordinalOf(ledger),
              title: ledger.name,
              right: ledger.subtitle ?? "",
            },
            ledgerTable(ledger),
            { kind: "gap", height: 18 },
          ]),
        ],
      });
    }

    const cardBlocks: PdfPagedBlock[] = otherLedgers.flatMap(
      (ledger): PdfPagedBlock[] => [
        {
          kind: "sectionHead",
          ordinal: ordinalOf(ledger),
          title: ledger.name,
          right: ledger.subtitle ?? "",
        },
        ledgerTable(ledger),
        { kind: "gap", height: 22 },
      ],
    );

    const secondPageTitle = cardLedger
      ? `${isCard(cardLedger) ? "Card" : "Second"} ledger & notes`
      : "Notes";

    pages.push({
      ...sheet("Line by line", secondPageTitle),
      footer: { left: `${secondPageTitle} — ${company.name}` },
      blocks: [
        { kind: "gap", height: 8 },
        {
          kind: "display",
          lines: [
            cardLedger
              ? `The ${isCard(cardLedger) ? "card" : "ledger"} & notes.`
              : "The notes.",
          ],
          size: 36,
        },
        { kind: "gap", height: 5 },
        {
          kind: "lede",
          text: cardLedger
            ? `${cardLedger.name}${cardLedger.subtitle ? ` — ${cardLedger.subtitle}` : ""} for ${period.label}, followed by the notes to the accounts.`
            : `The notes to the accounts for ${period.label}.`,
        },
        { kind: "gap", height: 12 },
        ...cardBlocks,
        {
          kind: "sectionHead",
          ordinal: cardLedger ? "06" : "05",
          title: "Notes to the accounts",
          right: auditWord,
        },
        { kind: "gap", height: 2 },
        { kind: "notes", items: notes() },
      ],
    });

    return pages;
  }

  function ledgerTable(ledger: AccountLedger): PdfPagedBlock {
    return {
      kind: "stackTable",
      columns: [
        { header: "Particulars", width: 51 },
        { header: "Type", width: 8, align: "left" },
        { header: "Amount (BDT / USD)", width: 19, align: "right" },
        { header: "Balance (BDT / USD)", width: 22, align: "right" },
      ],
      rows: [
        ...(opensItself(ledger)
          ? []
          : [
              [
                {
                  kind: "label" as const,
                  text: "Opening balance carried forward",
                  detail: `Position at ${previousDay(period.start)}`,
                },
                { kind: "pill" as const, text: "in", tone: "in" as const },
                {
                  kind: "money" as const,
                  tone: "in" as const,
                  primary: `+${bdt(ledger.opening.bdt, fmt)}`,
                  secondary: signDollars(usd(ledger.opening), "+"),
                },
                {
                  kind: "money" as const,
                  primary: bdt(ledger.opening.bdt, fmt),
                  secondary: usd(ledger.opening),
                },
              ],
            ]),
        ...ledger.rows.map((row): PdfStackCell[] => {
          const amount = signed(row.amount, row.direction, fmt);
          return [
            { kind: "label", text: row.label, detail: row.detail },
            { kind: "pill", text: row.direction, tone: row.direction },
            {
              kind: "money",
              tone: row.direction,
              primary: amount.primary,
              secondary: amount.secondary,
            },
            {
              kind: "money",
              primary: bdt(row.balance.bdt, fmt),
              secondary: usd(row.balance),
            },
          ];
        }),
      ],
      total: [
        { kind: "caps", text: "Closing balance" },
        { kind: "empty" },
        { kind: "empty" },
        {
          kind: "money",
          large: true,
          primary: bdt(ledger.closing.bdt, fmt),
          secondary: usd(ledger.closing),
        },
      ],
    };
  }

  /**
   * The notes.
   *
   * A person writes these; the app supplies a first draft. When nobody has
   * written any yet the page still has to say something true, so it states what
   * the ledger itself establishes rather than printing an empty section.
   */
  function notes(): string[] {
    if (statement.notes.length) return statement.notes;

    const drafted: string[] = [];

    if (bankLedger) {
      drafted.push(
        `The **opening balance** of **${bdt(bankLedger.opening.bdt, fmt)}** is carried ` +
          `forward from the previous statement.`,
      );
    }
    if (bankLedger?.rateFrom) {
      const range =
        bankLedger.rateTo && bankLedger.rateTo !== bankLedger.rateFrom
          ? `${bankLedger.rateFrom}–${bankLedger.rateTo}`
          : bankLedger.rateFrom;
      drafted.push(
        `**USD equivalents** are shown for reference and converted at the rate ` +
          `recorded against each entry on the day (**${range} per USD** on the bank ` +
          `account this period), not at a single rate applied afterwards.`,
      );
    }
    drafted.push(
      `**Total outflow of ${bdt(statement.outflow.total.bdt, fmt)}** was applied across ` +
        `${statement.outflow.shares.length} categories, the largest being ` +
        `**${statement.outflow.shares[0]?.label ?? "operating costs"}**.`,
    );
    if (Number(composition.restricted.bdt) !== 0) {
      drafted.push(
        `**Withholding tax of ${bdt(composition.restricted.bdt, fmt)}** has been deducted ` +
          `and is **held in the bank account**; it had not been remitted at period end, ` +
          `so it sits in the closing balance without being the company's to spend.`,
      );
    }
    if (composition.committedForward && composition.committedForwardNote) {
      drafted.push(
        `**${bdt(composition.committedForward.bdt, fmt)}** of the closing balance is ` +
          `${composition.committedForwardNote} — received in this period and committed ` +
          `to the next.`,
      );
    }
    drafted.push(
      `Consequently the **bank balance of ${bdt(composition.total.bdt, fmt)}** comprises ` +
        `${bdt(composition.free.bdt, fmt)} of company cash and ` +
        `${bdt(composition.restricted.bdt, fmt)} of restricted cash held against the tax ` +
        `liability. This statement is **${auditWord.toLowerCase()}**.`,
    );

    return drafted;
  }

  /* --- 6. the closing page ------------------------------------------------ */

  function closing(): PdfPage {
    const committed =
      composition.committedForward && composition.committedForwardNote
        ? ` (including ${bdt(composition.committedForward.bdt, fmt)} ${composition.committedForwardNote})`
        : "";

    return {
      theme: "dark",
      eyebrowLeft: "End of report",
      eyebrowRight: cycle,
      footer: {
        left: `Report generated ${options.generatedOn}`,
        right: [company.counterparty, shortName(company.name)]
          .filter(Boolean)
          .join(" × "),
      },
      blocks: [
        { kind: "gap", height: 98 },
        {
          kind: "display",
          eyebrow: `Where ${period.label} landed`,
          lines: ["Status:", `${stateWord.toLowerCase()}.`],
          size: 46,
        },
        { kind: "gap", height: 12 },
        {
          kind: "lede",
          size: 12.5,
          width: 380,
          text:
            `The bank account holds ${bdt(bank.bdt, fmt)}${money(bank)} — of which ` +
            `${bdt(composition.free.bdt, fmt)}${money(composition.free)} is company cash` +
            `${committed} and ${bdt(composition.restricted.bdt, fmt)}` +
            `${money(composition.restricted)} is tax held pending processing` +
            `${card ? ` — with a further ${bdt(card.bdt, fmt)}${money(card)} on ${cardLedger ? cardLedger.name.toLowerCase() : "the prepaid card"}` : ""}. ` +
            `${auditWord}.`,
        },
        { kind: "gap", height: 22 },
        {
          kind: "signatures",
          items: statement.signatories.length
            ? statement.signatories
            : [{ name: " ", title: "Prepared by" }],
        },
        { kind: "anchor", fromBottom: 182 },
        {
          kind: "bigFigures",
          items: [
            {
              value: bdt(composition.free.bdt, fmt),
              secondary: usd(composition.free),
              label: "Free cash",
            },
            {
              value: bdt(composition.restricted.bdt, fmt),
              secondary: usd(composition.restricted),
              label: "Tax held",
            },
            ...(card
              ? [
                  {
                    value: bdt(card.bdt, fmt),
                    secondary: usd(card),
                    label: `${cardLedger?.name ?? "Card"}`,
                  },
                ]
              : []),
          ],
        },
      ],
    };
  }

  /* --- shared page chrome -------------------------------------------------- */

  function sheet(left: string, right: string): Omit<PdfPage, "blocks"> {
    return {
      theme: "cream",
      eyebrowLeft: left,
      eyebrowRight: right,
      footer: { left: `${right.split(" · ")[0]} — ${company.name}` },
    };
  }

  function money(value: Money2): string {
    const dollars = usd(value);
    return dollars ? ` (${dollars})` : "";
  }
}

/* -------------------------------------------------------------------------- */

function labelCell(line: StatementLine): PdfStackCell {
  return { kind: "label", text: line.label, detail: line.detail };
}

/**
 * "ShareViral Bangladesh" in a running header is the group, not the entity —
 * and at 7.5pt tracked it is most of the line. The eyebrow takes the first
 * word; the footer, where there is room, keeps the whole name.
 */
function shortName(name: string): string {
  return name.split(" ")[0] || name;
}

/**
 * Does this ledger already start with its own opening row?
 *
 * The sample's ledgers open with "Opening balance carried forward" before the
 * first movement, and the statement service may or may not supply it — so the
 * page checks rather than assumes. If the first row's running balance is its
 * own amount applied to the opening, the row is a movement and the opening
 * needs printing; if it is not, the row *is* the opening and printing another
 * would show the balance carried forward twice.
 */
function opensItself(ledger: AccountLedger): boolean {
  const first = ledger.rows[0];
  if (!first) return false;

  const opening = Number(ledger.opening.bdt);
  const movement =
    first.direction === "in"
      ? Number(first.amount.bdt)
      : -Number(first.amount.bdt);
  const implied = Number(first.balance.bdt) - movement;

  return Math.abs(implied - opening) > 0.005;
}

/**
 * Is the second account a card?
 *
 * Page five is headed "The card & notes." in the document this replaces,
 * because the second account there is a prepaid card. It usually is — but a
 * petty-cash account under that heading would be a lie on a signed statement,
 * so the heading asks the account rather than assuming.
 */
function isCard(ledger: AccountLedger): boolean {
  return /card/i.test(`${ledger.name} ${ledger.subtitle ?? ""}`);
}

/** "Monthly", "Quarterly" — the word the eyebrow wants. */
function describeGranularity(granularity: string): string {
  const words: Record<string, string> = {
    month: "Monthly",
    quarter: "Quarterly",
    half: "Half-yearly",
    year: "Annual",
  };
  return words[granularity] ?? "Periodic";
}

/**
 * The day before the period opened — what the opening balance is a position
 * *at*, rather than a date the period itself contains.
 */
function previousDay(isoDate: string): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  const day = date.getUTCDate();
  const month = date.toLocaleString("en-GB", {
    month: "long",
    timeZone: "UTC",
  });
  return `${day} ${month} ${date.getUTCFullYear()}`;
}

/**
 * "the bank account" · "both accounts" · "all three accounts".
 *
 * The lede said "both accounts" whenever there was more than one, so a
 * three-account statement announced two and then printed three.
 */
function describeAccountCount(count: number): string {
  if (count <= 1) return "the bank account";
  if (count === 2) return "both accounts";
  const words = ["", "", "two", "three", "four", "five", "six", "seven"];
  return `all ${words[count] ?? String(count)} accounts`;
}
