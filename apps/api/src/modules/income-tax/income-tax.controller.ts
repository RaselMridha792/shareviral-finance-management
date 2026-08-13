import { Controller, Get, HttpCode, Param, Patch, Post } from "@nestjs/common";
import {
  generateScheduleSchema,
  listIncomeTaxQuerySchema,
  payIncomeTaxSchema,
  pendingQuerySchema,
  updateIncomeTaxSchema,
  type GenerateScheduleInput,
  type ListIncomeTaxQuery,
  type PayIncomeTaxInput,
  type PendingQuery,
  type UpdateIncomeTaxInput,
} from "@finance/shared";
import { z } from "zod";

import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ZodBody, ZodQuery } from "../../common/pipes/zod-validation.pipe";
import { IncomeTaxService } from "./income-tax.service";

const uuidSchema = z.string().uuid("Not a valid id");

@Controller("income-tax")
export class IncomeTaxController {
  constructor(private readonly incomeTax: IncomeTaxService) {}

  @Get()
  @RequirePermission("incometax.read")
  list(@ZodQuery(listIncomeTaxQuerySchema) query: ListIncomeTaxQuery) {
    return this.incomeTax.list(query.assessmentYear);
  }

  @Get("pending")
  @RequirePermission("incometax.read")
  pending(@ZodQuery(pendingQuerySchema) query: PendingQuery) {
    return this.incomeTax.pending(query);
  }

  @Get(":id")
  @RequirePermission("incometax.read")
  get(@Param("id") id: string) {
    return this.incomeTax.get(uuidSchema.parse(id));
  }

  /** Idempotent: returns the existing schedule if this year already has one. */
  @Post("schedule")
  @HttpCode(200)
  @RequirePermission("incometax.write")
  schedule(
    @ZodBody(generateScheduleSchema) body: GenerateScheduleInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.incomeTax.schedule(body.fiscalYear, actor);
  }

  @Patch(":id")
  @RequirePermission("incometax.write")
  update(
    @Param("id") id: string,
    @ZodBody(updateIncomeTaxSchema) body: UpdateIncomeTaxInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.incomeTax.update(uuidSchema.parse(id), body, actor);
  }

  @Post(":id/pay")
  @HttpCode(200)
  @RequirePermission("incometax.write")
  pay(
    @Param("id") id: string,
    @ZodBody(payIncomeTaxSchema) body: PayIncomeTaxInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.incomeTax.pay(uuidSchema.parse(id), body, actor);
  }
}
