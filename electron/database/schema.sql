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

    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);