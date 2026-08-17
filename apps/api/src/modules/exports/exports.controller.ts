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
  BILLING_CYCLE_HABIT_LABELS,
  EDUCATION_LEVEL_LABELS,
  EMPLOYMENT_STATUS_LABELS,
  ENGAGEMENT_LABELS,
  FILING_STATUS_LABELS,
  GENDER_LABELS,
  INCOME_TAX_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYROLL_STATUS_LABELS,
  PSR_STATUS_LABELS,
  TDS_DEPOSIT_TYPE_LABELS,
  TXN_ORIGIN_LABELS,
  VENDOR_TYPE_LABELS,
  bankStatsQuerySchema,
  exportSubscriptionsQuerySchema,
  fiscalYearQuerySchema,
  formatMoney,
  fundingQuerySchema,
  hasPermission,
  listDepositsQuerySchema,
  listIncomeTaxQuerySchema,
  listTeamQuerySchema,
  listTransactionsQuerySchema,
  overviewQuerySchema,
  periodQuerySchema,
  registerQuerySchema,
  statementQuerySchema,
  tdsLiabilityQuerySchema,
  todayInDhaka,
  type BankStatsQuery,
  type CurrencyView,
  type ExportSubscriptionsQuery,
  type FiscalYearQuery,
  type FundingQuery,
  type ListDepositsQuery,
  type ListIncomeTaxQuery,
  type ListTeamQuery,
  type ListTransactionsQuery,
  type OverviewQuery,
  type PeriodQuery,
  type RegisterQuery,
  type StatementQuery,
  type TdsLiabilityQuery,
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
import { PayrollService } from "../payroll/payroll.service";
import { OverviewService } from "../reports/overview.service";
import { ReportsService } from "../reports/reports.service";
import { StatementService } from "../reports/statement.service";
import { SettingsService } from "../settings/settings.service";
import { TdsService } from "../tds/tds.service";
import { TeamMembersService } from "../team-members/team-members.service";
import { VendorsService } from "../vendors/vendors.service";
import { ExcelService } from "./excel.service";
import { buildOverviewReport } from "./overview-report";
import { PdfService } from "./pdf.service";
import { buildStatementReport } from "./statement-report";

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
 *
 * Nothing here builds a row shape out of raw table rows. Every sheet is fed the
 * DTO the matching list endpoint already projects, so a column can only reach a
 * download if the screen was allowed to show it — which is why HR's team export
 * cannot grow a salary column by someone adding one field here.
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
    private readonly payroll: PayrollService,
    private readonly team: TeamMembersService,
    private readonly reports: ReportsService,
    private readonly statement: StatementService,
    private readonly vendors: VendorsService,
  ) {}

  /**
   * The financial statement — the six-page document this company was producing
   * by hand every month.
   *
   * The other PDF export is a report: the figures, laid out to be read. This is
   * a *statement*: a position, reconciled to a closing balance, with notes and
   * a signature block, and it is the file that gets sent outside the company.
   * It is deliberately not assembled here — `StatementService` is the same one
   * the statement screen calls, so what somebody signs off on screen and what
   * lands in the PDF cannot be two different calculations.
   *
   * `dashboard.money` on top of `reports.view` because this is the cash
   * position itself, in both currencies, down to the last line of the ledger.
   */
  @Get("statement.pdf")
  @RequirePermission("exports.run", "reports.view", "dashboard.money")
  async statementPdf(
    @ZodQuery(statementQuerySchema) query: StatementQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    const [statement, settings] = await Promise.all([
      this.statement.build(query),
      this.settings.get(),
    ]);

    const buffer = await this.pdf.buildPages(
      buildStatementReport(statement, {
        numberFormat: settings.numberFormat,
        generatedOn: todayInDhaka(),
      }),
    );

    // The signed position leaving the building is the export most worth having
    // a row for — this is the document an auditor will be handed.
    await this.audit.log({
      action: "export",
      entityTable: "transactions",
      summary:
        `Exported the ${statement.period.label} financial statement to PDF ` +
        `(${statement.status}, ${statement.lineItems} line items)`,
      module: "exports",
      isSensitive: true,
    });

    return sendPdf(
      response,
      buffer,
      `statement-${statement.period.start}-to-${statement.period.end}.pdf`,
    );
  }

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
    assertMaySeeUsd(query.currency, actor);

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
        /**
         * The balance first, because it is the column somebody opens this
         * sheet for. Opening stays beside it — the figure the books were
         * started at is what makes the balance checkable rather than merely
         * stated.
         */
        {
          header: "Balance",
          key: "balance",
          kind: "money",
          value: (r) => r.balance,
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

    await this.audit.log({
      action: "export",
      entityTable: "accounts",
      summary: `Exported ${rows.length} accounts to Excel`,
      module: "exports",
    });

    return send(
      response,
      buffer,
      ExcelService.filename("accounts", todayInDhaka()),
    );
  }

  /**
   * The AI tools and subscriptions, for one month.
   *
   * Two services, joined here by id, because the screen is two things: the
   * master list of tools (searchable, and including the ones switched off) and
   * what the ledger says was actually paid for each of them in the month being
   * looked at. Neither service is asked to grow a copy of the other's job.
   *
   * `includeInactive` defaults to true on the screen — a tool cancelled in June
   * still cost money in June, and a file that quietly omits it understates the
   * month. So the export follows the screen rather than the usual default.
   */
  @Get("subscriptions")
  @RequirePermission("exports.run", "vendors.read")
  async subscriptionsSheet(
    @ZodQuery(exportSubscriptionsQuerySchema) query: ExportSubscriptionsQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    const [page, summary] = await Promise.all([
      this.vendors.list({
        q: query.q,
        includeInactive: query.includeInactive,
        page: 1,
        pageSize: ExcelService.MAX_ROWS,
      }),
      this.vendors.subscriptions({ year: query.year, month: query.month }),
    ]);

    const byId = new Map(summary.lines.map((line) => [line.id, line]));

    // Flattened once, here, rather than looked up inside each column's `value`:
    // a Map lookup repeated across eleven columns is eleven chances for one of
    // them to be given the wrong key.
    const rows = page.items.map((vendor) => ({
      vendor,
      line: byId.get(vendor.id),
    }));

    type Row = (typeof rows)[number];

    const buffer = await this.excel.build<Row>({
      title: `AI tools and subscriptions — ${summary.period.label}`,
      subtitle: [
        query.q ? `Search: "${query.q}"` : "Every tool and payee",
        `Paid in ${summary.period.label}: ${formatMoney(summary.paidThisPeriod)}` +
          (Number(summary.unattributed) > 0
            ? ` · incl. ${formatMoney(summary.unattributed)} not tied to a named tool`
            : ""),
        `${page.total} rows · exported ${todayInDhaka()}`,
      ],
      columns: [
        {
          header: "Name",
          key: "name",
          kind: "text",
          width: 26,
          value: (r) => r.vendor.name,
        },
        {
          header: "Type",
          key: "type",
          kind: "text",
          width: 18,
          value: (r) => VENDOR_TYPE_LABELS[r.vendor.type] ?? r.vendor.type,
        },
        {
          header: "Usually",
          key: "cycle",
          kind: "text",
          width: 16,
          // The column is plain text on the row rather than a narrowed enum, so
          // a cycle stored before the fixed list still exports as itself.
          value: (r) =>
            BILLING_CYCLE_HABIT_LABELS[
              r.vendor.billingCycle as keyof typeof BILLING_CYCLE_HABIT_LABELS
            ] ?? r.vendor.billingCycle,
        },
        /**
         * The list price and its currency in two cells, not one string.
         *
         * "$20.00" in a text cell cannot be added up or sorted, and this is the
         * column somebody opens the file to add up. The currency beside it is
         * what stops a taka-billed tool being read as dollars.
         */
        {
          header: "Usual cost",
          key: "usual",
          kind: "money",
          value: (r) => r.vendor.billingAmount,
        },
        {
          header: "Usual cost currency",
          key: "usualCcy",
          kind: "text",
          width: 12,
          value: (r) => r.vendor.billingCurrency,
        },
        {
          // Named for the month it covers, so a saved file still says which
          // month it is six months from now.
          header: `Paid in ${summary.period.label}`,
          key: "paid",
          kind: "money",
          value: (r) => r.line?.paidThisPeriod ?? null,
        },
        {
          header: "Payments in month",
          key: "entries",
          kind: "number",
          width: 12,
          value: (r) => r.line?.entriesThisPeriod ?? null,
        },
        {
          header: "Last paid",
          key: "lastPaid",
          kind: "date",
          value: (r) => r.line?.lastPaidOn ?? null,
        },
        {
          header: "e-TIN",
          key: "etin",
          kind: "text",
          value: (r) => r.vendor.etin,
        },
        { header: "BIN", key: "bin", kind: "text", value: (r) => r.vendor.bin },
        {
          header: "Active",
          key: "active",
          kind: "text",
          width: 10,
          value: (r) => (r.vendor.isActive ? "Yes" : "No"),
        },
      ],
      rows,
      // Only the taka column. Summing "Usual cost" would add dollars to taka
      // and print the answer as if it meant something.
      totalColumns: ["paid"],
    });

    await this.audit.log({
      action: "export",
      entityTable: "vendors",
      summary: `Exported ${page.items.length} tools and subscriptions for ${summary.period.label} to Excel`,
      module: "exports",
    });

    return send(
      response,
      buffer,
      ExcelService.filename(
        `subscriptions-${summary.period.start.slice(0, 7)}`,
        todayInDhaka(),
      ),
    );
  }

  /* ------------------------------------------------------------------ */
  /*  People                                                             */
  /* ------------------------------------------------------------------ */

  /**
   * One month's salary sheet.
   *
   * `payroll.read` on top of `exports.run` is the whole point: HR holds the
   * second and not the first, and this file is every person's pay.
   */
  @Get("payroll/:runId")
  @RequirePermission("exports.run", "payroll.read")
  async payrollSheet(
    @Param("runId") runId: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    const id = uuidSchema.parse(runId);
    const { run, lines } = await this.payroll.getRun(id);

    type Row = (typeof lines)[number];

    const buffer = await this.excel.build<Row>({
      title: `Salary sheet — ${run.label}`,
      subtitle: [
        `${lines.length} ${lines.length === 1 ? "person" : "people"} · ${PAYROLL_STATUS_LABELS[run.status]}`,
        `Gross ${formatMoney(run.totalGross)} · tax withheld ${formatMoney(run.totalTds)} · net ${formatMoney(run.totalNet)}`,
        `Exported ${todayInDhaka()}`,
      ],
      columns: [
        {
          header: "Name",
          key: "name",
          kind: "text",
          width: 26,
          value: (r) => r.fullName,
        },
        {
          header: "Designation",
          key: "designation",
          kind: "text",
          value: (r) => r.snapshotDesignation,
        },
        {
          header: "Department",
          key: "department",
          kind: "text",
          value: (r) => r.snapshotDepartment,
        },
        {
          header: "Gross",
          key: "gross",
          kind: "money",
          value: (r) => r.grossAmount,
        },
        {
          header: "Bonus",
          key: "bonus",
          kind: "money",
          value: (r) => r.bonusAmount,
        },
        {
          header: "Other additions",
          key: "additions",
          kind: "money",
          value: (r) => r.otherAdditions,
        },
        {
          header: "Tax withheld",
          key: "tds",
          kind: "money",
          value: (r) => r.tdsAmount,
        },
        {
          header: "Other deductions",
          key: "deductions",
          kind: "money",
          value: (r) => r.otherDeductions,
        },
        {
          header: "Deduction note",
          key: "deductionNote",
          kind: "text",
          value: (r) => r.deductionNote,
        },
        {
          header: "Net",
          key: "net",
          kind: "money",
          value: (r) => r.netAmount,
        },
        {
          header: "Paid",
          key: "paid",
          kind: "text",
          width: 10,
          value: (r) => (r.isPaid ? "Yes" : "No"),
        },
        {
          header: "Paid on",
          key: "paidOn",
          kind: "date",
          value: (r) => r.paidOn,
        },
        {
          header: "Bank",
          key: "bank",
          kind: "text",
          value: (r) => r.snapshotBankName,
        },
        {
          header: "Account number",
          key: "bankAccount",
          kind: "text",
          value: (r) => r.snapshotBankAccount,
        },
        {
          header: "e-TIN",
          key: "etin",
          kind: "text",
          value: (r) => r.snapshotEtin,
        },
        {
          header: "Remarks",
          key: "remarks",
          kind: "text",
          width: 30,
          value: (r) => r.remarks,
        },
      ],
      rows: lines,
      totalColumns: ["gross", "bonus", "additions", "tds", "deductions", "net"],
    });

    await this.audit.log({
      action: "export",
      entityTable: "payroll_runs",
      entityId: run.id,
      summary: `Exported the ${run.label} salary sheet (${lines.length} people) to Excel`,
      module: "exports",
      // A file of salary figures left the building.
      isSensitive: true,
    });

    return send(
      response,
      buffer,
      ExcelService.filename(
        `salary-${run.periodYear}-${String(run.periodMonth).padStart(2, "0")}`,
        todayInDhaka(),
      ),
    );
  }

  /**
   * The team directory.
   *
   * `TeamMemberDto` is the projection the list screen gets. It carries the
   * salary agreed at hire — a deliberate decision, since HR maintains that
   * record — and nothing else about pay: compensation history lives behind
   * `team.compensation.read` and is fetched by a different endpoint. Feeding
   * the sheet that same DTO is what keeps "HR's download cannot contain what
   * anybody is paid now" structural rather than a promise.
   *
   * The columns are the company's own employee sheet — the spreadsheet this
   * app replaces — plus what the app itself keeps: the code, the engagement
   * type, the status, and the bank and withholding details payroll runs on.
   * Downloading the team should hand back the sheet somebody used to maintain
   * by hand, not a subset of it that has to be re-joined against the old file.
   *
   * Joining salary is therefore in it. It is on the sheet, HR already sees it
   * on the profile, and an export that silently drops a column visible on
   * screen is the kind of surprise that sends people back to Excel. It is a
   * frozen fact about the offer, and safe for HR to hold.
   *
   * **Current salary** is beside it now, and it is a different kind of figure.
   * The directory grew a Current salary column so it would stop showing a
   * two-year-old number where people expected today's, and a download that does
   * not match the screen sends somebody back to the spreadsheet. So it is here
   * — and gated, separately, on `team.compensation.read`.
   *
   * The gate is a *column that does not exist*, not a column of blanks. A blank
   * column is a promise that the figure could arrive; an absent one says this
   * file is not about pay. And it comes from `currentCompensation()`, the same
   * method the screen's own column calls, fetched only when the permission is
   * held — so for HR the figures are never even loaded into this process, let
   * alone written to a cell.
   *
   * Age is worked out here rather than read. The sheet has an Age column and
   * the app deliberately does not store one, because a stored age is wrong by
   * the next birthday.
   */
  @Get("team-members")
  @RequirePermission("exports.run", "team.read")
  async teamSheet(
    @ZodQuery(listTeamQuerySchema) query: ListTeamQuery,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const canSeePay = hasPermission(actor.role, "team.compensation.read");

    const [page, compensation] = await Promise.all([
      this.team.list({
        ...query,
        page: 1,
        pageSize: ExcelService.MAX_ROWS,
      }),
      // Not fetched at all without the permission. The alternative — fetch, then
      // decline to render — puts every salary in this request's memory and one
      // careless edit away from a cell.
      canSeePay ? this.team.currentCompensation() : Promise.resolve([]),
    ]);

    const payNow = new Map(
      compensation.map((row) => [row.teamMemberId, row.grossAmount]),
    );

    type Row = (typeof page.items)[number];

    // One "today" for the whole sheet. Reading the clock per row could age two
    // people differently in the same download if it were taken across midnight.
    const today = todayInDhaka();

    const buffer = await this.excel.build<Row>({
      title: "Team",
      subtitle: [
        describeTeamFilter(query),
        `${page.total} people · exported ${today}`,
      ],
      columns: [
        {
          header: "Name",
          key: "name",
          kind: "text",
          width: 26,
          value: (r) => r.fullName,
        },
        {
          header: "Engagement",
          key: "engagement",
          kind: "text",
          width: 14,
          value: (r) => ENGAGEMENT_LABELS[r.engagementType],
        },
        {
          header: "Designation",
          key: "designation",
          kind: "text",
          value: (r) => r.designation,
        },
        {
          header: "Department",
          key: "department",
          kind: "text",
          value: (r) => r.department,
        },
        {
          header: "Joined",
          key: "joined",
          kind: "date",
          value: (r) => r.joinedOn,
        },
        {
          header: "Left",
          key: "ended",
          kind: "date",
          value: (r) => r.endedOn,
        },
        {
          header: "Status",
          key: "status",
          kind: "text",
          width: 14,
          value: (r) => EMPLOYMENT_STATUS_LABELS[r.status],
        },
        {
          header: "Joining salary",
          key: "joiningSalary",
          kind: "money",
          value: (r) => r.joiningSalary,
        },
        /**
         * The column is spread in or it is not there.
         *
         * Written this way rather than as a `value` that returns null for HR,
         * because the two are not the same file: an empty column headed
         * "Current salary" invites the reader to ask why it is empty and who
         * could fill it in, and it is one edit away from being filled.
         */
        ...(canSeePay
          ? [
              {
                header: "Current salary",
                key: "currentSalary",
                kind: "money" as const,
                // Blank rather than zero for somebody with nothing on record.
                // A zero in a salary column is a statement, and the wrong one.
                value: (r: Row) => payNow.get(r.id) ?? null,
              },
            ]
          : []),
        {
          header: "Work email",
          key: "workEmail",
          kind: "text",
          width: 26,
          value: (r) => r.workEmail,
        },
        {
          header: "Personal email",
          key: "personalEmail",
          kind: "text",
          width: 26,
          value: (r) => r.personalEmail,
        },
        {
          header: "Phone",
          key: "phone",
          kind: "text",
          width: 16,
          value: (r) => r.phone,
        },
        { header: "NID", key: "nid", kind: "text", value: (r) => r.nid },
        { header: "e-TIN", key: "etin", kind: "text", value: (r) => r.etin },
        {
          header: "Return filed",
          key: "psr",
          kind: "text",
          value: (r) => PSR_STATUS_LABELS[r.psrStatus],
        },
        {
          header: "Assessment year",
          key: "psrYear",
          kind: "text",
          value: (r) => r.psrAssessmentYear,
        },
        { header: "Bank", key: "bank", kind: "text", value: (r) => r.bankName },
        {
          header: "Account number",
          key: "bankAccount",
          kind: "text",
          value: (r) => r.bankAccountNumber,
        },
        {
          header: "Routing",
          key: "routing",
          kind: "text",
          value: (r) => r.bankRouting,
        },
        {
          header: "Wallet",
          key: "wallet",
          kind: "text",
          value: (r) => r.walletProvider,
        },
        {
          header: "Wallet number",
          key: "walletNumber",
          kind: "text",
          value: (r) => r.walletNumber,
        },
        {
          header: "Address",
          key: "address",
          kind: "text",
          width: 34,
          value: (r) => r.address,
        },
        {
          header: "Permanent address",
          key: "permanentAddress",
          kind: "text",
          width: 34,
          value: (r) => r.permanentAddress,
        },
        {
          header: "Date of birth",
          key: "dateOfBirth",
          kind: "date",
          value: (r) => r.dateOfBirth,
        },
        {
          header: "Age",
          key: "age",
          kind: "number",
          width: 8,
          value: (r) => ageInYears(r.dateOfBirth, today),
        },
        {
          header: "Gender",
          key: "gender",
          kind: "text",
          width: 14,
          // The column is free text on the row, so a value that predates the
          // fixed list still exports as itself rather than as a blank.
          value: (r) =>
            r.gender
              ? (GENDER_LABELS[r.gender as keyof typeof GENDER_LABELS] ??
                r.gender)
              : null,
        },
        {
          header: "Blood group",
          key: "bloodGroup",
          kind: "text",
          width: 12,
          value: (r) => r.bloodGroup,
        },
        {
          header: "Education level",
          key: "educationLevel",
          kind: "text",
          value: (r) =>
            r.educationLevel
              ? (EDUCATION_LEVEL_LABELS[
                  r.educationLevel as keyof typeof EDUCATION_LEVEL_LABELS
                ] ?? r.educationLevel)
              : null,
        },
        {
          header: "Education major",
          key: "educationMajor",
          kind: "text",
          value: (r) => r.educationMajor,
        },
        {
          header: "CV",
          key: "cvUrl",
          kind: "text",
          width: 34,
          value: (r) => r.cvUrl,
        },
        {
          header: "Appointment letter",
          key: "appointmentLetterUrl",
          kind: "text",
          width: 34,
          value: (r) => r.appointmentLetterUrl,
        },
        {
          header: "Photo",
          key: "photoUrl",
          kind: "text",
          width: 34,
          value: (r) => r.photoUrl,
        },
        {
          header: "Notes",
          key: "notes",
          kind: "text",
          width: 40,
          value: (r) => r.notes,
        },
      ],
      rows: page.items,
    });

    await this.audit.log({
      action: "export",
      entityTable: "team_members",
      summary:
        `Exported ${page.items.length} team members to Excel` +
        (canSeePay ? ", including what each is paid now" : ""),
      module: "exports",
      // A file of current salaries left the building, so the row is marked as
      // one — and only when it actually did. Marking the HR download sensitive
      // too would bury the ones that matter among the ones that do not.
      isSensitive: canSeePay,
    });

    return send(
      response,
      buffer,
      ExcelService.filename("team", todayInDhaka()),
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Tax                                                                */
  /* ------------------------------------------------------------------ */

  /** The month-by-month withholding position. */
  @Get("tds/liability")
  @RequirePermission("exports.run", "tds.read")
  async tdsLiabilitySheet(
    @ZodQuery(tdsLiabilityQuerySchema) query: TdsLiabilityQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    const liability = await this.tds.liability(query);

    type Row = (typeof liability.months)[number];

    const buffer = await this.excel.build<Row>({
      title: `Withholding tax ${liability.year}`,
      subtitle: [
        query.month ? `Month ${query.month} only` : "Every month with activity",
        `Deducted ${formatMoney(liability.totals.deducted)} · deposited ${formatMoney(liability.totals.deposited)} · still held ${formatMoney(liability.totals.outstanding)}`,
        `Exported ${todayInDhaka()}`,
      ],
      columns: [
        {
          header: "Month",
          key: "month",
          kind: "text",
          width: 18,
          value: (r) => r.label,
        },
        {
          header: "Salary tax",
          key: "salary",
          kind: "money",
          value: (r) => r.salaryTds,
        },
        {
          header: "Vendor tax",
          key: "vendor",
          kind: "money",
          value: (r) => r.vendorTds,
        },
        {
          header: "Deducted",
          key: "deducted",
          kind: "money",
          value: (r) => r.totalDeducted,
        },
        {
          header: "Deposited",
          key: "deposited",
          kind: "money",
          value: (r) => r.deposited,
        },
        {
          header: "Still held",
          key: "outstanding",
          kind: "money",
          value: (r) => r.outstanding,
        },
        {
          // "Still held" is clamped at zero, so on its own the sheet cannot
          // show a month where the challan was larger than the deductions.
          // The download is meant to be what the screen shows, and the screen
          // says it.
          header: "Over-deposited",
          key: "overDeposited",
          kind: "money",
          value: (r) => r.overDeposited,
        },
        {
          header: "Deposit by",
          key: "dueOn",
          kind: "date",
          value: (r) => r.dueOn,
        },
        {
          header: "Deadline",
          key: "deadline",
          kind: "text",
          width: 30,
          value: (r) => r.deadlineLabel,
        },
      ],
      rows: liability.months,
      totalColumns: [
        "salary",
        "vendor",
        "deducted",
        "deposited",
        "outstanding",
        "overDeposited",
      ],
    });

    await this.audit.log({
      action: "export",
      entityTable: "tds_deposits",
      summary: `Exported the ${liability.year} withholding position (${liability.months.length} months) to Excel`,
      module: "exports",
    });

    return send(
      response,
      buffer,
      ExcelService.filename(`tds-${liability.year}`, todayInDhaka()),
    );
  }

  /** Every A-Challan, with what it covers. */
  @Get("tds/deposits")
  @RequirePermission("exports.run", "tds.read")
  async tdsDepositsSheet(
    @ZodQuery(listDepositsQuerySchema) query: ListDepositsQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    const deposits = await this.tds.listDeposits(query.year);

    type Row = (typeof deposits.items)[number];

    const buffer = await this.excel.build<Row>({
      title: "TDS challans",
      subtitle: [
        query.year ? `Deposits for ${query.year}` : "All deposits",
        `${deposits.items.length} challans · ${formatMoney(deposits.total)} · exported ${todayInDhaka()}`,
      ],
      columns: [
        {
          header: "Challan",
          key: "challan",
          kind: "text",
          width: 20,
          value: (r) => r.challanNumber,
        },
        {
          header: "Challan date",
          key: "challanDate",
          kind: "date",
          value: (r) => r.challanDate,
        },
        {
          header: "Deposited on",
          key: "depositDate",
          kind: "date",
          value: (r) => r.depositDate,
        },
        {
          header: "Covers",
          key: "covers",
          kind: "text",
          width: 18,
          value: (r) => r.periodLabel,
        },
        {
          header: "Type",
          key: "type",
          kind: "text",
          value: (r) => TDS_DEPOSIT_TYPE_LABELS[r.depositType],
        },
        { header: "Bank", key: "bank", kind: "text", value: (r) => r.bankName },
        {
          header: "Branch",
          key: "branch",
          kind: "text",
          value: (r) => r.branch,
        },
        {
          header: "Amount",
          key: "amount",
          kind: "money",
          value: (r) => r.amount,
        },
        {
          header: "Deductions covered",
          key: "allocated",
          kind: "number",
          value: (r) => r.allocatedCount,
        },
        {
          header: "Notes",
          key: "notes",
          kind: "text",
          width: 30,
          value: (r) => r.notes,
        },
      ],
      rows: deposits.items,
      totalColumns: ["amount"],
    });

    await this.audit.log({
      action: "export",
      entityTable: "tds_deposits",
      summary: `Exported ${deposits.items.length} TDS challans to Excel`,
      module: "exports",
    });

    return send(
      response,
      buffer,
      ExcelService.filename("tds-challans", todayInDhaka()),
    );
  }

  /** The four quarterly withholding returns. */
  @Get("tds/returns")
  @RequirePermission("exports.run", "tds.read")
  async tdsReturnsSheet(
    @ZodQuery(fiscalYearQuerySchema) query: FiscalYearQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    const returns = await this.tds.listReturns(query.fiscalYear);

    type Row = (typeof returns)[number];

    const buffer = await this.excel.build<Row>({
      title: `Withholding returns FY ${query.fiscalYear}`,
      subtitle: [
        "Due on the 25th of the month after each quarter",
        `Exported ${todayInDhaka()}`,
      ],
      columns: [
        {
          header: "Quarter",
          key: "quarter",
          kind: "text",
          width: 10,
          value: (r) => `Q${r.quarter}`,
        },
        {
          header: "Covers",
          key: "covers",
          kind: "text",
          width: 24,
          value: (r) => r.periodLabel,
        },
        {
          header: "From",
          key: "from",
          kind: "date",
          value: (r) => r.periodStart,
        },
        { header: "To", key: "to", kind: "date", value: (r) => r.periodEnd },
        { header: "Due", key: "due", kind: "date", value: (r) => r.dueDate },
        {
          header: "Status",
          key: "status",
          kind: "text",
          width: 14,
          value: (r) =>
            r.isOverdue && r.status === "pending"
              ? "Overdue"
              : FILING_STATUS_LABELS[r.status],
        },
        {
          header: "Filed on",
          key: "filedOn",
          kind: "date",
          value: (r) => r.filedOn,
        },
        {
          header: "Acknowledgement",
          key: "ack",
          kind: "text",
          value: (r) => r.acknowledgementNo,
        },
        {
          header: "Notes",
          key: "notes",
          kind: "text",
          width: 30,
          value: (r) => r.notes,
        },
      ],
      rows: returns,
    });

    await this.audit.log({
      action: "export",
      entityTable: "withholding_returns",
      summary: `Exported the FY ${query.fiscalYear} withholding returns to Excel`,
      module: "exports",
    });

    return send(
      response,
      buffer,
      ExcelService.filename(
        `withholding-returns-${query.fiscalYear}`,
        todayInDhaka(),
      ),
    );
  }

  /** The company's own tax: advance instalments and the annual return. */
  @Get("income-tax")
  @RequirePermission("exports.run", "incometax.read")
  async incomeTaxSheet(
    @ZodQuery(listIncomeTaxQuerySchema) query: ListIncomeTaxQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    const data = await this.incomeTax.list(query.assessmentYear);

    type Row = (typeof data.items)[number];

    const buffer = await this.excel.build<Row>({
      title: "Company income tax",
      subtitle: [
        query.assessmentYear
          ? `Assessment year ${query.assessmentYear}`
          : "Every assessment year on record",
        `Assessed ${formatMoney(data.totals.payable)} · paid ${formatMoney(data.totals.paid)} · still to pay ${formatMoney(data.totals.outstanding)}`,
        `Exported ${todayInDhaka()}`,
      ],
      columns: [
        {
          header: "Assessment year",
          key: "year",
          kind: "text",
          width: 16,
          value: (r) => r.assessmentYear,
        },
        {
          header: "What",
          key: "what",
          kind: "text",
          width: 26,
          value: (r) => r.label,
        },
        { header: "Due", key: "due", kind: "date", value: (r) => r.dueDate },
        {
          header: "Assessed",
          key: "payable",
          kind: "money",
          value: (r) => r.amountPayable,
        },
        {
          header: "Paid",
          key: "paid",
          kind: "money",
          value: (r) => r.amountPaid,
        },
        {
          header: "Outstanding",
          key: "outstanding",
          kind: "money",
          value: (r) => r.outstanding,
        },
        {
          header: "Paid on",
          key: "paidOn",
          kind: "date",
          value: (r) => r.paidOn,
        },
        {
          header: "Challan",
          key: "challan",
          kind: "text",
          value: (r) => r.challanNumber,
        },
        {
          header: "Challan date",
          key: "challanDate",
          kind: "date",
          value: (r) => r.challanDate,
        },
        {
          header: "Return submitted",
          key: "submitted",
          kind: "date",
          value: (r) => r.returnSubmittedOn,
        },
        {
          header: "Acknowledgement",
          key: "ack",
          kind: "text",
          value: (r) => r.acknowledgementNo,
        },
        {
          header: "Status",
          key: "status",
          kind: "text",
          width: 14,
          value: (r) =>
            r.isOverdue && r.status === "pending"
              ? "Overdue"
              : INCOME_TAX_STATUS_LABELS[r.status],
        },
        {
          header: "Notes",
          key: "notes",
          kind: "text",
          width: 30,
          value: (r) => r.notes,
        },
      ],
      rows: data.items,
      totalColumns: ["payable", "paid", "outstanding"],
    });

    await this.audit.log({
      action: "export",
      entityTable: "income_tax_records",
      summary: `Exported ${data.items.length} income tax records to Excel`,
      module: "exports",
    });

    return send(
      response,
      buffer,
      ExcelService.filename("income-tax", todayInDhaka()),
    );
  }

  /* ------------------------------------------------------------------ */
  /*  Reports — one endpoint per tab                                     */
  /* ------------------------------------------------------------------ */

  @Get("reports/period")
  @RequirePermission("exports.run", "reports.view")
  async periodSheet(
    @ZodQuery(periodQuerySchema) query: PeriodQuery,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertMaySeeUsd(query.currency, actor);
    const report = await this.reports.period(query);

    // In and out in one sheet, each side keeping its own column so the totals
    // stay the two figures the screen shows rather than one meaningless sum.
    const rows = [
      ...report.incomeByCategory.map((line) => ({
        ...line,
        direction: "In" as const,
      })),
      ...report.spendByCategory.map((line) => ({
        ...line,
        direction: "Out" as const,
      })),
    ];

    type Row = (typeof rows)[number];

    const buffer = await this.excel.build<Row>({
      title: `Report — ${report.label}`,
      subtitle: [
        `${report.start} to ${report.end} · in ${formatMoney(report.moneyIn)} · out ${formatMoney(report.moneyOut)} · net ${formatMoney(report.net)}`,
        `Opening ${formatMoney(report.openingBalance)} · closing ${formatMoney(report.closingBalance)} · ${report.entries} entries`,
        report.fx
          ? `Figures in ${report.currency}, ${report.fx.caption}`
          : `Figures in ${report.currency}`,
      ],
      columns: [
        {
          header: "Direction",
          key: "direction",
          kind: "text",
          width: 12,
          value: (r) => r.direction,
        },
        {
          header: "Category",
          key: "category",
          kind: "text",
          width: 30,
          value: (r) => r.name,
        },
        {
          header: "In",
          key: "in",
          kind: "money",
          value: (r) => (r.direction === "In" ? r.total : null),
        },
        {
          header: "Out",
          key: "out",
          kind: "money",
          value: (r) => (r.direction === "Out" ? r.total : null),
        },
        {
          header: "Share of side %",
          key: "share",
          kind: "number",
          value: (r) => Number(r.share.toFixed(1)),
        },
      ],
      rows,
      totalColumns: ["in", "out"],
    });

    await this.audit.log({
      action: "export",
      entityTable: "transactions",
      summary: `Exported the ${report.label} report to Excel`,
      module: "exports",
    });

    return send(
      response,
      buffer,
      ExcelService.filename(
        `report-${report.start}-to-${report.end}`,
        todayInDhaka(),
      ),
    );
  }

  @Get("reports/bank-stats")
  @RequirePermission("exports.run", "reports.view")
  async bankStatsSheet(
    @ZodQuery(bankStatsQuerySchema) query: BankStatsQuery,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    assertMaySeeUsd(query.currency, actor);
    const stats = await this.reports.bankStats(query);

    // The same months the screen lists: one with no entries is a row of zeroes
    // that says nothing.
    const months = stats.months.filter((month) => month.entries > 0);

    type Row = (typeof months)[number];

    const buffer = await this.excel.build<Row>({
      title: `Month by month — ${stats.year}`,
      subtitle: [
        `${stats.accountName} · in ${formatMoney(stats.totals.moneyIn)} · out ${formatMoney(stats.totals.moneyOut)} · net ${formatMoney(stats.totals.net)}`,
        stats.busiest
          ? `Busiest month: ${stats.busiest.label}, ${stats.busiest.entries} entries`
          : "Nothing recorded this year",
        stats.fx
          ? `Figures in ${stats.currency}, ${stats.fx.caption}`
          : `Figures in ${stats.currency}`,
      ],
      columns: [
        {
          header: "Month",
          key: "month",
          kind: "text",
          width: 18,
          value: (r) => r.label,
        },
        { header: "In", key: "in", kind: "money", value: (r) => r.moneyIn },
        {
          header: "vs before %",
          key: "inChange",
          kind: "number",
          value: (r) =>
            r.inChange === null ? null : Number(r.inChange.toFixed(1)),
        },
        { header: "Out", key: "out", kind: "money", value: (r) => r.moneyOut },
        {
          header: "vs before %",
          key: "outChange",
          kind: "number",
          value: (r) =>
            r.outChange === null ? null : Number(r.outChange.toFixed(1)),
        },
        { header: "Net", key: "net", kind: "money", value: (r) => r.net },
        {
          header: "Balance after",
          key: "balance",
          kind: "money",
          value: (r) => r.closingBalance,
        },
        {
          header: "Entries",
          key: "entries",
          kind: "number",
          value: (r) => r.entries,
        },
      ],
      rows: months,
      totalColumns: ["in", "out", "net"],
    });

    await this.audit.log({
      action: "export",
      entityTable: "transactions",
      summary: `Exported the ${stats.year} month-by-month report for ${stats.accountName} to Excel`,
      module: "exports",
    });

    return send(
      response,
      buffer,
      ExcelService.filename(`bank-stats-${stats.year}`, todayInDhaka()),
    );
  }

  @Get("reports/funding")
  @RequirePermission("exports.run", "reports.view")
  async fundingSheet(
    @ZodQuery(fundingQuerySchema) query: FundingQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    const report = await this.reports.funding(query);

    type Row = (typeof report.remittances)[number];

    const buffer = await this.excel.build<Row>({
      title: "Funding from the CEO",
      subtitle: [
        query.from || query.to
          ? `Period: ${query.from ?? "start"} to ${query.to ?? "today"}`
          : "Every remittance",
        `$${report.totals.usdSent} sent · ${formatMoney(report.totals.bdtReceived)} landed · average rate ${report.totals.averageRate}`,
        "Rates are what each transfer actually achieved, not a translation",
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
          header: "Into",
          key: "account",
          kind: "text",
          value: (r) => r.accountName,
        },
        {
          header: "Sent (USD)",
          key: "usd",
          kind: "money",
          value: (r) => r.usdSent,
        },
        {
          header: "Landed (BDT)",
          key: "bdt",
          kind: "money",
          value: (r) => r.bdtReceived,
        },
        {
          header: "Rate achieved",
          key: "realised",
          kind: "number",
          value: (r) => r.realisedRate,
        },
        {
          header: "Market that day",
          key: "market",
          kind: "number",
          value: (r) => r.marketRate,
        },
        {
          header: "Cost (BDT)",
          key: "spread",
          kind: "money",
          value: (r) => r.spread,
        },
      ],
      rows: report.remittances,
      totalColumns: ["usd", "bdt", "spread"],
    });

    await this.audit.log({
      action: "export",
      entityTable: "transactions",
      summary: `Exported ${report.remittances.length} remittances to Excel`,
      module: "exports",
    });

    return send(
      response,
      buffer,
      ExcelService.filename("funding", todayInDhaka()),
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

/**
 * `reports.usd` is a permission of its own, not a shade of `reports.view`.
 *
 * A dollar figure in a report is a translation of taka, and a saved file
 * outlives the screen that explains that — so who may produce one is decided
 * here rather than by whatever `currency` the URL happened to carry.
 */
function assertMaySeeUsd(currency: CurrencyView, actor: AuthenticatedUser) {
  if (currency !== "USD") return;
  if (hasPermission(actor.role, "reports.usd")) return;
  throw new ForbiddenException("Your role cannot do this (needs reports.usd)");
}

/** The filter, in words, at the top of the sheet — so a saved file explains itself. */
/**
 * Whole years between two ISO dates, or null.
 *
 * Compared as `YYYY-MM-DD` strings rather than parsed into `Date`. A date-only
 * string parsed as local time and serialised as UTC lands a day early in
 * Dhaka, which is exactly the bug the date cells above take care to avoid, and
 * on the wrong day of the year it would put somebody's age out by one.
 *
 * Null for an unusable pair, so a typo of `1097` for `1997` exports an empty
 * cell rather than a 929-year-old employee.
 */
function ageInYears(dateOfBirth: string | null, today: string): number | null {
  if (!dateOfBirth) return null;

  const [birthYear, birthMonth, birthDay] = dateOfBirth.split("-").map(Number);
  const [nowYear, nowMonth, nowDay] = today.split("-").map(Number);
  if (!birthYear || !birthMonth || !birthDay) return null;

  let age = nowYear - birthYear;
  // Their birthday has not come round yet this year.
  if (nowMonth < birthMonth || (nowMonth === birthMonth && nowDay < birthDay)) {
    age -= 1;
  }
  return age >= 0 && age < 130 ? age : null;
}

function describeTeamFilter(query: ListTeamQuery): string {
  const parts: string[] = [];
  if (query.engagementType) {
    parts.push(ENGAGEMENT_LABELS[query.engagementType] + "s only");
  }
  if (query.status) parts.push(EMPLOYMENT_STATUS_LABELS[query.status]);
  if (query.department) parts.push(`Department: ${query.department}`);
  if (query.q) parts.push(`Search: "${query.q}"`);

  return parts.length ? parts.join(" · ") : "Everyone";
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
