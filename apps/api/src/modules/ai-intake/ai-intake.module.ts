import { Module } from "@nestjs/common";

import { ImportsModule } from "../imports/imports.module";
import { SubscriptionsModule } from "../subscriptions/subscriptions.module";
import { TdsModule } from "../tds/tds.module";
import { TeamMembersModule } from "../team-members/team-members.module";
import { TransactionsModule } from "../transactions/transactions.module";
import { VendorsModule } from "../vendors/vendors.module";
import { AiAttachmentsService } from "./ai-attachments.service";
import { AiChatsService } from "./ai-chats.service";
import { AiConfirmService } from "./ai-confirm.service";
import { AiIntakeController } from "./ai-intake.controller";
import { AiIntakeService } from "./ai-intake.service";
import { AiToolsService } from "./ai-tools";

@Module({
  // The assistant hands an attached file to the same import pipeline the
  // Import screen uses, rather than growing a second way into the ledger.
  // And a confirmed draft to the same services the forms' endpoints call
  // (A4): no second way in there either.
  imports: [
    ImportsModule,
    TransactionsModule,
    SubscriptionsModule,
    VendorsModule,
    TeamMembersModule,
    TdsModule,
  ],
  controllers: [AiIntakeController],
  providers: [
    AiIntakeService,
    AiToolsService,
    AiChatsService,
    AiAttachmentsService,
    AiConfirmService,
  ],
})
export class AiIntakeModule {}
