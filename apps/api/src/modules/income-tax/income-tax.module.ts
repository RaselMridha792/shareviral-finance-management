import { Module } from "@nestjs/common";

import { SettingsModule } from "../settings/settings.module";
import { IncomeTaxController } from "./income-tax.controller";
import { IncomeTaxService } from "./income-tax.service";

@Module({
  imports: [SettingsModule],
  controllers: [IncomeTaxController],
  providers: [IncomeTaxService],
  exports: [IncomeTaxService],
})
export class IncomeTaxModule {}
