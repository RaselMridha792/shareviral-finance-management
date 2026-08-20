import { Module } from "@nestjs/common";

import { DbModule } from "../../db/db.module";
import { NotificationEventsService } from "./notification-events.service";
import { NotificationsController } from "./notifications.controller";
import { NotificationsService } from "./notifications.service";

/**
 * The bell, and the job that fills it.
 *
 * `ScheduleModule.forRoot()` stays in the app module: a scheduler is
 * process-wide, and two of them is two of every cron.
 */
@Module({
  imports: [DbModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, NotificationEventsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
