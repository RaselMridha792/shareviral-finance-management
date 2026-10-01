import { Module } from "@nestjs/common";

import { HrWebhookModule } from "../hr-webhook/hr-webhook.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { TransactionsModule } from "../transactions/transactions.module";
import { HrBudgetController } from "./hr-budget.controller";
import { HrBudgetService } from "./hr-budget.service";

@Module({
  imports: [NotificationsModule, TransactionsModule, HrWebhookModule],
  controllers: [HrBudgetController],
  providers: [HrBudgetService],
})
export class HrBudgetModule {}
