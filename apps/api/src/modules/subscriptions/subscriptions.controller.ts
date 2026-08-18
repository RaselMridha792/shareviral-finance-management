import { Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import {
  createSubscriptionSchema,
  listSubscriptionsQuerySchema,
  updateSubscriptionSchema,
  type CreateSubscriptionInput,
  type ListSubscriptionsQuery,
  type UpdateSubscriptionInput,
} from "@finance/shared";
import { z } from "zod";

import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ZodBody, ZodQuery } from "../../common/pipes/zod-validation.pipe";
import { SubscriptionsService } from "./subscriptions.service";

const uuidSchema = z.string().uuid("Not a valid id");

/**
 * The register of paid tools.
 *
 * Gated on `vendors.*` rather than a permission of its own. A subscription is
 * a commercial relationship with a supplier, which is what those two already
 * mean — and a third pair would have to be granted to exactly the same people,
 * which is a matrix that drifts rather than a boundary that holds.
 */
@Controller("subscriptions")
export class SubscriptionsController {
  constructor(private readonly subscriptions: SubscriptionsService) {}

  @Get()
  @RequirePermission("vendors.read")
  list(@ZodQuery(listSubscriptionsQuerySchema) query: ListSubscriptionsQuery) {
    return this.subscriptions.list(query);
  }

  /**
   * Declared above `:id`, or Nest matches this path as an id and every request
   * for somebody's tools comes back as "Not a valid id".
   */
  @Get("for-member/:teamMemberId")
  @RequirePermission("vendors.read")
  forMember(@Param("teamMemberId") teamMemberId: string) {
    return this.subscriptions.forMember(uuidSchema.parse(teamMemberId));
  }

  @Get(":id")
  @RequirePermission("vendors.read")
  get(@Param("id") id: string) {
    return this.subscriptions.get(uuidSchema.parse(id));
  }

  @Post()
  @RequirePermission("vendors.write")
  create(
    @ZodBody(createSubscriptionSchema) body: CreateSubscriptionInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.subscriptions.create(body, actor);
  }

  @Patch(":id")
  @RequirePermission("vendors.write")
  update(
    @Param("id") id: string,
    @ZodBody(updateSubscriptionSchema) body: UpdateSubscriptionInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.subscriptions.update(uuidSchema.parse(id), body, actor);
  }

  /**
   * For the row that should never have been typed.
   *
   * Cancelling a subscription is a status change, not this — the register is
   * meant to answer "what did we cancel this quarter", and a deleted row
   * cannot.
   */
  @Delete(":id")
  @RequirePermission("vendors.write")
  remove(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.subscriptions.remove(uuidSchema.parse(id), actor);
  }
}
