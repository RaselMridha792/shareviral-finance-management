import { Module } from "@nestjs/common";

import { AccountsModule } from "../accounts/accounts.module";
import { IncomeTaxModule } from "../income-tax/income-tax.module";
import { PayrollModule } from "../payroll/payroll.module";
import { ReportsModule } from "../reports/reports.module";
import { SettingsModule } from "../settings/settings.module";
import { TdsModule } from "../tds/tds.module";
import { TeamMembersModule } from "../team-members/team-members.module";
import { TransactionsModule } from "../transactions/transactions.module";
import { VendorsModule } from "../vendors/vendors.module";
import { ExcelService } from "./excel.service";
import { ExportsController } from "./exports.controller";
import { PdfService } from "./pdf.service";

@Module({
  imports: [
    TransactionsModule,
    AccountsModule,
    // Every sheet comes from the service the matching screen already calls, so
    // a download shows the same figures and carries the same projection.
    ReportsModule,
    SettingsModule,
    TdsModule,
    IncomeTaxModule,
    PayrollModule,
    TeamMembersModule,
    VendorsModule,
  ],
  controllers: [ExportsController],
  providers: [ExcelService, PdfService],
  exports: [ExcelService],
})
export class ExportsModule {}
