import { Injectable, ServiceUnavailableException } from "@nestjs/common";

import {
  getDb,
  isDatabaseConfigured,
  type Database,
  type DbTransaction,
} from "./index";

/**
 * Injectable wrapper around the lazy Drizzle client.
 *
 * Services depend on this rather than importing `getDb()` directly, so tests
 * can substitute a client and so a missing DATABASE_URL surfaces as a 503
 * rather than an unhandled throw.
 */
@Injectable()
export class DbService {
  get configured(): boolean {
    return isDatabaseConfigured();
  }

  get client(): Database {
    if (!isDatabaseConfigured()) {
      throw new ServiceUnavailableException(
        "Database is not configured. Set DATABASE_URL in apps/api/.env",
      );
    }
    return getDb();
  }

  /** Runs `fn` inside a transaction; rolls back if it throws. */
  transaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
    return this.client.transaction(fn);
  }
}
