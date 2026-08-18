import { Module } from "@nestjs/common";

import { SettingsModule } from "../settings/settings.module";
import { TaxPolicyService } from "./tax-policy.service";
import { TdsController } from "./tds.controller";
import { TdsService } from "./tds.service";

@Module({
  imports: [SettingsModule],
  controllers: [TdsController],
  providers: [TdsService, TaxPolicyService],
  exports: [TdsService, TaxPolicyService],
})
export class TdsModule {}
