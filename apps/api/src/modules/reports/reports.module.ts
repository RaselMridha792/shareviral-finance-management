import { Module } from "@nestjs/common";

import { FxModule } from "../fx/fx.module";
import { SettingsModule } from "../settings/settings.module";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";

@Module({
  imports: [SettingsModule, FxModule],
  controllers: [ReportsController],
  providers: [ReportsService],
  exports: [ReportsService],
})
export class ReportsModule {}
