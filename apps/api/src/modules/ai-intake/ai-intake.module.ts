import { Module } from "@nestjs/common";

import { AiIntakeController } from "./ai-intake.controller";
import { AiIntakeService } from "./ai-intake.service";

@Module({
  controllers: [AiIntakeController],
  providers: [AiIntakeService],
})
export class AiIntakeModule {}
