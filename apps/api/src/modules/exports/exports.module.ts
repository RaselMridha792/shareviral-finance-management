import { Module } from "@nestjs/common";

import { AccountsModule } from "../accounts/accounts.module";
import { IncomeTaxModule } from "../income-tax/income-tax.module";
import { ReportsModule } from "../reports/reports.module";
import { SettingsModule } from "../settings/settings.module";
import { TdsModule } from "../tds/tds.module";
import { TransactionsModule } from "../transactions/transactions.module";
import { ExcelService } from "./excel.service";
import { ExportsController } from "./exports.controller";
import { PdfService } from "./pdf.service";

@Module({
  imports: [
    TransactionsModule,
    AccountsModule,
    // The PDF must show the same figures as the screen, so it asks the same
    // service rather than recomputing them.
    ReportsModule,
    SettingsModule,
    TdsModule,
    IncomeTaxModule,
  ],
  controllers: [ExportsController],
  providers: [ExcelService, PdfService],
  exports: [ExcelService],
})
export class ExportsModule {}
