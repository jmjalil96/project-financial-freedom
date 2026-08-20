import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { getDatabaseContext } from "@/db/client";
import { createDatabaseBackup } from "@/server/database-backup";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  const context = await getDatabaseContext();
  const path = await createDatabaseBackup(context.raw, context.paths, "manual");
  const bytes = await readFile(path);
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Cache-Control": "no-store, max-age=0",
      "Content-Disposition": `attachment; filename="${basename(path)}"`,
      "Content-Length": String(bytes.byteLength),
      "Content-Type": "application/vnd.sqlite3",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
