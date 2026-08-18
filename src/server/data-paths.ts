import { chmodSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

export type DataPaths = {
  dataDirectory: string;
  databasePath: string;
  backupDirectory: string;
  manageDataDirectoryPermissions: boolean;
  storageLocation: "default_local" | "configured";
};

type DataPathOptions = {
  environment?: {
    NODE_ENV?: string;
    PFF_DATA_DIR?: string;
    PFF_DATABASE_PATH?: string;
  };
  homeDirectory?: string;
  platform?: NodeJS.Platform;
};

function expandHomeDirectory(value: string, homeDirectory: string): string {
  if (value === "~") {
    return homeDirectory;
  }

  return value.startsWith("~/") ? join(homeDirectory, value.slice(2)) : value;
}

export function resolveDataPaths({
  environment = process.env,
  homeDirectory = homedir(),
  platform = process.platform,
}: DataPathOptions = {}): DataPaths {
  const rawDatabasePath = environment.PFF_DATABASE_PATH?.trim();
  const rawDataDirectory = environment.PFF_DATA_DIR?.trim();
  const explicitDatabasePath = rawDatabasePath
    ? expandHomeDirectory(rawDatabasePath, homeDirectory)
    : undefined;
  const explicitDataDirectory = rawDataDirectory
    ? expandHomeDirectory(rawDataDirectory, homeDirectory)
    : undefined;
  const environmentSuffix =
    environment.NODE_ENV === "development"
      ? " Development"
      : environment.NODE_ENV === "test"
        ? " Test"
        : "";

  const defaultDataDirectory =
    platform === "darwin"
      ? join(
          homeDirectory,
          "Library",
          "Application Support",
          `Project Financial Freedom${environmentSuffix}`,
        )
      : join(
          homeDirectory,
          ".local",
          "share",
          `project-financial-freedom${environmentSuffix.toLowerCase().replace(" ", "-")}`,
        );

  const databasePath = explicitDatabasePath
    ? resolve(explicitDatabasePath)
    : join(
        explicitDataDirectory ? resolve(explicitDataDirectory) : defaultDataDirectory,
        "project-financial-freedom.sqlite",
      );
  const dataDirectory = dirname(databasePath);
  const manageDataDirectoryPermissions =
    !explicitDatabasePath && !explicitDataDirectory;

  return {
    dataDirectory,
    databasePath,
    backupDirectory: explicitDatabasePath
      ? join(dataDirectory, `${basename(databasePath)}.backups`)
      : join(dataDirectory, "backups"),
    manageDataDirectoryPermissions,
    storageLocation:
      explicitDatabasePath || explicitDataDirectory ? "configured" : "default_local",
  };
}

export function ensureDataDirectories(paths: DataPaths): void {
  const dataDirectoryExisted = existsSync(paths.dataDirectory);

  mkdirSync(paths.dataDirectory, { mode: 0o700, recursive: true });

  if (!dataDirectoryExisted || paths.manageDataDirectoryPermissions) {
    chmodSync(paths.dataDirectory, 0o700);
  }

  mkdirSync(paths.backupDirectory, { mode: 0o700, recursive: true });
  chmodSync(paths.backupDirectory, 0o700);
}
