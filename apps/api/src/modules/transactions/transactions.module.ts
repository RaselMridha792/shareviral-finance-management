import { Module } from "@nestjs/common";

import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { VendorsModule } from "../vendors/vendors.module";
import { TransactionsController } from "./transactions.controller";
import { TransactionsService } from "./transactions.service";

/*
 * `SubscriptionsModule` imports nothing, so this direction is safe. The
 * reverse is not: injecting TransactionsService into a module this one already
 * imports is a cycle Nest refuses to start with, which is why paying for a
 * plan is written on the transactions side rather than the subscriptions one.
 */
@Module({
  imports: [SubscriptionsModule, VendorsModule],
  controllers: [TransactionsController],
  providers: [TransactionsService],
  exports: [TransactionsService],
})
export class TransactionsModule {}
