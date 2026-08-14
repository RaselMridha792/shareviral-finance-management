import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  AI_ATTACHMENT_MAX_BYTES,
  AI_TARGETS,
  aiIntakeRequestSchema,
  setAiKeySchema,
  updateAiSettingsSchema,
  type AiImportPlan,
  type AiIntakeRequest,
  type AiTarget,
  type SetAiKeyInput,
  type UpdateAiSettingsInput,
} from "@finance/shared";

import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ZodBody } from "../../common/pipes/zod-validation.pipe";
import { ImportsService } from "../imports/imports.service";
import { AiAttachmentsService } from "./ai-attachments.service";
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
    private readonly attachments: AiAttachmentsService,
    private readonly imports: ImportsService,
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

  /* --- attached files ---------------------------------------------------- */

  /**
   * A spreadsheet or a PDF statement for the assistant to read.
   *
   * Parsed here and kept as rows, never as bytes. A spreadsheet is parsed in
   * code; a PDF is transcribed by the model, which is why the reader is handed
   * down from here — this is the one place that holds both services.
   *
   * It belongs to whoever attached it, like the conversation it sits in.
   */
  @Post("attachments")
  @HttpCode(200)
  @RequirePermission("ai.use")
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: AI_ATTACHMENT_MAX_BYTES } }),
  )
  uploadAttachment(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException("Choose a file to attach");
    return this.attachments.upload(file, actor, (buffer) =>
      this.ai.readPdf(buffer),
    );
  }

  @Delete("attachments/:id")
  @HttpCode(204)
  @RequirePermission("ai.use")
  removeAttachment(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.attachments.remove(id, actor);
  }

  /**
   * Hands the file's rows to the import screen.
   *
   * Separately permissioned, because this is where a file stops being
   * something to read and becomes something about to enter the books. HR can
   * attach a spreadsheet and ask about it; staging it for import is a
   * different act and needs `imports.run`.
   */
  @Post("attachments/:id/to-import")
  @HttpCode(200)
  @RequirePermission("ai.use", "imports.run")
  async sendToImport(
    @Param("id", ParseUUIDPipe) id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Body("plan") plan?: AiImportPlan | null,
  ) {
    const attachment = await this.attachments.get(id, actor);

    if (attachment.importBatchId) {
      return { batchId: attachment.importBatchId, alreadyStaged: true };
    }

    const { batch } = await this.imports.stage(
      attachment.filename,
      attachment.headers,
      attachment.rows,
      actor,
    );

    await this.attachments.markImported(id, batch.id, actor);

    /**
     * The plan is applied here, not trusted here.
     *
     * `resolve` turns the account and category *names* into ids the same way a
     * single draft's do, so a name that does not exist is refused rather than
     * quietly dropped. And applying a mapping computes the preview — it writes
     * nothing to the ledger. The person still lands on a screen showing every
     * row and has to press Import.
     *
     * A plan that fails to apply is not fatal: the rows are staged either way,
     * and they can map the columns themselves. Losing the batch because the
     * shortcut did not work would be the worse outcome.
     */
    if (plan) {
      try {
        const mapping = await this.ai.importMapping(plan);
        await this.imports.applyMapping(batch.id, mapping, actor);
        return { batchId: batch.id, alreadyStaged: false, mapped: true };
      } catch {
        return { batchId: batch.id, alreadyStaged: false, mapped: false };
      }
    }

    return { batchId: batch.id, alreadyStaged: false, mapped: false };
  }

  /**
   * What somebody changed before saving, kept as an example for next time.
   *
   * Called after the save has succeeded, and its own failure is not the
   * caller's problem — the browser sends this and ignores the answer. A save
   * that went through must never be undone, or reported as failed, because a
   * lesson could not be filed.
   */
  @Post("learn")
  @HttpCode(200)
  @RequirePermission("ai.use")
  learn(
    @Body("chatId", ParseUUIDPipe) chatId: string,
    @Body("target") target: AiTarget,
    @Body("confirmed") confirmed: Record<string, unknown>,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!(AI_TARGETS as readonly string[]).includes(target)) {
      throw new BadRequestException("Not a kind of record this app keeps.");
    }
    return this.ai.learn(chatId, target, confirmed ?? {}, actor);
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
