import { defineConfig } from "drizzle-kit";

import { resolveDataPaths } from "./src/server/data-paths";

const databaseUrl = resolveDataPaths({
  environment: {
    NODE_ENV: process.env.NODE_ENV ?? "development",
    PFF_DATA_DIR: process.env.PFF_DATA_DIR,
    PFF_DATABASE_PATH: process.env.PFF_DATABASE_PATH,
  },
}).databasePath;

export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dbCredentials: {
    url: databaseUrl,
  },
  strict: true,
  verbose: true,
});
