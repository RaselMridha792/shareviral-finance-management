import { Module } from "@nestjs/common";

import { AiIntakeController } from "./ai-intake.controller";
import { AiIntakeService } from "./ai-intake.service";
import { AiToolsService } from "./ai-tools";

@Module({
  controllers: [AiIntakeController],
  providers: [AiIntakeService, AiToolsService],
})
export class AiIntakeModule {}
