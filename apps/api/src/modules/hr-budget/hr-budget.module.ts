import { Module } from "@nestjs/common";

import { TransactionsModule } from "../transactions/transactions.module";
import { HrBudgetController } from "./hr-budget.controller";
import { HrBudgetService } from "./hr-budget.service";

@Module({
  imports: [TransactionsModule],
  controllers: [HrBudgetController],
  providers: [HrBudgetService],
})
export class HrBudgetModule {}
