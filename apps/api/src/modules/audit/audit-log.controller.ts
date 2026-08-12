import { Controller, Get, Param } from "@nestjs/common";
import { listAuditQuerySchema, type ListAuditQuery } from "@finance/shared";

import {
  CurrentUser,
  RequirePermission,
  type AuthenticatedUser,
} from "../../common/decorators/auth.decorators";
import { ZodQuery } from "../../common/pipes/zod-validation.pipe";
import { AuditLogService } from "./audit-log.service";

@Controller("audit")
@RequirePermission("audit.read")
export class AuditLogController {
  constructor(private readonly audit: AuditLogService) {}

  @Get()
  list(
    @ZodQuery(listAuditQuerySchema) query: ListAuditQuery,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.audit.list(query, actor);
  }

  @Get("filters")
  filters() {
    return this.audit.filters();
  }

  /** One record's whole story, for the history panel on its own screen. */
  @Get(":entityTable/:entityId")
  history(
    @Param("entityTable") entityTable: string,
    @Param("entityId") entityId: string,
    @CurrentUser() actor: AuthenticatedUser,
  ) {
    return this.audit.history(entityTable, entityId, actor);
  }
}
