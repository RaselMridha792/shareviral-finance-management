import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Patch,
  Post,
  Put,
} from "@nestjs/common";
import {
  lockBooksSchema,
  themeSchema,
  typographySchema,
  updateSettingsSchema,
  type LockBooksInput,
  type ThemeDto,
  type TypographySettings,
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

  /*
   * The look of the app (#124). `settings.write` is the Super Admin's alone:
   * the look of the company's finance app is not something a role changes on
   * a Tuesday. Read through GET /settings, with everything else the layout
   * needs, so no page pays for a second request.
   */

  @Put("theme")
  @RequirePermission("settings.write")
  saveTheme(
    @ZodBody(themeSchema) body: ThemeDto,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.settings.saveTheme(body, actor);
  }

  /** "Reset to the design": NULL, never a copy of the defaults. */
  @Delete("theme")
  @RequirePermission("settings.write")
  resetTheme(@CurrentUser() actor: AuthenticatedUser) {
    return this.settings.saveTheme(null, actor);
  }

  @Put("typography")
  @RequirePermission("settings.write")
  saveTypography(
    @ZodBody(typographySchema) body: TypographySettings,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.settings.saveTypography(body, actor);
  }

  @Delete("typography")
  @RequirePermission("settings.write")
  resetTypography(@CurrentUser() actor: AuthenticatedUser) {
    return this.settings.saveTypography(null, actor);
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
