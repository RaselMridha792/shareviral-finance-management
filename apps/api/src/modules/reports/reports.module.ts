import { Module } from "@nestjs/common";

import { FxModule } from "../fx/fx.module";
import { SettingsModule } from "../settings/settings.module";
import { TdsModule } from "../tds/tds.module";
import { TransactionsModule } from "../transactions/transactions.module";
import { ReportsController } from "./reports.controller";
import { ReportsService } from "./reports.service";
import { OverviewService } from "./overview.service";
import { StatementService } from "./statement.service";

@Module({
  // The statement's ledger pages come from TransactionsService.register — the
  // same call the account screen makes, rather than a third running-balance
  // query that would eventually disagree with it.
  // TdsModule so the dashboard and the statement can ask TdsService what tax is
  // still owed rather than each keeping its own copy of that sum — which is
  // exactly how the two of them came to disagree with the TDS screen.
  imports: [SettingsModule, FxModule, TransactionsModule, TdsModule],
  controllers: [ReportsController],
  providers: [ReportsService, OverviewService, StatementService],
  exports: [ReportsService, OverviewService, StatementService],
})
export class ReportsModule {}
