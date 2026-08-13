import { Module } from "@nestjs/common";

import { FxModule } from "../fx/fx.module";
import { SettingsModule } from "../settings/settings.module";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";
import { OverviewService } from "./overview.service";

@Module({
  imports: [SettingsModule, FxModule],
  controllers: [ReportsController],
  providers: [ReportsService, OverviewService],
  exports: [ReportsService, OverviewService],
})
export class ReportsModule {}
