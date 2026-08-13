import { Controller, ForbiddenException, Get, Patch } from "@nestjs/common";
import {
  hasPermission,
  bankStatsQuerySchema,
  fundingQuerySchema,
  granularitySchema,
  overviewQuerySchema,
  periodQuerySchema,
  saveStatementSchema,
  statementQuerySchema,
  type BankStatsQuery,
  type CurrencyView,
  type FundingQuery,
  type OverviewQuery,
  type PeriodQuery,
  type SaveStatementInput,
  type StatementQuery,
} from "@finance/shared";
import { z } from "zod";

import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ZodBody, ZodQuery } from "../../common/pipes/zod-validation.pipe";
import { OverviewService } from "./overview.service";
import { ReportsService } from "./reports.service";
import { StatementService } from "./statement.service";

const periodsQuerySchema = z.strictObject({
  granularity: granularitySchema.default("month"),
});

/**
 * `reports.usd` is a permission of its own, not a shade of `reports.view`.
 *
 * A dollar figure here is a translation of taka, and a translation is easy to
 * read as a fact — two months at different rates look like the business moved
 * when only the currency did. Deciding who may see that is a separate decision,
 * so it is a separate grant, and it cannot ride in on a query parameter.
 */
function assertMaySeeUsd(currency: CurrencyView, actor: AuthenticatedUser) {
  if (currency !== "USD") return;
  if (hasPermission(actor.role, "reports.usd")) return;
  throw new ForbiddenException("Your role cannot do this (needs reports.usd)");
}

@Controller("reports")
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly overviewService: OverviewService,
    private readonly statements: StatementService,
  ) {}

  /**
   * The whole overview screen, in one request.
   *
   * Needs `dashboard.money` rather than `reports.view`: this is the figures
   * themselves, and HR holds the second permission but not the first.
   */
  @Get("overview")
  @RequirePermission("dashboard.money")
  overview(
    @ZodQuery(overviewQuerySchema) query: OverviewQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    assertMaySeeUsd(query.currency, actor);
    return this.overviewService.build(query);
  }

  /** Which periods exist, so a picker never offers one the app cannot build. */
  @Get("periods")
  @RequirePermission("reports.view")
  periods(
    @ZodQuery(periodsQuerySchema) query: z.infer<typeof periodsQuerySchema>,
  ) {
    return this.reports.availablePeriods(query.granularity);
  }

  @Get("period")
  @RequirePermission("reports.view")
  period(
    @ZodQuery(periodQuerySchema) query: PeriodQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    assertMaySeeUsd(query.currency, actor);
    return this.reports.period(query);
  }

  @Get("bank-stats")
  @RequirePermission("reports.view")
  bankStats(
    @ZodQuery(bankStatsQuerySchema) query: BankStatsQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    assertMaySeeUsd(query.currency, actor);
    return this.reports.bankStats(query);
  }

  @Get("funding")
  @RequirePermission("reports.view")
  funding(@ZodQuery(fundingQuerySchema) query: FundingQuery) {
    return this.reports.funding(query);
  }

  /**
   * The six-page financial statement for one period.
   *
   * `dashboard.money` on top of `reports.view` because this is the figures
   * themselves, ledger line by ledger line, not a shape on a chart. Both
   * currencies are always present — the statement is read side by side by a
   * CFO in Dhaka and a CFO in the USA — so unlike the other reports there is
   * no currency parameter to police.
   */
  @Get("statement")
  @RequirePermission("reports.view", "dashboard.money")
  statement(@ZodQuery(statementQuerySchema) query: StatementQuery) {
    return this.statements.build(query);
  }

  /**
   * The parts of the statement no ledger can derive: the prose, who signed,
   * whether it is reconciled, and which receipts are spoken for by next month.
   *
   * Gated on `transactions.write` rather than a settings permission — saying
   * a period is reconciled is a claim about the books, and it belongs to
   * whoever is allowed to change them.
   */
  @Patch("statement")
  @RequirePermission("reports.view", "transactions.write")
  saveStatement(
    @ZodBody(saveStatementSchema) body: SaveStatementInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.statements.save(body, actor);
  }
}
