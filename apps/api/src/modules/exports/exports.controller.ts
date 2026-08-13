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
  EMPLOYMENT_STATUS_LABELS,
  ENGAGEMENT_LABELS,
  FILING_STATUS_LABELS,
  INCOME_TAX_STATUS_LABELS,
  PAYMENT_METHOD_LABELS,
  PAYROLL_STATUS_LABELS,
  PSR_STATUS_LABELS,
  TDS_DEPOSIT_TYPE_LABELS,
  TXN_ORIGIN_LABELS,
  bankStatsQuerySchema,
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
  tdsLiabilityQuerySchema,
  todayInDhaka,
  type BankStatsQuery,
  type CurrencyView,
  type FiscalYearQuery,
  type FundingQuery,
  type ListDepositsQuery,
  type ListIncomeTaxQuery,
  type ListTeamQuery,
  type ListTransactionsQuery,
  type OverviewQuery,
  type PeriodQuery,
  type RegisterQuery,
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
import { SettingsService } from "../settings/settings.service";
import { TdsService } from "../tds/tds.service";
import { TeamMembersService } from "../team-members/team-members.service";
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
          header: "Code",
          key: "code",
          kind: "text",
          width: 12,
          value: (r) => r.employeeCode,
        },
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
   * `TeamMemberDto` is the projection the list screen gets, and it deliberately
   * contains no money — compensation lives behind `team.compensation.read` and
   * is fetched by a different endpoint. Feeding the sheet that same DTO is what
   * makes "HR's download cannot contain a salary" structural rather than a
   * promise.
   */
  @Get("team-members")
  @RequirePermission("exports.run", "team.read")
  async teamSheet(
    @ZodQuery(listTeamQuerySchema) query: ListTeamQuery,
    @Res({ passthrough: true }) response: Response,
  ) {
    const page = await this.team.list({
      ...query,
      page: 1,
      pageSize: ExcelService.MAX_ROWS,
    });

    type Row = (typeof page.items)[number];

    const buffer = await this.excel.build<Row>({
      title: "Team",
      subtitle: [
        describeTeamFilter(query),
        `${page.total} people · exported ${todayInDhaka()}`,
      ],
      columns: [
        {
          header: "Code",
          key: "code",
          kind: "text",
          width: 12,
          value: (r) => r.employeeCode,
        },
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
      ],
      rows: page.items,
    });

    await this.audit.log({
      action: "export",
      entityTable: "team_members",
      summary: `Exported ${page.items.length} team members to Excel`,
      module: "exports",
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
