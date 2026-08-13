import { Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import {
  allocateDepositSchema,
  createTdsDepositSchema,
  fileReturnSchema,
  fiscalYearQuerySchema,
  listDepositsQuerySchema,
  pendingQuerySchema,
  tdsLiabilityQuerySchema,
  type AllocateDepositInput,
  type CreateTdsDepositInput,
  type FileReturnInput,
  type FiscalYearQuery,
  type ListDepositsQuery,
  type PendingQuery,
  type TdsLiabilityQuery,
} from "@finance/shared";
import { z } from "zod";

import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ZodBody, ZodQuery } from "../../common/pipes/zod-validation.pipe";
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

const unallocatedQuerySchema = z.strictObject({
  year: z.coerce.number().int().min(2000).max(2200),
  month: z.coerce.number().int().min(1).max(12),
});

@Controller("tds")
export class TdsController {
  constructor(private readonly tds: TdsService) {}

  @Get("liability")
  @RequirePermission("tds.read")
  liability(@ZodQuery(tdsLiabilityQuerySchema) query: TdsLiabilityQuery) {
    return this.tds.liability(query);
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
