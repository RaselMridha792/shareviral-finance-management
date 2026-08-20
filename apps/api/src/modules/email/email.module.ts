import { Module } from "@nestjs/common";

import { DbModule } from "../../db/db.module";
import { EmailController } from "./email.controller";
import { EmailService } from "./email.service";
import { RenewalReminderService } from "./renewal-reminder.service";

/**
 * Mail, and the one job that sends any.
 *
 * `ScheduleModule.forRoot()` is registered in the app module rather than here —
 * a scheduler is process-wide, and two of them is two of every cron.
 */
@Module({
  imports: [DbModule],
  controllers: [EmailController],
  providers: [EmailService, RenewalReminderService],
  exports: [EmailService],
})
export class EmailModule {}
