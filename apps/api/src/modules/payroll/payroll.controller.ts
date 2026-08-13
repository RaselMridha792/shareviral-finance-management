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

  @Post("runs/:id/generate-lines")
  @HttpCode(200)
  @RequirePermission("payroll.write")
  generate(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.payroll.generateLines(uuidSchema.parse(id), actor);
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
}
