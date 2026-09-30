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
  listRequestsQuerySchema,
  requestKindSchema,
  submitPayChangeSchema,
  type DecisionInput,
  type ExternalIdsQuery,
  type ListRequestsQuery,
  type SubmitPayChangeInput,
} from "./hr-requests.schemas";
import { HrRequestsService } from "./hr-requests.service";

const uuidSchema = z.string().uuid("Not a valid id");

/**
 * HR Requests (#125): every money request from the HR portal, and finance's
 * answer.
 *
 *   HR's side (the HR portal's login, role `hr`):
 *     POST /hr-requests/pay-changes            team.compensation.request
 *     GET  /hr-requests/<kind>/status?externalIds=a,b   that kind's door
 *   The page (CFO, Super Admin, and the CEO to read):
 *     GET  /hr-requests, /hr-requests/waiting, /hr-requests/:kind/:id
 *                                              hrrequests.read
 *     POST /hr-requests/:kind/:id/decision     hrrequests.decide
 *
 * One-offs, budgets and spends keep the doors they arrived on in #121
 * (POST /payroll/one-offs, /hr-budget/periods, /hr-budget/spends); what
 * changed is that each now waits here. The literal routes are declared above
 * `:kind/:id`, which would otherwise read "pay-changes" as a kind.
 */
@Controller("hr-requests")
export class HrRequestsController {
  constructor(private readonly requests: HrRequestsService) {}

  /**
   * A pay change, stored and not applied. 201 for a first send, 200 for an
   * amend while it waits, and 409 with its state once finance has decided —
   * written here, because the app's error filter keeps only a message.
   */
  @Post("pay-changes")
  @RequirePermission("team.compensation.request")
  async submitPayChange(
    @ZodBody(submitPayChangeSchema) body: SubmitPayChangeInput,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.requests.submitPayChange(body, actor);
    if (result.outcome === "conflict") {
      response.status(409);
      return {
        statusCode: 409,
        message:
          "Finance has already decided this pay change, so it was not changed. A different figure is a new request.",
        state: result.state,
      };
    }
    response.status(result.outcome === "created" ? 201 : 200);
    return result.state;
  }

  /* ---- What HR reads back: one shape for all four -------------------- */

  @Get("pay-changes/status")
  @RequirePermission("team.compensation.request")
  payChangeStatus(@ZodQuery(externalIdsQuerySchema) query: ExternalIdsQuery) {
    return this.requests.statuses("pay_change", query.externalIds);
  }

  @Get("one-offs/status")
  @RequirePermission("payroll.oneoff.submit")
  oneOffStatus(@ZodQuery(externalIdsQuerySchema) query: ExternalIdsQuery) {
    return this.requests.statuses("one_off", query.externalIds);
  }

  @Get("budgets/status")
  @RequirePermission("hrbudget.submit")
  budgetStatus(@ZodQuery(externalIdsQuerySchema) query: ExternalIdsQuery) {
    return this.requests.statuses("budget", query.externalIds);
  }

  @Get("spends/status")
  @RequirePermission("hrbudget.submit")
  spendStatus(@ZodQuery(externalIdsQuerySchema) query: ExternalIdsQuery) {
    return this.requests.statuses("spend", query.externalIds);
  }

  /* ---- The page ------------------------------------------------------- */

  @Get()
  @RequirePermission("hrrequests.read")
  list(@ZodQuery(listRequestsQuerySchema) query: ListRequestsQuery) {
    return this.requests.list(query);
  }

  /** The count on the rail. */
  @Get("waiting")
  @RequirePermission("hrrequests.read")
  waiting() {
    return this.requests.waitingCount();
  }

  @Get(":kind/:id")
  @RequirePermission("hrrequests.read")
  get(@Param("kind") kind: string, @Param("id") id: string) {
    return this.requests.get(
      requestKindSchema.parse(kind),
      uuidSchema.parse(id),
    );
  }

  @Post(":kind/:id/decision")
  @HttpCode(200)
  @RequirePermission("hrrequests.decide")
  decide(
    @Param("kind") kind: string,
    @Param("id") id: string,
    @ZodBody(decisionSchema) body: DecisionInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.requests.decide(
      requestKindSchema.parse(kind),
      uuidSchema.parse(id),
      body,
      actor,
    );
  }
}
