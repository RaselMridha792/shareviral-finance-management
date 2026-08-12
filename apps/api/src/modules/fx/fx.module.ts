import { Module } from "@nestjs/common";

import { SettingsModule } from "../settings/settings.module";
import { FxController } from "./fx.controller";
import { FxService } from "./fx.service";

@Module({
  imports: [SettingsModule],
  controllers: [FxController],
  providers: [FxService],
  exports: [FxService],
})
export class FxModule {}
