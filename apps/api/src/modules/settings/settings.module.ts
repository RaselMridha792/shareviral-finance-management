import { Global, Module } from "@nestjs/common";

import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";

/**
 * Global because every money-writing service needs `assertPeriodOpen` before
 * it saves.
 */
@Global()
@Module({
  controllers: [SettingsController],
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
