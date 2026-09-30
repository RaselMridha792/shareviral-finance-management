import { Module } from "@nestjs/common";

import { NotificationsModule } from "../notifications/notifications.module";
import { PayrollModule } from "../payroll/payroll.module";
import { TeamMembersModule } from "../team-members/team-members.module";
import { HrRequestsController } from "./hr-requests.controller";
import { HrRequestsService } from "./hr-requests.service";

/**
 * HR Requests (#125). Team members for the one door that writes a salary;
 * payroll for putting an approved one-off on a draft sheet; notifications
 * for the bell.
 */
@Module({
  imports: [NotificationsModule, PayrollModule, TeamMembersModule],
  controllers: [HrRequestsController],
  providers: [HrRequestsService],
})
export class HrRequestsModule {}
