import { Controller, Get, HttpCode, Param, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { z } from "zod";

import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ZodBody, ZodQuery } from "../../common/pipes/zod-validation.pipe";
import {
  decisionSchema,
  externalIdsQuerySchema,
  listPeriodsQuerySchema,
  listSpendsQuerySchema,
  paySpendSchema,
  submitPeriodSchema,
  submitSpendSchema,
  type DecisionInput,
  type ExternalIdsQuery,
  type ListPeriodsQuery,
  type ListSpendsQuery,
  type PaySpendInput,
  type SubmitPeriodInput,
  type SubmitSpendInput,
} from "./hr-budget.schemas";
import { HrBudgetService, type Submitted } from "./hr-budget.service";

const uuidSchema = z.string().uuid("Not a valid id");

/**
 * The answer to a send: 201 for a first one, 200 for an amend, and 409 with
 * the current state once finance has acted — so the HR portal can show what
 * finance decided rather than retry. Written here rather than thrown: the
 * app's error filter keeps only `message` and `errors`, and the state is the
 * part the HR portal needs.
 */
function answer<T>(
  response: Response,
  result: Submitted<T>,
  what: "budget" | "spend",
) {
  if (result.outcome === "conflict") {
    response.status(409);
    return {
      statusCode: 409,
      message: `Finance has already acted on this ${what}, so it was not changed. Its state is attached.`,
      state: result.state,
    };
  }
  response.status(result.outcome === "created" ? 201 : 200);
  return result.state;
}

/**
 * HR Budget (#121). The HR portal's two doors on `hrbudget.submit`, the page
 * on `hrbudget.read`, the decisions on `hrbudget.manage`. Shapes settled with
 * the HR portal's session on 30 Sep 2026 — see `hr-budget.schemas.ts`.
 */
@Controller("hr-budget")
export class HrBudgetController {
  constructor(private readonly budget: HrBudgetService) {}

  @Post("periods")
  @RequirePermission("hrbudget.submit")
  async submitPeriod(
    @ZodBody(submitPeriodSchema) body: SubmitPeriodInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    return answer(
      response,
      await this.budget.submitPeriod(body, actor),
      "budget",
    );
  }

  /** Declared above anything with an id, so "status" is never read as one. */
  @Get("periods/status")
  @RequirePermission("hrbudget.submit")
  periodStates(@ZodQuery(externalIdsQuerySchema) query: ExternalIdsQuery) {
    return this.budget.periodStates(query.externalIds);
  }

  @Post("spends")
  @RequirePermission("hrbudget.submit")
  async submitSpend(
    @ZodBody(submitSpendSchema) body: SubmitSpendInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    return answer(
      response,
      await this.budget.submitSpend(body, actor),
      "spend",
    );
  }

  @Get("spends/status")
  @RequirePermission("hrbudget.submit")
  spendStates(@ZodQuery(externalIdsQuerySchema) query: ExternalIdsQuery) {
    return this.budget.spendStates(query.externalIds);
  }

  @Get("periods")
  @RequirePermission("hrbudget.read")
  listPeriods(@ZodQuery(listPeriodsQuerySchema) query: ListPeriodsQuery) {
    return this.budget.listPeriods(query);
  }

  @Get("spends")
  @RequirePermission("hrbudget.read")
  listSpends(@ZodQuery(listSpendsQuerySchema) query: ListSpendsQuery) {
    return this.budget.listSpends(query);
  }

  @Post("periods/:id/decision")
  @HttpCode(200)
  @RequirePermission("hrbudget.manage")
  decidePeriod(
    @Param("id") id: string,
    @ZodBody(decisionSchema) body: DecisionInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.budget.decidePeriod(uuidSchema.parse(id), body, actor);
  }

  @Post("spends/:id/decision")
  @HttpCode(200)
  @RequirePermission("hrbudget.manage")
  decideSpend(
    @Param("id") id: string,
    @ZodBody(decisionSchema) body: DecisionInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.budget.decideSpend(uuidSchema.parse(id), body, actor);
  }

  /** Needs `transactions.write` too: it writes an expense into the books. */
  @Post("spends/:id/pay")
  @HttpCode(200)
  @RequirePermission("hrbudget.manage", "transactions.write")
  paySpend(
    @Param("id") id: string,
    @ZodBody(paySpendSchema) body: PaySpendInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.budget.paySpend(uuidSchema.parse(id), body, actor);
  }
}
