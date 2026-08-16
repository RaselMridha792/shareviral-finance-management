import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";

import { CommonModule } from "./common/common.module";
import { CsrfGuard } from "./common/guards/csrf.guard";
import { JwtAuthGuard } from "./common/guards/jwt-auth.guard";
import { PermissionsGuard } from "./common/guards/permissions.guard";
import { AuditSafetyNetInterceptor } from "./common/interceptors/audit-safety-net.interceptor";
import { validateEnv } from "./config/env";
import { DbModule } from "./db/db.module";
import { AccountsModule } from "./modules/accounts/accounts.module";
import { AiIntakeModule } from "./modules/ai-intake/ai-intake.module";
import { AuditLogModule } from "./modules/audit/audit-log.module";
import { AuthModule } from "./modules/auth/auth.module";
import { CategoriesModule } from "./modules/categories/categories.module";
import { ExportsModule } from "./modules/exports/exports.module";
import { FilesModule } from "./modules/files/files.module";
import { FxModule } from "./modules/fx/fx.module";
import { HealthModule } from "./modules/health/health.module";
import { ImportsModule } from "./modules/imports/imports.module";
import { IncomeTaxModule } from "./modules/income-tax/income-tax.module";
import { PayrollModule } from "./modules/payroll/payroll.module";
import { ReportsModule } from "./modules/reports/reports.module";
import { TdsModule } from "./modules/tds/tds.module";
import { SettingsModule } from "./modules/settings/settings.module";
import { TeamMembersModule } from "./modules/team-members/team-members.module";
import { TransactionsModule } from "./modules/transactions/transactions.module";
import { UsersModule } from "./modules/users/users.module";
import { VendorsModule } from "./modules/vendors/vendors.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env.local", ".env"],
      validate: validateEnv,
    }),
    DbModule,
    CommonModule,
    AuthModule,
    HealthModule,
    UsersModule,
    SettingsModule,
    AccountsModule,
    CategoriesModule,
    VendorsModule,
    TransactionsModule,
    ExportsModule,
    ImportsModule,
    FilesModule,
    TeamMembersModule,
    PayrollModule,
    TdsModule,
    IncomeTaxModule,
    FxModule,
    ReportsModule,
    AuditLogModule,
    AiIntakeModule,
  ],
  providers: [
    // Order matters: reject cross-site writes, then authenticate, then check
    // what the authenticated role may do.
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditSafetyNetInterceptor },
  ],
})
export class AppModule {}
