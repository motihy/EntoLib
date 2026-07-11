import { db } from "./DatabaseManager";

export type TaxonRank =
  | "order"
  | "family"
  | "subfamily"
  | "tribe"
  | "genus"
  | "species"
  | "subspecies";

export interface TaxonInput {
  rank: TaxonRank;
  order_name: string;
  family: string;
  subfamily: string;
  tribe: string;
  genus: string;
  species: string;
  subspecies: string;
  authority: string;
  nomenclatural_year: number | null;
  scientific_name: string;
  type_repository: string;
  distribution_notes: string;
  notes: string;
  synonyms: string[];
}

export interface TaxonRecord extends Omit<TaxonInput, "synonyms"> {
  id: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
  synonyms: string[];
  document_count: number;
}

interface TaxonRow extends Omit<TaxonRecord, "synonyms"> {}

const VALID_RANKS = new Set<TaxonRank>([
  "order",
  "family",
  "subfamily",
  "tribe",
  "genus",
  "species",
  "subspecies"
]);

db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS taxa (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rank TEXT NOT NULL,
    order_name TEXT,
    family TEXT,
    subfamily TEXT,
    tribe TEXT,
    genus TEXT,
    species TEXT,
    subspecies TEXT,
    authority TEXT,
    nomenclatural_year INTEGER,
    scientific_name TEXT NOT NULL,
    type_repository TEXT,
    distribution_notes TEXT,
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    deleted_at TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_taxa_scientific_name
  ON taxa(scientific_name COLLATE NOCASE);

  CREATE INDEX IF NOT EXISTS idx_taxa_rank
  ON taxa(rank);

  CREATE TABLE IF NOT EXISTS taxon_synonyms (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    taxon_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (taxon_id) REFERENCES taxa(id) ON DELETE CASCADE,
    UNIQUE(taxon_id, name)
  );

  CREATE TABLE IF NOT EXISTS document_taxa (
    document_id INTEGER NOT NULL,
    taxon_id INTEGER NOT NULL,
    relationship TEXT NOT NULL DEFAULT 'mentions',
    notes TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (document_id, taxon_id),
    FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
    FOREIGN KEY (taxon_id) REFERENCES taxa(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_document_taxa_taxon
  ON document_taxa(taxon_id);
`);

function cleanText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function cleanYear(value: unknown): number | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const year = Number(value);
  if (!Number.isInteger(year) || year < 1000 || year > 9999) {
    throw new Error("命名年は4桁の整数で入力してください");
  }

  return year;
}

function normalizeSynonyms(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(
    value
      .map(cleanText)
      .filter(Boolean)
  )];
}

function deriveScientificName(input: Partial<TaxonInput>): string {
  const explicit = cleanText(input.scientific_name);
  if (explicit) {
    return explicit;
  }

  const genus = cleanText(input.genus);
  const species = cleanText(input.species);
  const subspecies = cleanText(input.subspecies);

  if (subspecies && genus && species) {
    return `${genus} ${species} ${subspecies}`;
  }

  if (species && genus) {
    return `${genus} ${species}`;
  }

  return (
    genus ||
    cleanText(input.tribe) ||
    cleanText(input.subfamily) ||
    cleanText(input.family) ||
    cleanText(input.order_name)
  );
}

function normalizeTaxonInput(value: unknown): TaxonInput {
  if (!value || typeof value !== "object") {
    throw new Error("分類群データの形式が正しくありません");
  }

  const source = value as Record<string, unknown>;
  const rank = cleanText(source.rank) as TaxonRank;

  if (!VALID_RANKS.has(rank)) {
    throw new Error("Rankを選択してください");
  }

  const input: TaxonInput = {
    rank,
    order_name: cleanText(source.order_name),
    family: cleanText(source.family),
    subfamily: cleanText(source.subfamily),
    tribe: cleanText(source.tribe),
    genus: cleanText(source.genus),
    species: cleanText(source.species),
    subspecies: cleanText(source.subspecies),
    authority: cleanText(source.authority),
    nomenclatural_year: cleanYear(source.nomenclatural_year),
    scientific_name: "",
    type_repository: cleanText(source.type_repository),
    distribution_notes: cleanText(source.distribution_notes),
    notes: cleanText(source.notes),
    synonyms: normalizeSynonyms(source.synonyms)
  };

  input.scientific_name = deriveScientificName({
    ...input,
    scientific_name: cleanText(source.scientific_name)
  });

  if (!input.scientific_name) {
    throw new Error("Scientific nameを入力してください");
  }

  return input;
}

function getSynonyms(taxonId: number): string[] {
  const rows = db.prepare(`
    SELECT name
    FROM taxon_synonyms
    WHERE taxon_id = ?
    ORDER BY name COLLATE NOCASE
  `).all(taxonId) as Array<{ name: string }>;

  return rows.map((row) => row.name);
}

function replaceSynonyms(taxonId: number, synonyms: string[]): void {
  db.prepare("DELETE FROM taxon_synonyms WHERE taxon_id = ?").run(taxonId);

  const insert = db.prepare(`
    INSERT OR IGNORE INTO taxon_synonyms (taxon_id, name)
    VALUES (?, ?)
  `);

  for (const synonym of synonyms) {
    insert.run(taxonId, synonym);
  }
}

function hydrateTaxon(row: TaxonRow): TaxonRecord {
  return {
    ...row,
    synonyms: getSynonyms(row.id)
  };
}

export function listTaxa(search = ""): TaxonRecord[] {
  const query = cleanText(search);
  const like = `%${query}%`;

  const rows = db.prepare(`
    SELECT
      t.*,
      COUNT(dt.document_id) AS document_count
    FROM taxa t
    LEFT JOIN document_taxa dt ON dt.taxon_id = t.id
    WHERE t.deleted_at IS NULL
      AND (
        ? = '' OR
        t.scientific_name LIKE ? COLLATE NOCASE OR
        t.order_name LIKE ? COLLATE NOCASE OR
        t.family LIKE ? COLLATE NOCASE OR
        t.subfamily LIKE ? COLLATE NOCASE OR
        t.tribe LIKE ? COLLATE NOCASE OR
        t.genus LIKE ? COLLATE NOCASE OR
        t.species LIKE ? COLLATE NOCASE OR
        t.subspecies LIKE ? COLLATE NOCASE OR
        EXISTS (
          SELECT 1
          FROM taxon_synonyms s
          WHERE s.taxon_id = t.id
            AND s.name LIKE ? COLLATE NOCASE
        )
      )
    GROUP BY t.id
    ORDER BY t.scientific_name COLLATE NOCASE
  `).all(
    query,
    like,
    like,
    like,
    like,
    like,
    like,
    like,
    like,
    like
  ) as TaxonRow[];

  return rows.map(hydrateTaxon);
}

export function createTaxon(value: unknown): TaxonRecord {
  const input = normalizeTaxonInput(value);

  const transaction = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO taxa (
        rank,
        order_name,
        family,
        subfamily,
        tribe,
        genus,
        species,
        subspecies,
        authority,
        nomenclatural_year,
        scientific_name,
        type_repository,
        distribution_notes,
        notes
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      input.rank,
      input.order_name,
      input.family,
      input.subfamily,
      input.tribe,
      input.genus,
      input.species,
      input.subspecies,
      input.authority,
      input.nomenclatural_year,
      input.scientific_name,
      input.type_repository,
      input.distribution_notes,
      input.notes
    );

    const id = Number(result.lastInsertRowid);
    replaceSynonyms(id, input.synonyms);
    return id;
  });

  const id = transaction();
  const created = listTaxa().find((taxon) => taxon.id === id);

  if (!created) {
    throw new Error("分類群を登録できませんでした");
  }

  return created;
}

export function updateTaxon(id: number, value: unknown): TaxonRecord {
  const input = normalizeTaxonInput(value);

  const transaction = db.transaction(() => {
    const result = db.prepare(`
      UPDATE taxa
      SET
        rank = ?,
        order_name = ?,
        family = ?,
        subfamily = ?,
        tribe = ?,
        genus = ?,
        species = ?,
        subspecies = ?,
        authority = ?,
        nomenclatural_year = ?,
        scientific_name = ?,
        type_repository = ?,
        distribution_notes = ?,
        notes = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
        AND deleted_at IS NULL
    `).run(
      input.rank,
      input.order_name,
      input.family,
      input.subfamily,
      input.tribe,
      input.genus,
      input.species,
      input.subspecies,
      input.authority,
      input.nomenclatural_year,
      input.scientific_name,
      input.type_repository,
      input.distribution_notes,
      input.notes,
      id
    );

    if (result.changes === 0) {
      throw new Error("更新対象の分類群が見つかりません");
    }

    replaceSynonyms(id, input.synonyms);
  });

  transaction();

  const updated = listTaxa().find((taxon) => taxon.id === id);
  if (!updated) {
    throw new Error("分類群を更新できませんでした");
  }

  return updated;
}

export function trashTaxon(id: number): boolean {
  const result = db.prepare(`
    UPDATE taxa
    SET deleted_at = CURRENT_TIMESTAMP,
        updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
      AND deleted_at IS NULL
  `).run(id);

  return result.changes > 0;
}

export function getLinkedDocumentIds(taxonId: number): number[] {
  const rows = db.prepare(`
    SELECT document_id
    FROM document_taxa
    WHERE taxon_id = ?
    ORDER BY document_id
  `).all(taxonId) as Array<{ document_id: number }>;

  return rows.map((row) => row.document_id);
}

export function linkDocumentToTaxon(
  taxonId: number,
  documentId: number
): boolean {
  const result = db.prepare(`
    INSERT OR IGNORE INTO document_taxa (document_id, taxon_id)
    VALUES (?, ?)
  `).run(documentId, taxonId);

  return result.changes > 0;
}

export function unlinkDocumentFromTaxon(
  taxonId: number,
  documentId: number
): boolean {
  const result = db.prepare(`
    DELETE FROM document_taxa
    WHERE document_id = ?
      AND taxon_id = ?
  `).run(documentId, taxonId);

  return result.changes > 0;
}
