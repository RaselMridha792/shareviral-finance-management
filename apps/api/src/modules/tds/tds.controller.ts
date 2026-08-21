import { Controller, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import {
  allocateDepositSchema,
  calculateTdsSchema,
  createTdsDepositSchema,
  fileReturnSchema,
  fiscalYearQuerySchema,
  saveTdsPolicySchema,
  listDepositsQuerySchema,
  pendingQuerySchema,
  salaryTdsRegisterQuerySchema,
  setLineChallanSchema,
  tdsLiabilityQuerySchema,
  type AllocateDepositInput,
  type CalculateTdsInput,
  type CreateTdsDepositInput,
  updateTdsDepositSchema,
  type UpdateTdsDepositInput,
  type FileReturnInput,
  type FiscalYearQuery,
  type ListDepositsQuery,
  type PendingQuery,
  type SalaryTdsRegisterQuery,
  type SaveTdsPolicyInput,
  type SetLineChallanInput,
  type TdsLiabilityQuery,
} from "@finance/shared";
import { z } from "zod";

import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ZodBody, ZodQuery } from "../../common/pipes/zod-validation.pipe";
import { TaxPolicyService } from "./tax-policy.service";
import { TdsService } from "./tds.service";

const uuidSchema = z.string().uuid("Not a valid id");

/**
 * A quarter that has no row yet is listed with an `unsaved:2026:1` id, because
 * listing must not write. Filing accepts either that or a real uuid.
 */
const returnIdSchema = z.union([
  uuidSchema,
  z.string().regex(/^unsaved:\d{4}:[1-4]$/, "Not a valid id"),
]);

const yearSchema = z.coerce.number().int().min(2000).max(2200);

const unallocatedQuerySchema = z.strictObject({
  year: z.coerce.number().int().min(2000).max(2200),
  month: z.coerce.number().int().min(1).max(12),
});

@Controller("tds")
export class TdsController {
  constructor(
    private readonly tds: TdsService,
    private readonly policy: TaxPolicyService,
  ) {}

  /* ---------------------------------------------------------------------- */
  /*  The rule itself                                                        */
  /* ---------------------------------------------------------------------- */
  //
  // Declared before the `:id` routes further down. A literal segment written
  // after one is swallowed: `GET /tds/policy` would reach the id handler,
  // `uuidSchema.parse("policy")` would throw, and the endpoint would 400 with
  // a message about uuids.

  @Get("policy/years")
  @RequirePermission("tds.read")
  policyYears() {
    return this.policy.years();
  }

  @Get("policy/:year")
  @RequirePermission("tds.read")
  policyForYear(@Param("year") year: string) {
    return this.policy.forYear(yearSchema.parse(year));
  }

  /**
   * Changing the rule is a settings change, not a tax entry — it decides what
   * every future payroll withholds, so it follows the same permission as the
   * rest of Settings rather than `tds.write`.
   */
  @Post("policy/:year")
  @HttpCode(200)
  @RequirePermission("settings.write")
  savePolicy(
    @Param("year") year: string,
    @ZodBody(saveTdsPolicySchema) body: SaveTdsPolicyInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.policy.save(yearSchema.parse(year), body, actor);
  }

  /**
   * What one salary comes to, with the whole working.
   *
   * A GET with query parameters rather than a POST: it reads a rule and
   * computes, writes nothing, and being linkable is useful — an accountant
   * checking a figure can send somebody the URL.
   */
  @Get("policy-calculator")
  @RequirePermission("tds.read")
  calculate(@ZodQuery(calculateTdsSchema) query: CalculateTdsInput) {
    return this.policy.calculate(query);
  }

  @Get("liability")
  @RequirePermission("tds.read")
  liability(@ZodQuery(tdsLiabilityQuerySchema) query: TdsLiabilityQuery) {
    return this.tds.liability(query);
  }

  /**
   * The withholding screen's table: who was taxed this period, and how much.
   *
   * Above the `:id` routes below for the reason in the note at the top of this
   * file — a literal segment declared after one is swallowed by it.
   */
  @Get("salary-deductions")
  @RequirePermission("tds.read")
  salaryDeductions(
    @ZodQuery(salaryTdsRegisterQuerySchema) query: SalaryTdsRegisterQuery,
  ) {
    return this.tds.salaryRegister(query);
  }

  /**
   * The challan a salary row's tax was deposited under.
   *
   * Under `salary-deductions` rather than beside `deposits/:id`, because that
   * is the record being changed: a payroll line, read on the register. It
   * writes the one row unless `applyToMonth` says otherwise — see
   * `TdsService.setLineChallan` for why that is the way round it is.
   */
  @Patch("salary-deductions/:id/challan")
  @RequirePermission("tds.write")
  setLineChallan(
    @Param("id") id: string,
    @ZodBody(setLineChallanSchema) body: SetLineChallanInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.tds.setLineChallan(uuidSchema.parse(id), body, actor);
  }

  @Get("pending")
  @RequirePermission("tds.read")
  pending(@ZodQuery(pendingQuerySchema) query: PendingQuery) {
    return this.tds.pending(query);
  }

  @Get("unallocated")
  @RequirePermission("tds.read")
  unallocated(
    @ZodQuery(unallocatedQuerySchema)
    query: z.infer<typeof unallocatedQuerySchema>,
  ) {
    return this.tds.unallocated(query.year, query.month);
  }

  @Get("deposits")
  @RequirePermission("tds.read")
  listDeposits(@ZodQuery(listDepositsQuerySchema) query: ListDepositsQuery) {
    return this.tds.listDeposits(query.year);
  }

  @Get("deposits/:id")
  @RequirePermission("tds.read")
  getDeposit(@Param("id") id: string) {
    return this.tds.getDeposit(uuidSchema.parse(id));
  }

  @Post("deposits")
  @RequirePermission("tds.write")
  createDeposit(
    @ZodBody(createTdsDepositSchema) body: CreateTdsDepositInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.tds.createDeposit(body, actor);
  }

  /** Correcting a challan already recorded — the number, the date, the amount. */
  @Patch("deposits/:id")
  @RequirePermission("tds.write")
  updateDeposit(
    @Param("id") id: string,
    @ZodBody(updateTdsDepositSchema) body: UpdateTdsDepositInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.tds.updateDeposit(uuidSchema.parse(id), body, actor);
  }

  @Post("deposits/:id/allocations")
  @HttpCode(200)
  @RequirePermission("tds.write")
  allocate(
    @Param("id") id: string,
    @ZodBody(allocateDepositSchema) body: AllocateDepositInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.tds.allocate(uuidSchema.parse(id), body, actor);
  }

  @Get("returns")
  @RequirePermission("tds.read")
  listReturns(@ZodQuery(fiscalYearQuerySchema) query: FiscalYearQuery) {
    return this.tds.listReturns(query.fiscalYear);
  }

  @Post("returns/:id/file")
  @HttpCode(200)
  @RequirePermission("tds.write")
  fileReturn(
    @Param("id") id: string,
    @ZodBody(fileReturnSchema) body: FileReturnInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.tds.fileReturn(returnIdSchema.parse(id), body, actor);
  }
}
