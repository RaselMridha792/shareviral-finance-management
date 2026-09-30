import { Controller, Get, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";

import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ZodBody, ZodQuery } from "../../common/pipes/zod-validation.pipe";
import { submitOneOffSchema, type SubmitOneOffInput } from "./one-offs";
import { PayrollOneOffsService } from "./one-offs.service";

const externalIdsQuerySchema = z.object({
  externalIds: z
    .string()
    .transform((value) =>
      value
        .split(",")
        .map((one) => one.trim())
        .filter(Boolean),
    )
    .pipe(
      z
        .array(z.string().uuid("Each id must be a uuid"))
        .min(1, "Give at least one id")
        .max(100, "At most 100 ids at a time"),
    ),
});

/**
 * One-off amounts for a month's salary sheet (#121) — the HR portal's door,
 * on `payroll.oneoff.submit`. 201 for a first send, 200 for an amend, and 409
 * with the state and the sheet's status once that month's sheet is settled —
 * written here, because the app's error filter keeps only a message.
 */
@Controller("payroll/one-offs")
export class PayrollOneOffsController {
  constructor(private readonly oneOffs: PayrollOneOffsService) {}

  @Post()
  @RequirePermission("payroll.oneoff.submit")
  async submit(
    @ZodBody(submitOneOffSchema) body: SubmitOneOffInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.oneOffs.submit(body, actor);
    if (result.outcome === "conflict") {
      response.status(409);
      const decision = result.state?.decision;
      return {
        statusCode: 409,
        message:
          decision === "approved" || decision === "rejected"
            ? `Finance has already ${decision} this one-off, so this was not changed. A different amount is a new request.`
            : `The ${body.periodYear}-${String(body.periodMonth).padStart(2, "0")} salary sheet is ${result.sheetStatus.replace(/_/g, " ")}, so this was not changed. Send it for another month.`,
        state: result.state,
        sheetStatus: result.sheetStatus,
      };
    }
    response.status(result.outcome === "created" ? 201 : 200);
    return result.state;
  }

  @Get()
  @RequirePermission("payroll.oneoff.submit")
  states(
    @ZodQuery(externalIdsQuerySchema)
    query: z.infer<typeof externalIdsQuerySchema>,
  ) {
    return this.oneOffs.states(query.externalIds);
  }
}
