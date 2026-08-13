import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from "@nestjs/common";
import {
  aiIntakeRequestSchema,
  setAiKeySchema,
  updateAiSettingsSchema,
  type AiIntakeRequest,
  type SetAiKeyInput,
  type UpdateAiSettingsInput,
} from "@finance/shared";

import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ZodBody } from "../../common/pipes/zod-validation.pipe";
import { AiChatsService } from "./ai-chats.service";
import { AiIntakeService } from "./ai-intake.service";

/**
 * Nothing here writes to the books.
 *
 * The assistant produces values; saving them is an ordinary create against the
 * record's own endpoint, so permissions, validation and the audit trail apply
 * exactly as they would have if somebody typed it.
 *
 * The key endpoints are Super Admin only, and the key travels one way: in. No
 * response from this API ever contains it — only whether one is set and its
 * last four characters.
 */
@Controller("ai")
export class AiIntakeController {
  constructor(
    private readonly ai: AiIntakeService,
    private readonly chats: AiChatsService,
  ) {}

  @Get("availability")
  @RequirePermission("ai.use")
  availability() {
    return this.ai.availability();
  }

  @Post("turn")
  @HttpCode(200)
  @RequirePermission("ai.use")
  turn(
    @ZodBody(aiIntakeRequestSchema) body: AiIntakeRequest,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    // The actor travels with the request: every lookup the assistant makes
    // runs under this person permissions, never the server ones.
    return this.ai.turn(body, actor);
  }

  /* --- the history list ------------------------------------------------- */

  /**
   * Only ever this person's own conversations.
   *
   * The actor is not a filter applied to a wider result — it is in the where
   * clause of every query in AiChatsService, so there is no shape of request
   * that returns somebody else's transcript.
   */
  @Get("chats")
  @RequirePermission("ai.use")
  listChats(@CurrentUser() actor: AuthenticatedUser) {
    return this.chats.list(actor);
  }

  @Get("chats/:id")
  @RequirePermission("ai.use")
  getChat(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.chats.get(id, actor);
  }

  @Delete("chats/:id")
  @HttpCode(204)
  @RequirePermission("ai.use")
  removeChat(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.chats.remove(id, actor);
  }

  @Delete("chats")
  @RequirePermission("ai.use")
  clearChats(@CurrentUser() actor: AuthenticatedUser) {
    return this.chats.clear(actor);
  }

  /** Category and account names to ids, checked against what exists. */
  @Post("resolve")
  @HttpCode(200)
  @RequirePermission("ai.use")
  resolve(@Body("draft") draft: Record<string, unknown>) {
    return this.ai.resolve(draft ?? {});
  }

  /**
   * `settings.write` is Super Admin alone. This spends the company's money on
   * somebody else's platform, so it belongs with the other decisions only they
   * can make.
   */
  @Post("key")
  @HttpCode(200)
  @RequirePermission("settings.write")
  setKey(
    @ZodBody(setAiKeySchema) body: SetAiKeyInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.ai.setKey(body.apiKey, actor);
  }

  /** Model and how much it may read. Super Admin only. */
  @Patch("settings")
  @RequirePermission("settings.write")
  updateSettings(
    @ZodBody(updateAiSettingsSchema) body: UpdateAiSettingsInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.ai.updateSettings(body, actor);
  }

  @Delete("key")
  @RequirePermission("settings.write")
  clearKey(@CurrentUser() actor: AuthenticatedUser) {
    return this.ai.clearKey(actor);
  }
}
