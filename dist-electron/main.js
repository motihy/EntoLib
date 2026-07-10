import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
const databaseDir = path.join(process.cwd(), "database");
if (!fs.existsSync(databaseDir)) {
  fs.mkdirSync(databaseDir, { recursive: true });
}
const databasePath = path.join(databaseDir, "entolib.db");
const db = new Database(databasePath);
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

    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`);
console.log("SQLite connected.");
function addDocument(document) {
  const stmt = db.prepare(`
    INSERT INTO documents
    (authors, year, title, journal, doi, pdf_path)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    document.authors,
    document.year,
    document.title,
    document.journal,
    document.doi,
    document.pdf_path
  );
  console.log("Document added:", document.title);
}
console.log("MAIN.TS LOADED");
createRequire(import.meta.url);
const __dirname$1 = path.dirname(fileURLToPath(import.meta.url));
process.env.APP_ROOT = path.join(__dirname$1, "..");
const VITE_DEV_SERVER_URL = process.env["VITE_DEV_SERVER_URL"];
const MAIN_DIST = path.join(process.env.APP_ROOT, "dist-electron");
const RENDERER_DIST = path.join(process.env.APP_ROOT, "dist");
process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, "public") : RENDERER_DIST;
let win;
function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, "electron-vite.svg"),
    webPreferences: {
      preload: path.join(__dirname$1, "preload.mjs")
    }
  });
  win.webContents.on("did-finish-load", () => {
    win == null ? void 0 : win.webContents.send("main-process-message", (/* @__PURE__ */ new Date()).toLocaleString());
  });
  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(path.join(RENDERER_DIST, "index.html"));
  }
}
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
app.whenReady().then(() => {
  ipcMain.handle("document:add", (_, document) => {
    addDocument(document);
    return true;
  });
  createWindow();
});
export {
  MAIN_DIST,
  RENDERER_DIST,
  VITE_DEV_SERVER_URL
};
