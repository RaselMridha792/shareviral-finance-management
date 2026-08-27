import { Controller, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import {
  createPayrollRunSchema,
  listPayrollRunsQuerySchema,
  payPayrollSchema,
  updatePayrollLineSchema,
  type CreatePayrollRunInput,
  type ListPayrollRunsQuery,
  type PayPayrollInput,
  type UpdatePayrollLineInput,
  payrollEligibleQuerySchema,
  syncRunMembersSchema,
  type PayrollEligibleQuery,
  type SyncRunMembersInput,
} from "@finance/shared";
import { z } from "zod";

import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ZodBody, ZodQuery } from "../../common/pipes/zod-validation.pipe";
import { PayrollService } from "./payroll.service";

const uuidSchema = z.string().uuid("Not a valid id");

@Controller("payroll")
export class PayrollController {
  constructor(private readonly payroll: PayrollService) {}

  @Get("runs")
  @RequirePermission("payroll.read")
  listRuns(@ZodQuery(listPayrollRunsQuerySchema) query: ListPayrollRunsQuery) {
    return this.payroll.listRuns(query);
  }

  @Get("runs/:id")
  @RequirePermission("payroll.read")
  getRun(@Param("id") id: string) {
    return this.payroll.getRun(uuidSchema.parse(id));
  }

  @Post("runs")
  @RequirePermission("payroll.write")
  createRun(
    @ZodBody(createPayrollRunSchema) body: CreatePayrollRunInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.payroll.createRun(body, actor);
  }

  /**
   * Who could be on a month's sheet, with what they would be paid.
   *
   * `payroll.write` rather than read: this names every employee's salary in
   * one list, and the only reason to ask is to build or reshape a sheet.
   */
  @Get("eligible")
  @RequirePermission("payroll.write")
  eligible(@ZodQuery(payrollEligibleQuerySchema) query: PayrollEligibleQuery) {
    return this.payroll.eligibleMembers(query.periodYear, query.periodMonth);
  }

  /**
   * Makes a draft run hold exactly these people.
   *
   * The declarative door the run screen's checklist speaks: additions are
   * built the standard way, removals lose their line, and everyone who stays
   * keeps every edit — the promise the wipe-and-rebuild below cannot make.
   */
  @Post("runs/:id/members")
  @HttpCode(200)
  @RequirePermission("payroll.write")
  syncMembers(
    @Param("id") id: string,
    @ZodBody(syncRunMembersSchema) body: SyncRunMembersInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.payroll.syncMembers(uuidSchema.parse(id), body, actor);
  }

  @Post("runs/:id/generate-lines")
  @HttpCode(200)
  @RequirePermission("payroll.write")
  generate(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.payroll.generateLines(uuidSchema.parse(id), actor);
  }

  /**
   * Reapplies the year's rule to a draft sheet.
   *
   * Separate from generate-lines because rebuilding would throw away the
   * bonuses and breakdowns somebody has typed since — and the reason to want
   * this is usually that the rates were published after the sheet was built.
   */
  @Post("runs/:id/recalculate-tds")
  @HttpCode(200)
  @RequirePermission("payroll.write")
  recalculateTds(
    @Param("id") id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.payroll.recalculateTds(uuidSchema.parse(id), actor);
  }

  @Patch("lines/:id")
  @RequirePermission("payroll.write")
  updateLine(
    @Param("id") id: string,
    @ZodBody(updatePayrollLineSchema) body: UpdatePayrollLineInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.payroll.updateLine(uuidSchema.parse(id), body, actor);
  }

  @Post("runs/:id/finalize")
  @HttpCode(200)
  @RequirePermission("payroll.write")
  finalize(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.payroll.finalize(uuidSchema.parse(id), actor);
  }

  @Post("runs/:id/reopen")
  @HttpCode(200)
  @RequirePermission("payroll.write")
  reopen(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.payroll.reopen(uuidSchema.parse(id), actor);
  }

  /** Moves the money. Needs its own permission beyond payroll.write. */
  @Post("runs/:id/pay")
  @HttpCode(200)
  @RequirePermission("payroll.pay")
  pay(
    @Param("id") id: string,
    @ZodBody(payPayrollSchema) body: PayPayrollInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.payroll.pay(uuidSchema.parse(id), body, actor);
  }

  @Get("lines/:id/payslip")
  @RequirePermission("payroll.read")
  payslip(@Param("id") id: string) {
    return this.payroll.payslip(uuidSchema.parse(id));
  }

  /**
   * Every payslip one person has, newest first — what the Pay tab of their
   * profile lists.
   *
   * `payroll.read`, the same permission that guards the payslip it links to.
   * Reaching the figures by team member rather than by run must not be a way
   * around the gate: HR holds `team.read` and `team.write`, holds neither
   * `payroll.read` nor `team.compensation.read`, and gets a 403 here.
   */
  @Get("members/:id/payslips")
  @RequirePermission("payroll.read")
  memberPayslips(@Param("id") id: string) {
    return this.payroll.memberPayslips(uuidSchema.parse(id));
  }
}
