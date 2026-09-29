import { Module } from "@nestjs/common";

import { BankAdvicesController } from "./bank-advices.controller";
import { BankAdvicesService } from "./bank-advices.service";

@Module({
  controllers: [BankAdvicesController],
  providers: [BankAdvicesService],
})
export class BankAdvicesModule {}
