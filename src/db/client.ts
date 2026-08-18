import "server-only";

import type { DatabaseContext } from "@/db/runtime";
import { initializeDatabase } from "@/db/runtime";
import { resolveDataPaths } from "@/server/data-paths";

declare global {
  var __pffDatabaseContext: Promise<DatabaseContext> | undefined;
}

export function getDatabaseContext(): Promise<DatabaseContext> {
  if (!globalThis.__pffDatabaseContext) {
    globalThis.__pffDatabaseContext = initializeDatabase({
      paths: resolveDataPaths(),
    });
  }

  return globalThis.__pffDatabaseContext;
}
