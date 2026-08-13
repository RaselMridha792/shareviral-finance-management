import { Module } from "@nestjs/common";

import { ImportsModule } from "../imports/imports.module";
import { AiAttachmentsService } from "./ai-attachments.service";
import { AiChatsService } from "./ai-chats.service";
import { AiIntakeController } from "./ai-intake.controller";
import { AiIntakeService } from "./ai-intake.service";
import { AiToolsService } from "./ai-tools";

@Module({
  // The assistant hands an attached file to the same import pipeline the
  // Import screen uses, rather than growing a second way into the ledger.
  imports: [ImportsModule],
  controllers: [AiIntakeController],
  providers: [
    AiIntakeService,
    AiToolsService,
    AiChatsService,
    AiAttachmentsService,
  ],
})
export class AiIntakeModule {}
