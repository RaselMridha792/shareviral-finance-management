import { Module } from "@nestjs/common";

import { AiUsageService } from "./ai-usage.service";

/**
 * What the Assistant spends (B3), in a module of its own: the Assistant's
 * turns and readings keep their counts through it, and so do the Google
 * Cloud key's Tests under Connections, which cannot import the Assistant's
 * module without a circle.
 */
@Module({
  providers: [AiUsageService],
  exports: [AiUsageService],
})
export class AiUsageModule {}
