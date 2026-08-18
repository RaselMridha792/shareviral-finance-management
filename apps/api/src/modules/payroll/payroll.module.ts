import { Module } from "@nestjs/common";

import { TdsModule } from "../tds/tds.module";
import { PayrollController } from "./payroll.controller";
import { PayrollService } from "./payroll.service";

@Module({
  // For the tax rule. Payroll works the deduction out; the rule itself is the
  // tax module's, so there is one place a rate can come from.
  imports: [TdsModule],
  controllers: [PayrollController],
  providers: [PayrollService],
  exports: [PayrollService],
})
export class PayrollModule {}
