import {
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Res,
  StreamableFile,
} from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";

import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ZodBody, ZodQuery } from "../../common/pipes/zod-validation.pipe";
import { BankAdvicesService } from "./bank-advices.service";
import {
  adviceInputSchema,
  disposition,
  fromPayrollSchema,
  lineInputSchema,
  listAdvicesQuerySchema,
  type AdviceInput,
  type FromPayrollInput,
  type LineInput,
  type ListAdvicesQuery,
} from "./bank-format";

const uuidSchema = z.string().uuid("Not a valid id");

/**
 * Bank advices — the payment file for the bank (#119).
 *
 * Reading on `payroll.read`, like the salary sheet it comes from. Everything
 * that builds, changes or downloads one on `payroll.pay`: the file is what
 * sends the salaries out, and that permission is already the line between
 * running payroll and releasing the money (HR holds read, not pay).
 *
 * No DELETE for the advice itself: that goes through the trash
 * (`POST /trash/bank-advice/:id`), so it can be put back.
 */
@Controller("bank-advices")
export class BankAdvicesController {
  constructor(private readonly advices: BankAdvicesService) {}

  @Get()
  @RequirePermission("payroll.read")
  list(@ZodQuery(listAdvicesQuerySchema) query: ListAdvicesQuery) {
    return this.advices.list(query);
  }

  @Get(":id")
  @RequirePermission("payroll.read")
  get(@Param("id") id: string) {
    return this.advices.get(uuidSchema.parse(id));
  }

  @Post("from-payroll")
  @RequirePermission("payroll.pay")
  fromPayroll(
    @ZodBody(fromPayrollSchema) body: FromPayrollInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.advices.fromPayroll(body, actor);
  }

  @Post()
  @RequirePermission("payroll.pay")
  create(
    @ZodBody(adviceInputSchema) body: AdviceInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.advices.create(body, actor);
  }

  @Patch(":id")
  @RequirePermission("payroll.pay")
  update(
    @Param("id") id: string,
    @ZodBody(adviceInputSchema) body: AdviceInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.advices.update(uuidSchema.parse(id), body, actor);
  }

  @Post(":id/lines")
  @RequirePermission("payroll.pay")
  addLine(
    @Param("id") id: string,
    @ZodBody(lineInputSchema) body: LineInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.advices.addLine(uuidSchema.parse(id), body, actor);
  }

  @Patch(":id/lines/:lineId")
  @RequirePermission("payroll.pay")
  updateLine(
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @ZodBody(lineInputSchema) body: LineInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.advices.updateLine(
      uuidSchema.parse(id),
      uuidSchema.parse(lineId),
      body,
      actor,
    );
  }

  @Delete(":id/lines/:lineId")
  @RequirePermission("payroll.pay")
  removeLine(
    @Param("id") id: string,
    @Param("lineId") lineId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.advices.removeLine(
      uuidSchema.parse(id),
      uuidSchema.parse(lineId),
      actor,
    );
  }

  /** The CSV for S2B. Refused, in words, while anything in it is missing. */
  @Get(":id/csv")
  @RequirePermission("payroll.pay")
  async csv(
    @Param("id") id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { buffer, filename } = await this.advices.csv(
      uuidSchema.parse(id),
      actor,
    );
    response.set({
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": disposition(filename),
      "Content-Length": String(buffer.length),
    });
    return new StreamableFile(buffer);
  }

  /** The bank's own workbook, filled — to read and keep. */
  @Get(":id/xlsx")
  @RequirePermission("payroll.pay")
  async xlsx(
    @Param("id") id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const { buffer, filename } = await this.advices.workbook(
      uuidSchema.parse(id),
      actor,
    );
    response.set({
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": disposition(filename),
      "Content-Length": String(buffer.length),
    });
    return new StreamableFile(buffer);
  }
}
