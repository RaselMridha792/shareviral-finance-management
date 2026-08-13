import { Controller, Get } from "@nestjs/common";
import { sql } from "drizzle-orm";

import { Public } from "../../common/decorators/auth.decorators";
import { DbService } from "../../db/db.service";

@Controller("health")
export class HealthController {
  constructor(private readonly db: DbService) {}

  /**
   * Public liveness check for monitoring and deploy scripts. Deliberately says
   * nothing beyond "the process is up".
   */
  @Public()
  @Get()
  check() {
    return { status: "ok", service: "sfm-api" };
  }

  /**
   * Requires a signed-in user: the failure path returns the driver's error
   * message, which can name the host, database, and user.
   */
  @Get("db")
  async database() {
    if (!this.db.configured) {
      return {
        status: "not_configured",
        message: "DATABASE_URL is not set in apps/api/.env",
      };
    }
    try {
      const result = await this.db.client.execute(sql`select now() as now`);
      const now =
        (result.rows?.[0] as { now?: string } | undefined)?.now ?? null;
      return { status: "ok", database: "postgres", now };
    } catch (error) {
      return {
        status: "error",
        message: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }
}
