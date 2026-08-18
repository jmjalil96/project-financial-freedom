import { chmodSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { ensureDataDirectories, resolveDataPaths } from "@/server/data-paths";

describe("resolveDataPaths", () => {
  it("uses macOS Application Support for production data", () => {
    const paths = resolveDataPaths({
      environment: { NODE_ENV: "production" },
      homeDirectory: "/Users/tester",
      platform: "darwin",
    });

    expect(paths.dataDirectory).toBe(
      "/Users/tester/Library/Application Support/Project Financial Freedom",
    );
    expect(paths.databasePath).toBe(
      join(paths.dataDirectory, "project-financial-freedom.sqlite"),
    );
    expect(paths.backupDirectory).toBe(join(paths.dataDirectory, "backups"));
  });

  it("keeps development data separate from production", () => {
    const paths = resolveDataPaths({
      environment: { NODE_ENV: "development" },
      homeDirectory: "/Users/tester",
      platform: "darwin",
    });

    expect(paths.dataDirectory).toBe(
      "/Users/tester/Library/Application Support/Project Financial Freedom Development",
    );
  });

  it("keeps test data separate from production by default", () => {
    const paths = resolveDataPaths({
      environment: { NODE_ENV: "test" },
      homeDirectory: "/Users/tester",
      platform: "darwin",
    });

    expect(paths.dataDirectory).toBe(
      "/Users/tester/Library/Application Support/Project Financial Freedom Test",
    );
  });

  it("accepts an isolated data directory override", () => {
    const paths = resolveDataPaths({
      environment: {
        NODE_ENV: "test",
        PFF_DATA_DIR: "./temporary-finance-data",
      },
      homeDirectory: "/Users/tester",
      platform: "darwin",
    });

    expect(paths.dataDirectory).toBe(resolve("./temporary-finance-data"));
    expect(paths.databasePath).toBe(
      join(paths.dataDirectory, "project-financial-freedom.sqlite"),
    );
  });

  it("expands a leading home-directory shorthand in overrides", () => {
    const paths = resolveDataPaths({
      environment: {
        PFF_DATA_DIR: "~/private-finance",
      },
      homeDirectory: "/Users/tester",
      platform: "darwin",
    });

    expect(paths.dataDirectory).toBe("/Users/tester/private-finance");
  });

  it("gives an explicit database path precedence", () => {
    const paths = resolveDataPaths({
      environment: {
        PFF_DATA_DIR: "./ignored",
        PFF_DATABASE_PATH: "./isolated/custom.sqlite",
      },
      homeDirectory: "/Users/tester",
      platform: "darwin",
    });

    expect(paths.databasePath).toBe(resolve("./isolated/custom.sqlite"));
    expect(paths.dataDirectory).toBe(resolve("./isolated"));
    expect(paths.backupDirectory).toBe(
      join(paths.dataDirectory, "custom.sqlite.backups"),
    );
    expect(paths.manageDataDirectoryPermissions).toBe(false);
  });

  it("does not chmod an existing parent of an explicit database path", () => {
    const parent = mkdtempSync(join(tmpdir(), "pff-explicit-parent-"));

    try {
      chmodSync(parent, 0o755);
      const paths = resolveDataPaths({
        environment: {
          NODE_ENV: "test",
          PFF_DATABASE_PATH: join(parent, "custom.sqlite"),
        },
      });

      ensureDataDirectories(paths);

      expect(statSync(parent).mode & 0o777).toBe(0o755);
      expect(statSync(paths.backupDirectory).mode & 0o777).toBe(0o700);
    } finally {
      chmodSync(parent, 0o700);
      rmSync(parent, { force: true, recursive: true });
    }
  });

  it("does not chmod an existing configured data directory", () => {
    const directory = mkdtempSync(join(tmpdir(), "pff-configured-data-"));

    try {
      chmodSync(directory, 0o755);
      const paths = resolveDataPaths({
        environment: {
          NODE_ENV: "test",
          PFF_DATA_DIR: directory,
        },
      });

      ensureDataDirectories(paths);

      expect(statSync(directory).mode & 0o777).toBe(0o755);
      expect(statSync(paths.backupDirectory).mode & 0o777).toBe(0o700);
    } finally {
      chmodSync(directory, 0o700);
      rmSync(directory, { force: true, recursive: true });
    }
  });
});
