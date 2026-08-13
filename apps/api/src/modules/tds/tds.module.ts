import { Module } from "@nestjs/common";

import { SettingsModule } from "../settings/settings.module";
import { TdsController } from "./tds.controller";
import { TdsService } from "./tds.service";

@Module({
  imports: [SettingsModule],
  controllers: [TdsController],
  providers: [TdsService],
  exports: [TdsService],
})
export class TdsModule {}
