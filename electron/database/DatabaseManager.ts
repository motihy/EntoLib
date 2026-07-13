import Database from "better-sqlite3";

import {
  ensureLibraryDirectories,
  getLibraryDatabasePath,
  migrateLegacyDatabaseIfNeeded
} from "../services/LibraryManager";

function openDatabase(): Database.Database {
  ensureLibraryDirectories();
  migrateLegacyDatabaseIfNeeded();

  const database = new Database(
    getLibraryDatabasePath()
  );

  database.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      id INTEGER PRIMARY KEY AUTOINCREMENT,

      authors TEXT NOT NULL,
      year INTEGER,
      title TEXT NOT NULL,

      journal TEXT,
      volume TEXT,
      issue TEXT,
      pages TEXT,

      doi TEXT UNIQUE,
      pdf_path TEXT NOT NULL,
      file_hash TEXT,

      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      deleted_at TEXT
    );
  `);

  const documentColumns = database
    .prepare("PRAGMA table_info(documents)")
    .all() as Array<{ name: string }>;

  const hasDeletedAt = documentColumns.some(
    (column) => column.name === "deleted_at"
  );

  if (!hasDeletedAt) {
    database.exec(`
      ALTER TABLE documents
      ADD COLUMN deleted_at TEXT
    `);

    console.log("Added deleted_at column.");
  }

  const hasFileHash = documentColumns.some(
    (column) => column.name === "file_hash"
  );

  if (!hasFileHash) {
    database.exec(`
      ALTER TABLE documents
      ADD COLUMN file_hash TEXT
    `);

    console.log("Added file_hash column.");
  }

  console.log(
    "SQLite connected:",
    getLibraryDatabasePath()
  );

  return database;
}

export let db = openDatabase();

export interface NewDocument {
  authors: string;
  year: number | null;
  title: string;

  journal: string;
  volume: string;
  issue: string;
  pages: string;

  doi: string | null;
  pdf_path: string;
  file_hash: string | null;
}

export interface DocumentRecord {
  id: number;

  authors: string;
  year: number | null;
  title: string;

  journal: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;

  doi: string | null;
  pdf_path: string;
  file_hash: string | null;

  created_at: string;
  deleted_at: string | null;
}

export function addDocument(
  documentData: NewDocument
): void {
  const stmt = db.prepare(`
    INSERT INTO documents (
      authors,
      year,
      title,
      journal,
      volume,
      issue,
      pages,
      doi,
      pdf_path,
      file_hash
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  stmt.run(
    documentData.authors,
    documentData.year,
    documentData.title,
    documentData.journal,
    documentData.volume,
    documentData.issue,
    documentData.pages,
    documentData.doi,
    documentData.pdf_path,
    documentData.file_hash
  );

  console.log(
    "Document added:",
    documentData.title
  );
}

export function getDocuments(): DocumentRecord[] {
  const stmt = db.prepare(`
    SELECT
      id,
      authors,
      year,
      title,
      journal,
      volume,
      issue,
      pages,
      doi,
      pdf_path,
      file_hash,
      created_at,
      deleted_at
    FROM documents
    WHERE deleted_at IS NULL
    ORDER BY
      authors COLLATE NOCASE ASC,
      year ASC,
      title COLLATE NOCASE ASC
  `);

  return stmt.all() as DocumentRecord[];
}

export function moveDocumentToTrash(
  id: number
): boolean {
  const result = db.prepare(`
    UPDATE documents
    SET deleted_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND deleted_at IS NULL
  `).run(id);

  return result.changes > 0;
}

export function getTrashedDocuments():
  DocumentRecord[] {
  const stmt = db.prepare(`
    SELECT
      id,
      authors,
      year,
      title,
      journal,
      volume,
      issue,
      pages,
      doi,
      pdf_path,
      file_hash,
      created_at,
      deleted_at
    FROM documents
    WHERE deleted_at IS NOT NULL
    ORDER BY deleted_at DESC
  `);

  return stmt.all() as DocumentRecord[];
}

export function restoreDocument(
  id: number
): boolean {
  const result = db.prepare(`
    UPDATE documents
    SET deleted_at = NULL
    WHERE id = ?
      AND deleted_at IS NOT NULL
  `).run(id);

  return result.changes > 0;
}

export interface UpdateDocument {
  id: number;

  authors: string;
  year: number | null;
  title: string;

  journal: string;
  volume: string;
  issue: string;
  pages: string;

  doi: string | null;
  pdf_path: string;
  file_hash: string | null;
}

export function updateDocument(
  documentData: UpdateDocument
): boolean {
  const result = db.prepare(`
    UPDATE documents
    SET
      authors = ?,
      year = ?,
      title = ?,
      journal = ?,
      volume = ?,
      issue = ?,
      pages = ?,
      doi = ?,
      pdf_path = ?,
      file_hash = ?
    WHERE id = ?
      AND deleted_at IS NULL
  `).run(
    documentData.authors,
    documentData.year,
    documentData.title,
    documentData.journal,
    documentData.volume,
    documentData.issue,
    documentData.pages,
    documentData.doi,
    documentData.pdf_path,
    documentData.file_hash,
    documentData.id
  );

  return result.changes > 0;
}

export interface DuplicateDocumentRecord {
  id: number;
  authors: string;
  year: number | null;
  title: string;
  deleted_at: string | null;
}

export function findDocumentByFileHash(
  fileHash: string,
  excludeId?: number
): DuplicateDocumentRecord | undefined {
  if (!fileHash) {
    return undefined;
  }

  if (excludeId === undefined) {
    return db.prepare(`
      SELECT
        id,
        authors,
        year,
        title,
        deleted_at
      FROM documents
      WHERE file_hash = ?
      LIMIT 1
    `).get(fileHash) as
      | DuplicateDocumentRecord
      | undefined;
  }

  return db.prepare(`
    SELECT
      id,
      authors,
      year,
      title,
      deleted_at
    FROM documents
    WHERE file_hash = ?
      AND id <> ?
    LIMIT 1
  `).get(
    fileHash,
    excludeId
  ) as DuplicateDocumentRecord | undefined;
}
