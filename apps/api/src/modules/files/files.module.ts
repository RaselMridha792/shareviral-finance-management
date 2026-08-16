import { Module } from "@nestjs/common";

import { FilesController } from "./files.controller";
import { FilesService } from "./files.service";
import { StorageService } from "./storage.service";

@Module({
  controllers: [FilesController],
  providers: [FilesService, StorageService],
  // Exported so team-members and transactions can attach a file's summary to
  // their own responses without a second round trip from the browser.
  exports: [FilesService, StorageService],
})
export class FilesModule {}
