import { Global, Module } from "@nestjs/common";

import { AuditService } from "./audit/audit.service";

/** Cross-cutting services every feature module can inject. */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class CommonModule {}
