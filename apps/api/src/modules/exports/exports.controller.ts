import {
  Controller,
  ForbiddenException,
  Get,
  Param,
  Res,
  StreamableFile,
} from "@nestjs/common";
import {
  ACCOUNT_TYPE_LABELS,
  PAYMENT_METHOD_LABELS,
  TXN_ORIGIN_LABELS,
  formatMoney,
  hasPermission,
  listTransactionsQuerySchema,
  overviewQuerySchema,
  registerQuerySchema,
  todayInDhaka,
  type ListTransactionsQuery,
  type OverviewQuery,
  type RegisterQuery,
} from "@finance/shared";
import type { Response } from "express";
import { z } from "zod";

import { AuditService } from "../../common/audit/audit.service";
import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ZodQuery } from "../../common/pipes/zod-validation.pipe";
import { AccountsService } from "../accounts/accounts.service";
import {
  TransactionsService,
  type TransactionDto,
} from "../transactions/transactions.service";
import { IncomeTaxService } from "../income-tax/income-tax.service";
import { OverviewService } from "../reports/overview.service";
import { SettingsService } from "../settings/settings.service";
import { TdsService } from "../tds/tds.service";
import { ExcelService } from "./excel.service";
import { buildOverviewReport } from "./overview-report";
import { PdfService } from "./pdf.service";

const uuidSchema = z.string().uuid("Not a valid id");

/**
 * Every export takes the **same query schema as the matching list endpoint**.
 * That is what makes "the download is exactly what is on screen" a structural
 * guarantee rather than something to remember.
 *
 * And every export requires `exports.run` **plus the read permission for the
 * data it contains**. `exports.run` alone says "this role may download things",
 * not "this role may download this". HR holds it so they can export the team
 * directory; without the second permission that same grant handed them the
 * whole ledger, salary payments included.
 */
@Controller("exports")
export class ExportsController {
  constructor(
    private readonly transactions: TransactionsService,
    private readonly accounts: AccountsService,
    private readonly excel: ExcelService,
    private readonly audit: AuditService,
    private readonly pdf: PdfService,
    private readonly overview: OverviewService,
    private readonly settings: SettingsService,
    private readonly tds: TdsService,
    private readonly incomeTax: IncomeTaxService,
  ) {}

  /**
   * The overview, as a document somebody can send to an accountant.
   *
   * Same figures as the screen, from the same service — not a second
   * calculation that agrees with it today and drifts next quarter.
   */
  @Get("overview.pdf")
  @RequirePermission("exports.run", "dashboard.money")
  async overviewPdf(
    @ZodQuery(overviewQuerySchema) query: OverviewQuery,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (query.currency === "USD" && !hasPermission(actor.role, "reports.usd")) {
      throw new ForbiddenException(
        "Your role cannot do this (needs reports.usd)",
      );
    }

    const [report, settings, tds, incomeTax] = await Promise.all([
      this.overview.build(query),
      this.settings.get(),
      hasPermission(actor.role, "tds.read")
        ? this.tds.pending({ withinDays: 45 })
        : Promise.resolve([]),
      hasPermission(actor.role, "incometax.read")
        ? this.incomeTax.pending({ withinDays: 45 })
        : Promise.resolve([]),
    ]);

    const pending = [...tds, ...incomeTax].sort((a, b) =>
      a.dueOn < b.dueOn ? -1 : a.dueOn > b.dueOn ? 1 : 0,
    );

    const buffer = await this.pdf.build(
      buildOverviewReport(report, pending, {
        companyName: settings.companyName,
        numberFormat: settings.numberFormat,
        generatedBy: actor.fullName,
        generatedOn: todayInDhaka(),
      }),
    );

    // An export of the whole position is exactly the event worth having logged.
    await this.audit.log({
      action: "export",
      entityTable: "transactions",
      summary: `Exported the overview for ${report.period.label} to PDF`,
      module: "exports",
    });

    return sendPdf(
      response,
      buffer,
      `overview-${report.period.start}-to-${report.period.end}.pdf`,
    );
  }

  @Get("transactions")
  @RequirePermission("exports.run", "transactions.read")
  async transactionsSheet(
    @ZodQuery(listTransactionsQuerySchema) query: ListTransactionsQuery,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const page = await this.transactions.list({
      ...query,
      page: 1,
      pageSize: ExcelService.MAX_ROWS,
    });

    const buffer = await this.excel.build<TransactionDto>({
      title: "Transactions",
      subtitle: describeFilter(query, page.total),
      columns: transactionColumns(),
      rows: page.items,
      totalColumns: ["moneyIn", "moneyOut"],
    });

    // An export of the whole ledger is exactly the event worth having in the log.
    await this.audit.log({
      action: "export",
      entityTable: "transactions",
      summary: `Exported ${page.items.length} transactions to Excel`,
      module: "exports",
    });

    return send(
      response,
      buffer,
      ExcelService.filename("transactions", todayInDhaka()),
    );
  }

  @Get("register/:accountId")
  @RequirePermission("exports.run", "transactions.read", "accounts.read")
  async registerSheet(
    @Param("accountId") accountId: string,
    @ZodQuery(registerQuerySchema) query: RegisterQuery,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const id = uuidSchema.parse(accountId);
    const register = await this.transactions.register(id, query);

    type Row = (typeof register.rows)[number];

    const buffer = await this.excel.build<Row>({
      title: `Register — ${register.account.name}`,
      subtitle: [
        `${ACCOUNT_TYPE_LABELS[register.account.type] ?? register.account.type}` +
          ` · ${register.account.currency}`,
        query.from || query.to
          ? `Period: ${query.from ?? "start"} to ${query.to ?? "today"}`
          : "All entries",
        `Opening ${formatMoney(register.openingBalance)} · in ${formatMoney(register.totalIn)} · out ${formatMoney(register.totalOut)} · closing ${formatMoney(register.closingBalance)}`,
      ],
      columns: [
        { header: "Date", key: "date", kind: "date", value: (r) => r.txnDate },
        {
          header: "Ref",
          key: "ref",
          kind: "text",
          width: 18,
          value: (r) => r.refNo,
        },
        {
          header: "Description",
          key: "desc",
          kind: "text",
          width: 34,
          value: (r) => r.description,
        },
        {
          header: "Party",
          key: "party",
          kind: "text",
          value: (r) => r.vendorName ?? r.counterparty,
        },
        {
          header: "Category",
          key: "cat",
          kind: "text",
          value: (r) => r.categoryName,
        },
        {
          header: "Method",
          key: "method",
          kind: "text",
          value: (r) =>
            PAYMENT_METHOD_LABELS[r.paymentMethod] ?? r.paymentMethod,
        },
        {
          header: "In",
          key: "moneyIn",
          kind: "money",
          value: (r) => (r.direction === "in" ? r.amount : null),
        },
        {
          header: "Out",
          key: "moneyOut",
          kind: "money",
          value: (r) => (r.direction === "out" ? r.amount : null),
        },
        {
          header: "Balance",
          key: "balance",
          kind: "money",
          value: (r) => r.runningBalance,
        },
      ],
      rows: register.rows,
      totalColumns: ["moneyIn", "moneyOut"],
    });

    await this.audit.log({
      action: "export",
      entityTable: "transactions",
      summary: `Exported the register for ${register.account.name} (${register.rows.length} entries)`,
      module: "exports",
    });

    return send(
      response,
      buffer,
      ExcelService.filename(
        `register-${register.account.name.toLowerCase().replace(/\s+/g, "-")}`,
        todayInDhaka(),
      ),
    );
  }

  @Get("accounts")
  @RequirePermission("exports.run", "accounts.read")
  async accountsSheet(@Res({ passthrough: true }) response: Response) {
    const rows = await this.accounts.list({ includeInactive: true });

    const buffer = await this.excel.build<(typeof rows)[number]>({
      title: "Accounts",
      subtitle: [`${rows.length} accounts`],
      columns: [
        {
          header: "Name",
          key: "name",
          kind: "text",
          width: 26,
          value: (r) => r.name,
        },
        {
          header: "Type",
          key: "type",
          kind: "text",
          value: (r) => ACCOUNT_TYPE_LABELS[r.type] ?? r.type,
        },
        { header: "Bank", key: "bank", kind: "text", value: (r) => r.bankName },
        {
          header: "Account number",
          key: "number",
          kind: "text",
          value: (r) => r.accountNumber,
        },
        {
          header: "Currency",
          key: "ccy",
          kind: "text",
          width: 10,
          value: (r) => r.currency,
        },
        {
          header: "Opening balance",
          key: "opening",
          kind: "money",
          value: (r) => r.openingBalance,
        },
        {
          header: "As at",
          key: "asAt",
          kind: "date",
          value: (r) => r.openingBalanceOn,
        },
        {
          header: "Active",
          key: "active",
          kind: "text",
          width: 10,
          value: (r) => (r.isActive ? "Yes" : "No"),
        },
      ],
      rows,
      totalColumns: ["opening"],
    });

    return send(
      response,
      buffer,
      ExcelService.filename("accounts", todayInDhaka()),
    );
  }
}

/* -------------------------------------------------------------------------- */

function transactionColumns() {
  return [
    {
      header: "Date",
      key: "date",
      kind: "date" as const,
      value: (r: TransactionDto) => r.txnDate,
    },
    {
      header: "Ref",
      key: "ref",
      kind: "text" as const,
      width: 18,
      value: (r: TransactionDto) => r.refNo,
    },
    {
      header: "Description",
      key: "desc",
      kind: "text" as const,
      width: 34,
      value: (r: TransactionDto) => r.description,
    },
    {
      header: "Category",
      key: "cat",
      kind: "text" as const,
      value: (r: TransactionDto) => r.categoryName,
    },
    {
      header: "Party",
      key: "party",
      kind: "text" as const,
      value: (r: TransactionDto) => r.vendorName ?? r.counterparty,
    },
    {
      header: "Account",
      key: "account",
      kind: "text" as const,
      value: (r: TransactionDto) => r.accountName,
    },
    {
      header: "Method",
      key: "method",
      kind: "text" as const,
      value: (r: TransactionDto) =>
        PAYMENT_METHOD_LABELS[
          r.paymentMethod as keyof typeof PAYMENT_METHOD_LABELS
        ] ?? r.paymentMethod,
    },
    {
      header: "Reference",
      key: "reference",
      kind: "text" as const,
      value: (r: TransactionDto) => r.reference,
    },
    {
      header: "In",
      key: "moneyIn",
      kind: "money" as const,
      value: (r: TransactionDto) => (r.direction === "in" ? r.amount : null),
    },
    {
      header: "Out",
      key: "moneyOut",
      kind: "money" as const,
      value: (r: TransactionDto) => (r.direction === "out" ? r.amount : null),
    },
    {
      header: "Bill amount",
      key: "bill",
      kind: "money" as const,
      value: (r: TransactionDto) => r.billAmount,
    },
    {
      header: "Tax withheld",
      key: "withheld",
      kind: "money" as const,
      value: (r: TransactionDto) => r.withheldTaxAmount,
    },
    {
      header: "Sent",
      key: "orig",
      kind: "money" as const,
      value: (r: TransactionDto) => r.originalAmount,
    },
    {
      header: "Currency",
      key: "origCcy",
      kind: "text" as const,
      width: 10,
      value: (r: TransactionDto) => r.originalCurrency,
    },
    {
      header: "Rate",
      key: "rate",
      kind: "number" as const,
      value: (r: TransactionDto) => r.fxRate,
    },
    {
      header: "Receipt",
      key: "receipt",
      kind: "text" as const,
      width: 30,
      value: (r: TransactionDto) => r.receiptUrl,
    },
    {
      header: "Source",
      key: "via",
      kind: "text" as const,
      value: (r: TransactionDto) =>
        TXN_ORIGIN_LABELS[r.createdVia as keyof typeof TXN_ORIGIN_LABELS] ??
        r.createdVia,
    },
    {
      header: "Voided",
      key: "void",
      kind: "text" as const,
      value: (r: TransactionDto) =>
        r.voidedAt ? (r.voidReason ?? "Yes") : null,
    },
  ];
}

/** The filter, in words, at the top of the sheet — so a saved file explains itself. */
function describeFilter(query: ListTransactionsQuery, total: number): string[] {
  const parts: string[] = [];
  if (query.from || query.to) {
    parts.push(`Period: ${query.from ?? "start"} to ${query.to ?? "today"}`);
  }
  if (query.direction) {
    parts.push(query.direction === "in" ? "Money in only" : "Money out only");
  }
  if (query.categorySlug) parts.push(`Category: ${query.categorySlug}`);
  if (query.q) parts.push(`Search: "${query.q}"`);
  if (query.includeVoided) parts.push("Includes voided entries");

  return [
    parts.length ? parts.join(" · ") : "All entries",
    `${total} entries · exported ${todayInDhaka()}`,
  ];
}

function send(response: Response, buffer: Buffer, filename: string) {
  response.set({
    "Content-Type":
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": String(buffer.length),
  });
  return new StreamableFile(buffer);
}

function sendPdf(response: Response, buffer: Buffer, filename: string) {
  response.set({
    "Content-Type": "application/pdf",
    "Content-Disposition": `attachment; filename="${filename}"`,
    "Content-Length": String(buffer.length),
  });
  return new StreamableFile(buffer);
}
