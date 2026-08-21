import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  hasPermission,
  isoDateSchema,
  UPLOAD_HARD_LIMIT_BYTES,
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
import { FilesService } from "../files/files.service";
import { OverviewService } from "./overview.service";
import { ReportsService } from "./reports.service";
import { StatementService } from "./statement.service";

const periodsQuerySchema = z.strictObject({
  granularity: granularitySchema.default("month"),
});

/**
 * Which period a signature was signed for.
 *
 * The dates rather than a granularity and an index, because that is how a
 * statement row is keyed — July 2026 is the same row whether it was opened
 * from the month picker or by drilling into a quarter, and an index means
 * something different depending on which of those you came from.
 */
const statementSignatureQuerySchema = z.strictObject({
  periodStart: isoDateSchema,
  periodEnd: isoDateSchema,
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
    private readonly files: FilesService,
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

  /**
   * One signatory's own hand, for the closing page.
   *
   * It lives here rather than under `/files` for two reasons. The owner it
   * hangs on is a statement row that may not exist yet — a period has no row
   * until somebody edits it — so the upload creates one rather than asking
   * whoever is signing to press Save first for a record they cannot see. And
   * the kind is fixed rather than taken from the request: this route attaches
   * signatures, and a caller naming some other kind is a caller that has
   * misunderstood it.
   *
   * The same pair as `PATCH /reports/statement`, which is the point of a
   * statement-owned file: whoever may say a period is reconciled may say who
   * signed it off.
   *
   * The shape and size rules are not repeated here. `FilesService.upload`
   * measures the bytes and calls the shared `checkSignatureImage`, so the
   * refusal a person reads is the same sentence the Settings screen shows.
   */
  @Post("statement/signature")
  @RequirePermission("reports.view", "transactions.write")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: UPLOAD_HARD_LIMIT_BYTES } }),
  )
  async uploadStatementSignature(
    @ZodQuery(statementSignatureQuerySchema)
    query: { periodStart: string; periodEnd: string },
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException("Choose a file to upload");

    const row = await this.statements.ensureRow(
      query.periodStart,
      query.periodEnd,
    );

    return this.files.upload(
      "statement",
      row.id,
      { kind: "statement_signature" },
      file,
      actor,
    );
  }
}
