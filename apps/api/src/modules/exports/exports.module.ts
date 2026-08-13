import { Module } from "@nestjs/common";

import { AccountsModule } from "../accounts/accounts.module";
import { TransactionsModule } from "../transactions/transactions.module";
import { ExcelService } from "./excel.service";
import { ExportsController } from "./exports.controller";

@Module({
  imports: [TransactionsModule, AccountsModule],
  controllers: [ExportsController],
  providers: [ExcelService],
  exports: [ExcelService],
})
export class ExportsModule {}
