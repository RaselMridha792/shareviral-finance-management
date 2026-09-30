import { Module } from "@nestjs/common";

import { NotificationsModule } from "../notifications/notifications.module";
import { TdsModule } from "../tds/tds.module";
import { PayrollOneOffsController } from "./one-offs.controller";
import { PayrollOneOffsService } from "./one-offs.service";
import { PayrollController } from "./payroll.controller";
import { PayrollService } from "./payroll.service";

@Module({
  // For the tax rule. Payroll works the deduction out; the rule itself is the
  // tax module's, so there is one place a rate can come from.
  // Notifications: a one-off from HR rings the bell (#125).
  imports: [TdsModule, NotificationsModule],
  controllers: [PayrollController, PayrollOneOffsController],
  providers: [PayrollService, PayrollOneOffsService],
  exports: [PayrollService],
})
export class PayrollModule {}
