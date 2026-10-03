import { Module } from "@nestjs/common";

import { AiUsageModule } from "../ai-intake/ai-usage.module";
import { ConnectionsController } from "./connections.controller";
import { ConnectionsService } from "./connections.service";

/**
 * Outside services the app reaches with a stored key. Google Cloud first
 * (#131): Claude through Vertex AI, and the Sheets and Docs shared with it.
 */
@Module({
  // The Test button asks each model once, and that is counted (B3).
  imports: [AiUsageModule],
  controllers: [ConnectionsController],
  providers: [ConnectionsService],
})
export class ConnectionsModule {}
