import { Controller, Get, HttpCode, Patch, Post } from "@nestjs/common";
import {
  lockBooksSchema,
  updateSettingsSchema,
  type LockBooksInput,
  type UpdateSettingsInput,
} from "@finance/shared";

import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ZodBody } from "../../common/pipes/zod-validation.pipe";
import { SettingsService } from "./settings.service";

@Controller("settings")
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  /**
   * Every role can read settings — the number format and financial year decide
   * how figures render, so the frontend needs them on every page.
   */
  @Get()
  @RequirePermission("settings.read")
  get() {
    return this.settings.publicView();
  }

  @Patch()
  @RequirePermission("settings.write")
  update(
    @ZodBody(updateSettingsSchema) body: UpdateSettingsInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.settings.update(body, actor);
  }

  @Post("lock-books")
  @HttpCode(200)
  @RequirePermission("settings.write")
  lockBooks(
    @ZodBody(lockBooksSchema) body: LockBooksInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.settings.lockBooks(body, actor);
  }
}
