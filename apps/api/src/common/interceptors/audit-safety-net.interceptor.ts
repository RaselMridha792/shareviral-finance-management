import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import type { Request } from "express";
import type { Observable } from "rxjs";
import { tap } from "rxjs/operators";

import { AuditService } from "../audit/audit.service";
import { getRequestContext } from "../context/request-context";

/**
 * Modules whose writes must never be invisible.
 */
const MONEY_MODULES = [
  "transactions",
  "accounts",
  "payroll",
  "team-members",
  "tds",
  "income-tax",
  "vendors",
  "categories",
  "settings",
  "users",
  "imports",
  "fx",
];

/**
 * The backstop for a forgotten `auditService` call.
 *
 * `AuditService.mutate()` is the intended path and writes a proper before/after
 * diff. If a handler mutates something in a money module and no audit row was
 * written, this records a coarse envelope instead — actor, route, params — so
 * the change is at least traceable. It is not a substitute for the real thing;
 * a row appearing here means a service is missing its audit call.
 */
@Injectable()
export class AuditSafetyNetInterceptor implements NestInterceptor {
  private readonly logger = new Logger("AuditSafetyNet");

  constructor(private readonly audit: AuditService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const method = request.method;

    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return next.handle();
    }

    const path = request.originalUrl ?? request.url;
    const module = MONEY_MODULES.find((m) => path.includes(`/${m}`));
    if (!module) return next.handle();

    return next.handle().pipe(
      tap({
        next: () => {
          const ctx = getRequestContext();
          if (ctx?.auditWritten) return;

          this.logger.warn(
            `No audit row for ${method} ${path} — the service should call AuditService.mutate()`,
          );

          void this.audit
            .log({
              action: "update",
              entityTable: module,
              summary: `${method} ${path} (envelope only — no service-level audit)`,
              after: {
                params: request.params,
                query: request.query,
              },
              module,
            })
            .catch((error: unknown) => {
              this.logger.error(
                `Safety-net audit write failed: ${
                  error instanceof Error ? error.message : String(error)
                }`,
              );
            });
        },
      }),
    );
  }
}
