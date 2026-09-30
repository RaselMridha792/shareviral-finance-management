import { Module } from "@nestjs/common";

import { NotificationsModule } from "../notifications/notifications.module";
import { TransactionsModule } from "../transactions/transactions.module";
import { HrBudgetController } from "./hr-budget.controller";
import { HrBudgetService } from "./hr-budget.service";

@Module({
  imports: [NotificationsModule, TransactionsModule],
  controllers: [HrBudgetController],
  providers: [HrBudgetService],
})
export class HrBudgetModule {}
