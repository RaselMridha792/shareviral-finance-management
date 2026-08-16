import { Module } from "@nestjs/common";

import { FilesModule } from "../files/files.module";
import { ImportsController } from "./imports.controller";
import { ImportsService } from "./imports.service";

@Module({
  // For keeping the spreadsheet that was actually uploaded, beside the rows
  // this module read out of it.
  imports: [FilesModule],
  controllers: [ImportsController],
  providers: [ImportsService],
  exports: [ImportsService],
})
export class ImportsModule {}
