import { Module } from "@nestjs/common";

import { AccountsController } from "./accounts.controller";
import { AccountsService } from "./accounts.service";
import { BankStatusService } from "./bank-status.service";
import { CardPasswordService } from "./card-password.service";
import { CardSecretsService } from "./card-secrets.service";

@Module({
  controllers: [AccountsController],
  providers: [
    AccountsService,
    BankStatusService,
    CardPasswordService,
    CardSecretsService,
  ],
  exports: [AccountsService],
})
export class AccountsModule {}
