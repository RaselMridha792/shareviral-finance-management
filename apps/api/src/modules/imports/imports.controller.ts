import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { z } from "zod";

import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ZodBody, ZodQuery } from "../../common/pipes/zod-validation.pipe";
import {
  commitSchema,
  mappingSchema,
  previewQuerySchema,
  type CommitInput,
  type MappingInput,
  type PreviewQuery,
} from "./imports.schemas";
import { ImportsService } from "./imports.service";

const uuidSchema = z.string().uuid("Not a valid id");
const MAX_FILE_BYTES = 10 * 1024 * 1024;

@Controller("imports")
@RequirePermission("imports.run")
export class ImportsController {
  constructor(private readonly imports: ImportsService) {}

  @Get()
  list() {
    return this.imports.listBatches();
  }

  @Post()
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: MAX_FILE_BYTES } }),
  )
  upload(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    if (!file) throw new BadRequestException("Choose a file to upload");

    if (!/\.(xlsx|xls|csv)$/i.test(file.originalname)) {
      throw new BadRequestException(
        "Upload an Excel file (.xlsx) or a CSV exported from your bank",
      );
    }

    return this.imports.upload(file, actor);
  }

  @Post(":id/mapping")
  @HttpCode(200)
  applyMapping(
    @Param("id") id: string,
    @ZodBody(mappingSchema) body: MappingInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.imports.applyMapping(uuidSchema.parse(id), body, actor);
  }

  @Get(":id/preview")
  preview(
    @Param("id") id: string,
    @ZodQuery(previewQuerySchema) query: PreviewQuery,
  ) {
    return this.imports.preview(uuidSchema.parse(id), query);
  }

  /** Declared after `:id/preview` so that route is not swallowed by this one. */
  @Get(":id")
  resume(@Param("id") id: string) {
    return this.imports.resume(uuidSchema.parse(id));
  }

  @Post(":id/commit")
  @HttpCode(200)
  commit(
    @Param("id") id: string,
    @ZodBody(commitSchema) body: CommitInput,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.imports.commit(uuidSchema.parse(id), body, actor);
  }

  @Post(":id/revert")
  @HttpCode(200)
  revert(@Param("id") id: string, @CurrentUser() actor: AuthenticatedUser) {
    return this.imports.revert(uuidSchema.parse(id), actor);
  }
}
