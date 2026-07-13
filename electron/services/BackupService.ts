import { app } from "electron";
import Database from "better-sqlite3";
import { createWriteStream, existsSync } from "node:fs";
import {
  access,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ZipArchive } from "archiver";
import extractZip from "extract-zip";

import { db } from "../database/DatabaseManager";
import { getPdfStorageDirectory } from "./PdfStorage";
import { getLibraryDatabasePath } from "./LibraryManager";

const BACKUP_FORMAT = "entolib-backup";
const BACKUP_VERSION = 1;

export interface BackupResult {
  success: boolean;
  canceled?: boolean;
  path?: string;
  sizeBytes?: number;
  message?: string;
}

interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  appVersion: string;
  platform: string;
  databaseFile: string;
  pdfDirectory: string;
  documentCount: number;
  taxonCount: number;
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

function getTableCount(tableName: string): number {
  const table = db
    .prepare(
      `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`
    )
    .get(tableName) as { name: string } | undefined;

  if (!table) {
    return 0;
  }

  const result = db
    .prepare(`SELECT COUNT(*) AS count FROM ${tableName}`)
    .get() as { count: number };

  return result.count;
}

async function writeBackupZip(
  destinationPath: string,
  databaseSnapshotPath: string,
  manifestPath: string,
  pdfDirectory: string
): Promise<void> {
  await mkdir(path.dirname(destinationPath), { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const output = createWriteStream(destinationPath);
    const archive = new ZipArchive({
      zlib: { level: 6 }
    });

    output.on("close", resolve);
    output.on("error", reject);

    archive.on("warning", (error) => {
      if (error.code !== "ENOENT") {
        reject(error);
      }
    });
    archive.on("error", reject);

    archive.pipe(output);
    archive.file(databaseSnapshotPath, {
      name: "database/entolib.db"
    });
    archive.file(manifestPath, {
      name: "manifest.json"
    });

    if (existsSync(pdfDirectory)) {
      archive.directory(pdfDirectory, "library/pdfs");
    } else {
      archive.append("", {
        name: "library/pdfs/.keep"
      });
    }

    void archive.finalize();
  });
}

export async function createEntoLibBackup(
  destinationPath: string
): Promise<BackupResult> {
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "entolib-backup-")
  );

  try {
    const databaseSnapshotPath = path.join(
      temporaryDirectory,
      "entolib.db"
    );
    const manifestPath = path.join(
      temporaryDirectory,
      "manifest.json"
    );

    await db.backup(databaseSnapshotPath);

    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      version: BACKUP_VERSION,
      createdAt: new Date().toISOString(),
      appVersion: app.getVersion(),
      platform: process.platform,
      databaseFile: "database/entolib.db",
      pdfDirectory: "library/pdfs",
      documentCount: getTableCount("documents"),
      taxonCount: getTableCount("taxa")
    };

    await writeFile(
      manifestPath,
      JSON.stringify(manifest, null, 2),
      "utf8"
    );

    await writeBackupZip(
      destinationPath,
      databaseSnapshotPath,
      manifestPath,
      getPdfStorageDirectory()
    );

    const backupStat = await stat(destinationPath);

    return {
      success: true,
      path: destinationPath,
      sizeBytes: backupStat.size,
      message: "バックアップを作成しました"
    };
  } finally {
    await rm(temporaryDirectory, {
      recursive: true,
      force: true
    });
  }
}

function validateManifest(value: unknown): BackupManifest {
  if (
    typeof value !== "object" ||
    value === null ||
    !("format" in value) ||
    value.format !== BACKUP_FORMAT ||
    !("version" in value) ||
    value.version !== BACKUP_VERSION
  ) {
    throw new Error(
      "このファイルは対応しているEntoLibバックアップではありません"
    );
  }

  return value as BackupManifest;
}


function portableBasename(filePath: string): string {
  return path.posix.basename(filePath.replace(/\\/g, "/"));
}

function rewriteRestoredPdfPaths(
  databasePath: string,
  restoredPdfDirectory: string,
  targetPdfDirectory: string
): void {
  const restoredDatabase = new Database(databasePath);

  try {
    const rows = restoredDatabase
      .prepare(
        "SELECT id, pdf_path FROM documents WHERE pdf_path IS NOT NULL AND pdf_path <> ''"
      )
      .all() as Array<{ id: number; pdf_path: string }>;

    const update = restoredDatabase.prepare(
      "UPDATE documents SET pdf_path = ? WHERE id = ?"
    );

    const updatePaths = restoredDatabase.transaction(() => {
      for (const row of rows) {
        const fileName = portableBasename(row.pdf_path);
        const restoredPdfPath = path.join(
          restoredPdfDirectory,
          fileName
        );

        if (existsSync(restoredPdfPath)) {
          update.run(
            path.join(targetPdfDirectory, fileName),
            row.id
          );
        }
      }
    });

    updatePaths();
  } finally {
    restoredDatabase.close();
  }
}

function validateDatabase(databasePath: string): void {
  const restoredDatabase = new Database(databasePath, {
    readonly: true,
    fileMustExist: true
  });

  try {
    const integrity = restoredDatabase
      .prepare("PRAGMA integrity_check")
      .get() as { integrity_check: string };

    if (integrity.integrity_check !== "ok") {
      throw new Error(
        `バックアップ内のデータベース検査に失敗しました: ${integrity.integrity_check}`
      );
    }

    const documentsTable = restoredDatabase
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'documents'"
      )
      .get();

    if (!documentsTable) {
      throw new Error(
        "バックアップ内にdocumentsテーブルがありません"
      );
    }
  } finally {
    restoredDatabase.close();
  }
}

export async function restoreEntoLibBackup(
  backupPath: string
): Promise<BackupResult> {
  const operationId = randomUUID();
  const temporaryDirectory = await mkdtemp(
    path.join(tmpdir(), "entolib-restore-")
  );
  const safetyDirectory = await mkdtemp(
    path.join(tmpdir(), "entolib-restore-safety-")
  );

  const currentDatabasePath = getLibraryDatabasePath();
  const currentPdfDirectory = getPdfStorageDirectory();
  const libraryDirectory = path.dirname(currentPdfDirectory);
  const stagedPdfDirectory = path.join(
    libraryDirectory,
    `.pdfs-restore-staging-${operationId}`
  );
  const previousPdfDirectory = path.join(
    libraryDirectory,
    `.pdfs-before-restore-${operationId}`
  );
  const safetyDatabasePath = path.join(
    safetyDirectory,
    "entolib-before-restore.db"
  );

  let movedPreviousPdfDirectory = false;
  let databaseClosed = false;
  let rollbackFailed = false;

  try {
    await extractZip(backupPath, {
      dir: temporaryDirectory
    });

    const manifestPath = path.join(
      temporaryDirectory,
      "manifest.json"
    );
    const restoredDatabasePath = path.join(
      temporaryDirectory,
      "database",
      "entolib.db"
    );
    const restoredPdfDirectory = path.join(
      temporaryDirectory,
      "library",
      "pdfs"
    );

    if (!(await pathExists(manifestPath))) {
      throw new Error(
        "バックアップ内にmanifest.jsonがありません"
      );
    }
    if (!(await pathExists(restoredDatabasePath))) {
      throw new Error(
        "バックアップ内にentolib.dbがありません"
      );
    }

    const manifest = validateManifest(
      JSON.parse(await readFile(manifestPath, "utf8"))
    );

    rewriteRestoredPdfPaths(
      restoredDatabasePath,
      restoredPdfDirectory,
      currentPdfDirectory
    );
    validateDatabase(restoredDatabasePath);

    await mkdir(libraryDirectory, { recursive: true });
    await rm(stagedPdfDirectory, {
      recursive: true,
      force: true
    });

    if (await pathExists(restoredPdfDirectory)) {
      await cp(restoredPdfDirectory, stagedPdfDirectory, {
        recursive: true
      });
    } else {
      await mkdir(stagedPdfDirectory, {
        recursive: true
      });
    }

    await db.backup(safetyDatabasePath);
    db.close();
    databaseClosed = true;

    await mkdir(path.dirname(currentDatabasePath), {
      recursive: true
    });
    await rm(`${currentDatabasePath}-wal`, { force: true });
    await rm(`${currentDatabasePath}-shm`, { force: true });
    await copyFile(restoredDatabasePath, currentDatabasePath);

    if (await pathExists(currentPdfDirectory)) {
      await rm(previousPdfDirectory, {
        recursive: true,
        force: true
      });
      await rename(currentPdfDirectory, previousPdfDirectory);
      movedPreviousPdfDirectory = true;
    }

    await rename(stagedPdfDirectory, currentPdfDirectory);

    if (movedPreviousPdfDirectory) {
      await rm(previousPdfDirectory, {
        recursive: true,
        force: true
      });
      movedPreviousPdfDirectory = false;
    }

    return {
      success: true,
      path: backupPath,
      message:
        `バックアップを復元しました（文献 ${manifest.documentCount}件・分類群 ${manifest.taxonCount}件）`
    };
  } catch (error) {
    if (databaseClosed && (await pathExists(safetyDatabasePath))) {
      try {
        await copyFile(safetyDatabasePath, currentDatabasePath);
      } catch (rollbackError) {
        rollbackFailed = true;
        console.error(
          "Database rollback failed:",
          rollbackError
        );
      }
    }

    if (movedPreviousPdfDirectory) {
      try {
        await rm(currentPdfDirectory, {
          recursive: true,
          force: true
        });
        await rename(previousPdfDirectory, currentPdfDirectory);
      } catch (rollbackError) {
        rollbackFailed = true;
        console.error(
          "PDF rollback failed:",
          rollbackError
        );
      }
    }

    if (rollbackFailed) {
      const originalMessage =
        error instanceof Error
          ? error.message
          : String(error);

      throw new Error(
        `${originalMessage}\n\n復旧用ファイルを保持しました: ${safetyDirectory}`
      );
    }

    throw error;
  } finally {
    await rm(stagedPdfDirectory, {
      recursive: true,
      force: true
    });
    await rm(temporaryDirectory, {
      recursive: true,
      force: true
    });
    if (!rollbackFailed) {
      await rm(safetyDirectory, {
        recursive: true,
        force: true
      });
    }
  }
}
