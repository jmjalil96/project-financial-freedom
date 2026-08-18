import type { BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import type * as schema from "@/db/schema";

export type AppDatabase = BetterSQLite3Database<typeof schema>;
export type AppTransaction = Parameters<Parameters<AppDatabase["transaction"]>[0]>[0];
