import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import {
  access,
  cp,
  mkdir,
  readdir,
  rename,
  rm,
  writeFile
} from "node:fs/promises";
import path from "node:path";

import { db } from "../database/DatabaseManager";
import {
  getLibraryInfo,
  getLibraryPdfDirectory,
  getLibraryRoot,
  saveLibraryRoot,
  type LibraryInfo
} from "./LibraryManager";

function portableBasename(filePath: string): string {
  return path.posix.basename(
    filePath.replace(/\\/g, "/")
  );
}

async function assertWritable(
  directoryPath: string
): Promise<void> {
  await mkdir(directoryPath, {
    recursive: true
  });

  const testPath = path.join(
    directoryPath,
    `.entolib-write-test-${randomUUID()}`
  );

  try {
    await writeFile(testPath, "EntoLib", "utf8");
    await access(testPath);
  } finally {
    await rm(testPath, {
      force: true
    });
  }
}

async function directoryHasEntries(
  directoryPath: string
): Promise<boolean> {
  if (!existsSync(directoryPath)) {
    return false;
  }

  const entries = await readdir(directoryPath);
  return entries.length > 0;
}

function rewritePdfPaths(
  databasePath: string,
  destinationPdfDirectory: string
): void {
  const copiedDatabase = new Database(databasePath);

  try {
    const rows = copiedDatabase
      .prepare(
        "SELECT id, pdf_path FROM documents WHERE pdf_path IS NOT NULL AND pdf_path <> ''"
      )
      .all() as Array<{
        id: number;
        pdf_path: string;
      }>;

    const update = copiedDatabase.prepare(
      "UPDATE documents SET pdf_path = ? WHERE id = ?"
    );

    const updateAll = copiedDatabase.transaction(() => {
      for (const row of rows) {
        const fileName = portableBasename(
          row.pdf_path
        );

        update.run(
          path.join(
            destinationPdfDirectory,
            fileName
          ),
          row.id
        );
      }
    });

    updateAll();
  } finally {
    copiedDatabase.close();
  }
}

function validateCopiedDatabase(
  databasePath: string
): void {
  const copiedDatabase = new Database(
    databasePath,
    {
      readonly: true,
      fileMustExist: true
    }
  );

  try {
    const integrity = copiedDatabase
      .prepare("PRAGMA integrity_check")
      .get() as {
        integrity_check: string;
      };

    if (integrity.integrity_check !== "ok") {
      throw new Error(
        `コピーしたデータベースの検査に失敗しました: ${integrity.integrity_check}`
      );
    }
  } finally {
    copiedDatabase.close();
  }
}

export async function copyLibraryToLocation(
  destinationRoot: string
): Promise<LibraryInfo> {
  const currentRoot = path.resolve(
    getLibraryRoot()
  );
  const targetRoot = path.resolve(
    destinationRoot.trim()
  );

  if (targetRoot === currentRoot) {
    throw new Error(
      "現在と同じフォルダーが選択されています"
    );
  }

  const relativeToCurrent = path.relative(
    currentRoot,
    targetRoot
  );

  if (
    relativeToCurrent &&
    !relativeToCurrent.startsWith("..") &&
    !path.isAbsolute(relativeToCurrent)
  ) {
    throw new Error(
      "現在のライブラリ内は新しい保存先にできません。別のフォルダーを選択してください"
    );
  }

  if (!targetRoot) {
    throw new Error(
      "保存先フォルダーが正しくありません"
    );
  }

  await assertWritable(targetRoot);

  const targetDatabasePath = path.join(
    targetRoot,
    "entolib.db"
  );
  const targetPdfDirectory = path.join(
    targetRoot,
    "pdfs"
  );
  const targetBackupDirectory = path.join(
    targetRoot,
    "backups"
  );

  if (existsSync(targetDatabasePath)) {
    throw new Error(
      "選択したフォルダーには既にentolib.dbがあります。空のフォルダーを選択してください"
    );
  }

  if (await directoryHasEntries(targetPdfDirectory)) {
    throw new Error(
      "選択したフォルダーのpdfsフォルダーが空ではありません。別のフォルダーを選択してください"
    );
  }

  const operationId = randomUUID();
  const stagingRoot = path.join(
    targetRoot,
    `.entolib-copy-${operationId}`
  );
  const stagingDatabasePath = path.join(
    stagingRoot,
    "entolib.db"
  );
  const stagingPdfDirectory = path.join(
    stagingRoot,
    "pdfs"
  );

  try {
    await mkdir(stagingRoot, {
      recursive: true
    });

    await db.backup(stagingDatabasePath);

    const currentPdfDirectory =
      getLibraryPdfDirectory();

    if (existsSync(currentPdfDirectory)) {
      await cp(
        currentPdfDirectory,
        stagingPdfDirectory,
        { recursive: true }
      );
    } else {
      await mkdir(stagingPdfDirectory, {
        recursive: true
      });
    }

    rewritePdfPaths(
      stagingDatabasePath,
      targetPdfDirectory
    );
    validateCopiedDatabase(
      stagingDatabasePath
    );

    await rename(
      stagingDatabasePath,
      targetDatabasePath
    );
    await rename(
      stagingPdfDirectory,
      targetPdfDirectory
    );
    await mkdir(targetBackupDirectory, {
      recursive: true
    });

    saveLibraryRoot(targetRoot);

    return {
      root: targetRoot,
      databasePath: targetDatabasePath,
      pdfDirectory: targetPdfDirectory,
      backupDirectory: targetBackupDirectory
    };
  } catch (error) {
    await rm(targetDatabasePath, {
      force: true
    });

    if (
      existsSync(targetPdfDirectory) &&
      !(await directoryHasEntries(targetPdfDirectory))
    ) {
      await rm(targetPdfDirectory, {
        recursive: true,
        force: true
      });
    }

    throw error;
  } finally {
    await rm(stagingRoot, {
      recursive: true,
      force: true
    });
  }
}

export function currentLibraryInfo(): LibraryInfo {
  return getLibraryInfo();
}
