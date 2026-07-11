import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const databaseDir = path.join(
  process.cwd(),
  "database"
);

if (!fs.existsSync(databaseDir)) {
  fs.mkdirSync(databaseDir, {
    recursive: true
  });
}

const databasePath = path.join(
  databaseDir,
  "entolib.db"
);

export const db = new Database(databasePath);

// documentsテーブルを作成
db.exec(`
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

// 現在のdocumentsテーブルの列を取得
const documentColumns = db
  .prepare("PRAGMA table_info(documents)")
  .all() as Array<{ name: string }>;

// deleted_at列があるか確認
const hasDeletedAt = documentColumns.some(
  (column) => column.name === "deleted_at"
);

// 既存データベースにdeleted_at列を追加
if (!hasDeletedAt) {
  db.exec(`
    ALTER TABLE documents
    ADD COLUMN deleted_at TEXT
  `);

  console.log("Added deleted_at column.");
}

// file_hash列があるか確認
const hasFileHash = documentColumns.some(
  (column) => column.name === "file_hash"
);

// 既存データベースにfile_hash列を追加
if (!hasFileHash) {
  db.exec(`
    ALTER TABLE documents
    ADD COLUMN file_hash TEXT
  `);

  console.log("Added file_hash column.");
}

console.log("SQLite connected.");

// 新しく登録する文献データ
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
// SQLiteから取得する文献データ
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

// 文献を登録
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

// ゴミ箱に入っていない文献を取得
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

// 文献をゴミ箱へ移動
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

// ゴミ箱に入っている文献を取得
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

// ゴミ箱から文献を元に戻す
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

// 編集時に受け取る文献データ
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
// 文献情報を更新
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

// 同じPDFがすでに登録されているか検索
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