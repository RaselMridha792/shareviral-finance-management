import {
  isImageMime,
  uploadFileSchema,
  UPLOAD_HARD_LIMIT_BYTES,
  type UploadFileInput,
} from "@finance/shared";
import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import type { Response } from "express";
import { z } from "zod";

import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ZodBody } from "../../common/pipes/zod-validation.pipe";
import { FilesService } from "./files.service";

const uuidSchema = z.string().uuid("Not a valid id");

/** One interceptor for every upload route, so the ceiling cannot drift. */
const upload = () =>
  UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: UPLOAD_HARD_LIMIT_BYTES } }),
  );

@Controller("files")
export class FilesController {
  constructor(private readonly files: FilesService) {}

  /* --- per owner, so the permission is on the route ---------------------- */
  /*
   * Declared before `:id/content` in the same spirit as the note in
   * VendorsController: a literal first segment read as a parameter is the kind
   * of routing bug that only shows up for the one id that happens to collide.
   */

  @Get("team-member/:id")
  @RequirePermission("team.read")
  listForTeamMember(
    @Param("id") id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    // The photograph is not a document. It has its own control beside the
    // face, and listing it here again makes one file look like two.
    return this.files.listFor("team_member", uuidSchema.parse(id), actor, [
      "profile_photo",
    ]);
  }

  @Post("team-member/:id")
  @RequirePermission("team.write")
  @upload()
  uploadForTeamMember(
    @Param("id") id: string,
    @ZodBody(uploadFileSchema) body: UploadFileInput,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException("Choose a file to upload");
    return this.files.upload(
      "team_member",
      uuidSchema.parse(id),
      body,
      file,
      actor,
    );
  }

  @Get("transaction/:id")
  @RequirePermission("transactions.read")
  listForTransaction(
    @Param("id") id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.files.listFor("transaction", uuidSchema.parse(id), actor);
  }

  @Post("transaction/:id")
  @RequirePermission("transactions.write")
  @upload()
  uploadForTransaction(
    @Param("id") id: string,
    @ZodBody(uploadFileSchema) body: UploadFileInput,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException("Choose a file to upload");
    return this.files.upload(
      "transaction",
      uuidSchema.parse(id),
      body,
      file,
      actor,
    );
  }

  /**
   * The company's signature. One owner, one row, so the id is not in the path —
   * `app_settings` has exactly one and putting a 1 in the URL would invite
   * somebody to try a 2.
   */
  @Get("signature")
  @RequirePermission("settings.read")
  listSignature(@CurrentUser() actor: AuthenticatedUser) {
    return this.files.listFor("settings", "1", actor);
  }

  @Post("signature")
  @RequirePermission("settings.write")
  @upload()
  uploadSignature(
    @ZodBody(uploadFileSchema) body: UploadFileInput,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException("Choose a file to upload");
    return this.files.upload("settings", "1", body, file, actor);
  }

  @Get("subscription/:id")
  @RequirePermission("vendors.read")
  listForSubscription(
    @Param("id") id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.files.listFor("subscription", uuidSchema.parse(id), actor);
  }

  @Post("subscription/:id")
  @RequirePermission("vendors.write")
  @upload()
  uploadForSubscription(
    @Param("id") id: string,
    @ZodBody(uploadFileSchema) body: UploadFileInput,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException("Choose a file to upload");
    return this.files.upload(
      "subscription",
      uuidSchema.parse(id),
      body,
      file,
      actor,
    );
  }

  /**
   * The A-Challan's scan.
   *
   * Routes here are written one per owner rather than one generic `:owner`
   * segment, so each carries its own permission in the decorator where a
   * reader can see it — and so a new owner cannot arrive with nobody having
   * decided who may read it.
   */
  @Get("tds_deposit/:id")
  @RequirePermission("tds.read")
  listForDeposit(
    @Param("id") id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.files.listFor("tds_deposit", uuidSchema.parse(id), actor);
  }

  @Post("tds_deposit/:id")
  @RequirePermission("tds.write")
  @upload()
  uploadForDeposit(
    @Param("id") id: string,
    @ZodBody(uploadFileSchema) body: UploadFileInput,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException("Choose a file to upload");
    return this.files.upload(
      "tds_deposit",
      uuidSchema.parse(id),
      body,
      file,
      actor,
    );
  }

  @Get("import-batch/:id")
  @RequirePermission("imports.run")
  listForImportBatch(
    @Param("id") id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.files.listFor("import_batch", uuidSchema.parse(id), actor);
  }

  /* --- the bytes --------------------------------------------------------- */

  /**
   * No `@RequirePermission` here, and that is not an oversight.
   *
   * What this route needs depends on what the file is attached to — a receipt
   * wants `transactions.read`, a CV wants `team.read`, an appointment letter
   * wants `team.compensation.read` on top. A decorator is fixed at class-load
   * time and cannot ask. `FilesService.open` looks the row up and applies the
   * owner's own permission, which is also the only place that logic exists.
   *
   * Authentication still applies: JwtAuthGuard runs on every route that is not
   * `@Public()`, and this one is not.
   */
  @Get(":id/content")
  async content(
    @Param("id") id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Res({ passthrough: true }) res: Response,
    /**
     * `?inline=1` asks for the file to be displayed rather than saved.
     *
     * The viewer in the app passes it so a document can be read without
     * landing in the Downloads folder first. The download button does not, so
     * the same file can still be saved deliberately.
     *
     * A PDF shown this way runs inside the browser's own viewer, which is
     * sandboxed away from the page embedding it — it cannot reach this
     * origin's cookies or DOM. Images were always shown inline.
     */
    @Query("inline") inlineParam?: string,
  ): Promise<StreamableFile> {
    const { row, stream } = await this.files.open(uuidSchema.parse(id), actor);

    const inline = isImageMime(row.mimeType) || inlineParam === "1";

    res.set({
      "Content-Type": row.mimeType,
      "Content-Length": String(row.sizeBytes),
      /**
       * Images always render in place, because that is what a photograph is
       * for. Everything else downloads unless the caller asked to view it, so
       * a document opened in the app's viewer is read rather than saved, and
       * the download button beside it still saves.
       */
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${row.originalName}"; filename*=UTF-8''${encodeURIComponent(row.originalName)}`,
      /**
       * The stored type was decided by reading the bytes, so it is safe to
       * send — but only if the browser is told to believe it rather than
       * guessing from content it might read differently.
       */
      "X-Content-Type-Options": "nosniff",
      /**
       * `private`, so no proxy or shared cache keeps a scan of somebody's
       * national ID. Short, so a replaced photo does not linger on screen.
       */
      "Cache-Control": "private, max-age=300",
      /**
       * Overriding helmet, which sets `same-origin` on everything.
       *
       * This is the one route whose response is loaded by another origin as a
       * subresource: the app is app.hellonizam.com and this is
       * api.hellonizam.com, so an `<img>` on a profile is cross-origin. Under
       * `same-origin` the browser fetches the bytes, answers 200, and then
       * refuses to hand them to the page — a broken image with a successful
       * request behind it, which is what a profile photograph looked like on
       * 2026-08-16 and why it took a header dump to find.
       *
       * `same-site`, not `cross-origin`: hellonizam.com may embed these, and
       * nothing else may. A scan of somebody's national ID should still be
       * unusable from a page somebody else controls.
       */
      "Cross-Origin-Resource-Policy": "same-site",
    });

    return new StreamableFile(stream);
  }

  @Delete(":id")
  @HttpCode(204)
  async remove(
    @Param("id") id: string,
    @CurrentUser() actor: AuthenticatedUser,
  ): Promise<void> {
    await this.files.remove(uuidSchema.parse(id), actor);
  }
}
