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
  Put,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  AI_ATTACHMENT_MAX_BYTES,
  aiConfirmSchema,
  aiFeedbackSchema,
  aiIntakeRequestSchema,
  aiLinkSchema,
  isDocAttachment,
  makeAiRuleSchema,
  setAiInstructionsSchema,
  setAiKeySchema,
  updateAiSettingsSchema,
  type AiConfirmInput,
  type AiFeedbackInput,
  type AiImportPlan,
  type AiIntakeRequest,
  type AiLinkInput,
  type MakeAiRuleInput,
  type SetAiInstructionsInput,
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
import { AiAttachmentsService, emptyPartsOf } from "./ai-attachments.service";
import { AiChatsService } from "./ai-chats.service";
import { AiConfirmService } from "./ai-confirm.service";
import { AiIntakeService } from "./ai-intake.service";

/**
 * Nothing here writes to the books but Confirm and save.
 *
 * The assistant produces values. Saving them is the person's act, on a
 * button: `confirm` checks the draft again and hands it to the record's own
 * service, through its own schema and with the person's permissions, so the
 * audit trail reads as it would have if somebody typed it — and says it came
 * through the Assistant (A4).
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
    private readonly confirmer: AiConfirmService,
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
   * A list of them: one, or every sheet of an Excel workbook that has
   * several (A3c), as a Sheet's link gives every tab.
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

  /**
   * A Google Sheet, Doc or Drive file, by the link somebody pasted (A3).
   *
   * The chat sends the link here before the message, so the file is on the
   * conversation by the time the model sees it. Read with the service account
   * from Settings → Connections; what comes back is an attachment like any
   * other, and belongs to whoever pasted the link. A list of them: one, or
   * every tab of a Sheet whose link names none (A3b).
   */
  @Post("attachments/link")
  @HttpCode(200)
  @RequirePermission("ai.use")
  attachLink(
    @ZodBody(aiLinkSchema) body: AiLinkInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.attachments.fromLink(body.url, actor, (buffer) =>
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
   * something to read and becomes something about to enter the books.
   * Attaching a spreadsheet and asking about it is `ai.use`; staging it for
   * import is a different act and needs `imports.run` as well.
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

    // A Doc's paragraphs are not entries, and Import would stage each one as
    // a row of money with no amount.
    if (isDocAttachment(attachment.filename)) {
      throw new BadRequestException(
        "A document cannot be staged for Import. Ask the Assistant to draft the records in it instead.",
      );
    }

    if (attachment.importBatchId) {
      return { batchId: attachment.importBatchId, alreadyStaged: true };
    }

    // A sheet read as its whole file (A3d) is staged under its own name,
    // without the line that names the empty sheets beside it.
    const { batch } = await this.imports.stage(
      emptyPartsOf(attachment.filename).name,
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
   * Confirm and save (A4): a draft card's, or one row of a table's.
   *
   * `ai.use` is only the door. Inside, the draft is held to the permission
   * of the record's own endpoint, to the map and to its schema, and saved by
   * that endpoint's own service as this person — see ai-confirm.service.ts.
   */
  @Post("confirm")
  @HttpCode(200)
  @RequirePermission("ai.use")
  confirm(
    @ZodBody(aiConfirmSchema) body: AiConfirmInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.confirmer.confirm(body, actor);
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

  /**
   * The owner's instructions for the assistant: read, and saved.
   *
   * Super Admin alone, both ways. A rule here changes what the assistant
   * drafts for everybody who uses it, so it sits with the other decisions
   * only they can make; and reading is theirs too until the owner says who
   * else may (the brief leaves what the CFO sees to them).
   */
  @Get("instructions")
  @RequirePermission("settings.write")
  instructions() {
    return this.ai.instructions();
  }

  @Put("instructions")
  @RequirePermission("settings.write")
  setInstructions(
    @ZodBody(setAiInstructionsSchema) body: SetAiInstructionsInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.ai.setInstructions(body, actor);
  }

  /* --- it gets better with use (A2b) ------------------------------------ */

  /**
   * "This was wrong", on the answer a conversation ended on. Anybody who
   * may use the Assistant may say so of their own conversation; what was
   * asked and answered is read from it, not taken from the request.
   */
  @Post("feedback")
  @HttpCode(200)
  @RequirePermission("ai.use")
  feedback(
    @ZodBody(aiFeedbackSchema) body: AiFeedbackInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.ai.feedback(body, actor);
  }

  /**
   * The mistakes, and making one a rule or taking it off: Super Admin
   * alone, as the instructions are. A rule changes what the Assistant does
   * for everybody, and the list carries what other people asked.
   */
  @Get("mistakes")
  @RequirePermission("settings.write")
  mistakes() {
    return this.ai.mistakes();
  }

  @Post("mistakes/:id/rule")
  @HttpCode(200)
  @RequirePermission("settings.write")
  makeRule(
    @Param("id", ParseUUIDPipe) id: string,
    @ZodBody(makeAiRuleSchema) body: MakeAiRuleInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.ai.makeRule(id, body, actor);
  }

  @Delete("mistakes/:id")
  @HttpCode(204)
  @RequirePermission("settings.write")
  forgetMistake(@Param("id", ParseUUIDPipe) id: string) {
    return this.ai.forgetMistake(id);
  }

  /**
   * The map the Assistant is given, for "What the Assistant knows". It holds
   * no record of anybody's, only what the app is, so whoever may use the
   * Assistant may read what it is told.
   */
  @Get("knowledge")
  @RequirePermission("ai.use")
  knowledge() {
    return this.ai.knowledge();
  }
}
