import "server-only";

import type { DatabaseContext } from "@/db/runtime";
import { initializeDatabase } from "@/db/runtime";
import { resolveDataPaths, type DataPaths } from "@/server/data-paths";

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

export async function closeDatabaseContext(): Promise<void> {
  const current = globalThis.__pffDatabaseContext;
  globalThis.__pffDatabaseContext = undefined;
  if (!current) {
    return;
  }
  try {
    const context = await current;
    if (context.raw.open) {
      context.raw.close();
    }
  } catch {
    // A failed initialization owns no usable connection, and the cached promise is
    // already cleared so the caller can recover the database file.
  }
}

export async function reinitializeDatabaseContext(
  paths: DataPaths,
): Promise<DatabaseContext> {
  await closeDatabaseContext();
  const next = initializeDatabase({ paths });
  globalThis.__pffDatabaseContext = next;
  return next;
}
