import { Controller, Delete, Get, HttpCode, Post } from "@nestjs/common";
import { setGoogleKeySchema, type SetGoogleKeyInput } from "@finance/shared";

import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ZodBody } from "../../common/pipes/zod-validation.pipe";
import { ConnectionsService } from "./connections.service";

/**
 * The Google Cloud key, in the Assistant's settings (B2; it was Settings →
 * Connections until 3 Oct 2026).
 *
 * `settings.write` throughout, which is Super Admin alone: the key spends the
 * company's money on Google and reads whatever is shared with it, the same
 * footing as the Anthropic key. The key travels one way — in.
 */
@Controller("connections")
export class ConnectionsController {
  constructor(private readonly connections: ConnectionsService) {}

  @Get("google")
  @RequirePermission("settings.write")
  google() {
    return this.connections.google();
  }

  @Post("google/key")
  @HttpCode(200)
  @RequirePermission("settings.write")
  setGoogleKey(
    @ZodBody(setGoogleKeySchema) body: SetGoogleKeyInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.connections.setGoogleKey(body.serviceAccount, actor);
  }

  @Delete("google/key")
  @RequirePermission("settings.write")
  clearGoogleKey(@CurrentUser() actor: AuthenticatedUser) {
    return this.connections.clearGoogleKey(actor);
  }

  @Post("google/test")
  @HttpCode(200)
  @RequirePermission("settings.write")
  testGoogle(@CurrentUser() actor: AuthenticatedUser) {
    return this.connections.testGoogle(actor);
  }
}
