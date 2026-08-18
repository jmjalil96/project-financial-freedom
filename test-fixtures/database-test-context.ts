import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DatabaseContext } from "@/db/runtime";
import { initializeDatabase } from "@/db/runtime";
import { resolveDataPaths } from "@/server/data-paths";

export async function createIsolatedDatabase(
  prefix: string,
): Promise<{ context: DatabaseContext; temporaryRoot: string }> {
  const temporaryRoot = mkdtempSync(join(tmpdir(), prefix));
  const paths = resolveDataPaths({
    environment: {
      NODE_ENV: "test",
      PFF_DATA_DIR: join(temporaryRoot, "data"),
    },
  });
  const context = await initializeDatabase({ paths });

  globalThis.__pffDatabaseContext = Promise.resolve(context);
  return { context, temporaryRoot };
}

export function destroyIsolatedDatabase(
  context: DatabaseContext,
  temporaryRoot: string,
): void {
  globalThis.__pffDatabaseContext = undefined;

  if (context.raw.open) {
    context.raw.close();
  }

  rmSync(temporaryRoot, { force: true, recursive: true });
}
