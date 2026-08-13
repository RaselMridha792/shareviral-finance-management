import { Global, Module, OnApplicationShutdown } from "@nestjs/common";

import { closeDb } from "./index";
import { DbService } from "./db.service";

/**
 * Global so services can inject DbService without importing this module
 * everywhere. Owns the pool's lifecycle.
 */
@Global()
@Module({
  providers: [DbService],
  exports: [DbService],
})
export class DbModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await closeDb();
  }
}
