import { app } from "electron";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import path from "node:path";

interface LibrarySettings {
  libraryRoot: string;
}

let cachedLibraryRoot: string | null = null;

function getSettingsPath(): string {
  return path.join(
    app.getPath("userData"),
    "library-settings.json"
  );
}

export function getDefaultLibraryRoot(): string {
  return path.join(
    app.getPath("documents"),
    "EntoLib",
    "library"
  );
}

function readConfiguredLibraryRoot(): string | null {
  const settingsPath = getSettingsPath();

  if (!existsSync(settingsPath)) {
    return null;
  }

  try {
    const settings = JSON.parse(
      readFileSync(settingsPath, "utf8")
    ) as Partial<LibrarySettings>;

    if (
      typeof settings.libraryRoot === "string" &&
      settings.libraryRoot.trim()
    ) {
      return path.resolve(settings.libraryRoot.trim());
    }
  } catch (error) {
    console.error(
      "Failed to read library settings:",
      error
    );
  }

  return null;
}

export function getLibraryRoot(): string {
  if (cachedLibraryRoot) {
    return cachedLibraryRoot;
  }

  cachedLibraryRoot =
    readConfiguredLibraryRoot() ??
    getDefaultLibraryRoot();

  return cachedLibraryRoot;
}

export function getLibraryDatabasePath(): string {
  return path.join(
    getLibraryRoot(),
    "entolib.db"
  );
}

export function getLibraryPdfDirectory(): string {
  return path.join(
    getLibraryRoot(),
    "pdfs"
  );
}

export function getLibraryBackupDirectory(): string {
  return path.join(
    getLibraryRoot(),
    "backups"
  );
}

export function ensureLibraryDirectories(): void {
  mkdirSync(getLibraryRoot(), {
    recursive: true
  });

  mkdirSync(getLibraryPdfDirectory(), {
    recursive: true
  });

  mkdirSync(getLibraryBackupDirectory(), {
    recursive: true
  });
}

function getLegacyDatabaseCandidates(): string[] {
  return Array.from(
    new Set([
      path.join(
        process.cwd(),
        "database",
        "entolib.db"
      ),
      path.join(
        path.dirname(process.execPath),
        "database",
        "entolib.db"
      ),
      path.join(
        app.getPath("userData"),
        "database",
        "entolib.db"
      ),
      path.join(
        app.getPath("documents"),
        "EntoLib",
        "database",
        "entolib.db"
      )
    ].map((candidate) => path.resolve(candidate)))
  );
}

export function migrateLegacyDatabaseIfNeeded(): void {
  const targetPath = path.resolve(
    getLibraryDatabasePath()
  );

  if (existsSync(targetPath)) {
    return;
  }

  ensureLibraryDirectories();

  for (const candidate of getLegacyDatabaseCandidates()) {
    if (
      candidate === targetPath ||
      !existsSync(candidate)
    ) {
      continue;
    }

    copyFileSync(candidate, targetPath);

    console.log(
      "Migrated legacy EntoLib database:",
      candidate,
      "->",
      targetPath
    );

    return;
  }
}

export function saveLibraryRoot(
  libraryRoot: string
): void {
  const trimmedRoot = libraryRoot.trim();

  if (!trimmedRoot) {
    throw new Error(
      "ライブラリ保存先が正しくありません"
    );
  }

  const resolvedRoot = path.resolve(trimmedRoot);
  const settingsPath = getSettingsPath();
  const settingsDirectory = path.dirname(
    settingsPath
  );
  mkdirSync(settingsDirectory, {
    recursive: true
  });

  writeFileSync(
    settingsPath,
    JSON.stringify(
      { libraryRoot: resolvedRoot },
      null,
      2
    ),
    "utf8"
  );

  cachedLibraryRoot = resolvedRoot;
}

export interface LibraryInfo {
  root: string;
  databasePath: string;
  pdfDirectory: string;
  backupDirectory: string;
}

export function getLibraryInfo(): LibraryInfo {
  return {
    root: getLibraryRoot(),
    databasePath: getLibraryDatabasePath(),
    pdfDirectory: getLibraryPdfDirectory(),
    backupDirectory: getLibraryBackupDirectory()
  };
}
