import { Controller, Delete, Get, Param, Post } from "@nestjs/common";
import {
  listFxRatesQuerySchema,
  setFxRateSchema,
  type ListFxRatesQuery,
  type SetFxRateInput,
} from "@finance/shared";

import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ZodBody, ZodQuery } from "../../common/pipes/zod-validation.pipe";
import { FxService } from "./fx.service";

@Controller("fx")
export class FxController {
  constructor(private readonly fx: FxService) {}

  @Get("rates")
  @RequirePermission("settings.read")
  list(@ZodQuery(listFxRatesQuerySchema) query: ListFxRatesQuery) {
    return this.fx.list(query);
  }

  /** The rate drives every USD figure in the app, so this is Super Admin only. */
  @Post("rates")
  @RequirePermission("settings.write")
  set(
    @ZodBody(setFxRateSchema) body: SetFxRateInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.fx.set(body, actor);
  }

  /**
   * Same permission as setting one: whoever may state the rate may unstate it.
   *
   * Delete rather than void — a rate is a claim about a day, not a movement of
   * money, and a wrong claim left on the page goes on translating figures. The
   * audit log keeps what it said.
   */
  @Delete("rates/:id")
  @RequirePermission("settings.write")
  remove(@Param("id") id: string) {
    return this.fx.remove(id);
  }
}
