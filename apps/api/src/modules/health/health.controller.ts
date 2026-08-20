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
    return {
      status: "ok",
      service: "sfm-api",
      /**
       * The commit this build came from, baked in by the Dockerfile.
       *
       * It is here so a deploy can be verified instead of assumed. The
       * pipeline pushes an image and then waits for this to name the commit it
       * just built — "deployed" then means the new code is answering requests,
       * rather than that a command exited 0, which it did on the evening this
       * stack was green and down.
       *
       * "unknown" outside Docker, which is every developer's machine.
       */
      version: process.env.GIT_SHA ?? "unknown",
    };
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
