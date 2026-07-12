import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell
} from "electron";

import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  addDocument,
  findDocumentByFileHash,
  getDocuments,
  getTrashedDocuments,
  moveDocumentToTrash,
  restoreDocument,
  updateDocument
} from "./database/DatabaseManager";

import {
  calculateFileHash,
  importPdf,
  removeManagedPdf
} from "./services/PdfStorage";

import {
  extractMetadataFromPdf
} from "./services/MetadataExtractor";

import {
  importDocumentsFromPdfs
} from "./services/DocumentImportService";

import {
  createTaxon,
  getLinkedDocumentIds,
  linkDocumentToTaxon,
  listTaxa,
  trashTaxon,
  unlinkDocumentFromTaxon,
  updateTaxon
} from "./database/TaxonomyManager";

import {
  createEntoLibBackup,
  restoreEntoLibBackup
} from "./services/BackupService";

const __dirname = path.dirname(
  fileURLToPath(import.meta.url)
);

console.log("MAIN.TS LOADED");

process.env.APP_ROOT = path.join(
  __dirname,
  ".."
);

export const VITE_DEV_SERVER_URL =
  process.env["VITE_DEV_SERVER_URL"];

export const MAIN_DIST = path.join(
  process.env.APP_ROOT,
  "dist-electron"
);

export const RENDERER_DIST = path.join(
  process.env.APP_ROOT,
  "dist"
);

process.env.VITE_PUBLIC =
  VITE_DEV_SERVER_URL
    ? path.join(
        process.env.APP_ROOT,
        "public"
      )
    : RENDERER_DIST;

let win: BrowserWindow | null = null;

function createWindow(): void {
  win = new BrowserWindow({
    icon: path.join(
      process.env.VITE_PUBLIC,
      "electron-vite.svg"
    ),
    webPreferences: {
      preload: path.join(
        __dirname,
        "preload.mjs"
      )
    }
  });
 

win.webContents.on(
  "did-fail-load",
  (_event, errorCode, errorDescription) => {
    console.error(
      "Renderer load failed:",
      errorCode,
      errorDescription
    );
  }
);

win.webContents.on(
  "render-process-gone",
  (_event, details) => {
    console.error(
      "Renderer process gone:",
      details
    );
  }
);

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL);
  } else {
    win.loadFile(
      path.join(
        RENDERER_DIST,
        "index.html"
      )
    );
  }
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

app.on("activate", () => {
  if (
    BrowserWindow.getAllWindows().length === 0
  ) {
    createWindow();
  }
});

app.whenReady().then(() => {
  ipcMain.handle(
    "document:add",
    async (_, documentData) => {
      const sourcePdfPath =
        typeof documentData.pdf_path ===
        "string"
          ? documentData.pdf_path
          : "";

      const fileHash = sourcePdfPath
        ? await calculateFileHash(
            sourcePdfPath
          )
        : null;

      if (fileHash) {
        const duplicate =
          findDocumentByFileHash(fileHash);

        if (duplicate) {
          const location =
            duplicate.deleted_at
              ? "ゴミ箱"
              : "Library";

          throw new Error(
            "同じPDFがすでに登録されています。\n\n" +
              `保存場所: ${location}\n` +
              `タイトル: ${duplicate.title}\n` +
              `著者: ${duplicate.authors}`
          );
        }
      }

      const managedPdfPath =
        await importPdf(sourcePdfPath);

      const pdfWasCopied =
        Boolean(sourcePdfPath) &&
        sourcePdfPath !== managedPdfPath;

      try {
        addDocument({
          ...documentData,
          pdf_path: managedPdfPath,
          file_hash: fileHash
        });

        return true;
      } catch (error) {
        if (pdfWasCopied) {
          await removeManagedPdf(
            managedPdfPath
          );
        }

        throw error;
      }
    }
  );

  ipcMain.handle(
    "document:list",
    () => getDocuments()
  );

  ipcMain.handle(
    "document:trash",
    (_, id: number) =>
      moveDocumentToTrash(id)
  );

  ipcMain.handle(
    "document:trash-list",
    () => getTrashedDocuments()
  );

  ipcMain.handle(
    "document:restore",
    (_, id: number) => restoreDocument(id)
  );

  ipcMain.handle(
    "document:update",
    async (_, documentData) => {
      const sourcePdfPath =
        typeof documentData.pdf_path ===
        "string"
          ? documentData.pdf_path
          : "";

      const fileHash = sourcePdfPath
        ? await calculateFileHash(
            sourcePdfPath
          )
        : null;

      if (fileHash) {
        const duplicate =
          findDocumentByFileHash(
            fileHash,
            documentData.id
          );

        if (duplicate) {
          const location =
            duplicate.deleted_at
              ? "ゴミ箱"
              : "Library";

          throw new Error(
            "同じPDFが別の文献に登録されています。\n\n" +
              `保存場所: ${location}\n` +
              `タイトル: ${duplicate.title}\n` +
              `著者: ${duplicate.authors}`
          );
        }
      }

      const managedPdfPath =
        await importPdf(sourcePdfPath);

      const pdfWasCopied =
        Boolean(sourcePdfPath) &&
        sourcePdfPath !== managedPdfPath;

      try {
        const updated = updateDocument({
          ...documentData,
          pdf_path: managedPdfPath,
          file_hash: fileHash
        });

        if (!updated && pdfWasCopied) {
          await removeManagedPdf(
            managedPdfPath
          );
        }

        return updated;
      } catch (error) {
        if (pdfWasCopied) {
          await removeManagedPdf(
            managedPdfPath
          );
        }

        throw error;
      }
    }
  );

  ipcMain.handle(
    "document:select-pdf",
    async () => {
      const result =
        await dialog.showOpenDialog({
          title: "PDFを選択",
          properties: ["openFile"],
          filters: [
            {
              name: "PDF files",
              extensions: ["pdf"]
            }
          ]
        });

      if (
        result.canceled ||
        result.filePaths.length === 0
      ) {
        return null;
      }

      return result.filePaths[0];
    }
  );

  ipcMain.handle(
    "document:select-pdfs",
    async () => {
      const result =
        await dialog.showOpenDialog({
          title: "複数のPDFを選択",
          properties: [
            "openFile",
            "multiSelections"
          ],
          filters: [
            {
              name: "PDF files",
              extensions: ["pdf"]
            }
          ]
        });

      if (result.canceled) {
        return [];
      }

      return result.filePaths;
    }
  );

  ipcMain.handle(
    "document:bulk-import",
    async (_, pdfPaths: unknown) => {
      if (!Array.isArray(pdfPaths)) {
        throw new Error(
          "PDF一覧の形式が正しくありません"
        );
      }

      const safePdfPaths = pdfPaths.filter(
        (pdfPath): pdfPath is string =>
          typeof pdfPath === "string"
      );

      return importDocumentsFromPdfs(
        safePdfPaths
      );
    }
  );

  ipcMain.handle(
    "document:extract-metadata",
    async (_, pdfPath: string) =>
      extractMetadataFromPdf(pdfPath)
  );

  ipcMain.handle(
    "document:open-pdf",
    async (_, pdfPath: string) => {
      if (!pdfPath) {
        return {
          success: false,
          message:
            "PDFが登録されていません"
        };
      }

      const errorMessage =
        await shell.openPath(pdfPath);

      if (errorMessage) {
        return {
          success: false,
          message: errorMessage
        };
      }

      return {
        success: true,
        message: ""
      };
    }
  );


  // Taxonomy IPC
  ipcMain.handle("taxon:list", (_, search: string = "") => {
    return listTaxa(search);
  });

  ipcMain.handle("taxon:create", (_, taxonData) => {
    return createTaxon(taxonData);
  });

  ipcMain.handle("taxon:update", (_, id: number, taxonData) => {
    return updateTaxon(id, taxonData);
  });

  ipcMain.handle("taxon:trash", (_, id: number) => {
    return trashTaxon(id);
  });

  ipcMain.handle("taxon:linked-document-ids", (_, taxonId: number) => {
    return getLinkedDocumentIds(taxonId);
  });

  ipcMain.handle(
    "taxon:link-document",
    (_, taxonId: number, documentId: number) => {
      return linkDocumentToTaxon(taxonId, documentId);
    }
  );

  ipcMain.handle(
    "taxon:unlink-document",
    (_, taxonId: number, documentId: number) => {
      return unlinkDocumentFromTaxon(taxonId, documentId);
    }
  );
    /* EntoLib backup */
  ipcMain.handle("backup:create", async () => {
    const backupName =
      "EntoLib-backup-" +
      new Date()
        .toISOString()
        .replace(/[-:]/g, "")
        .replace("T", "-")
        .slice(0, 15) +
      ".zip";

    const result = await dialog.showSaveDialog({
      title: "EntoLibバックアップの保存先",
      defaultPath: path.join(
        app.getPath("documents"),
        backupName
      ),
      filters: [
        {
          name: "EntoLib backup",
          extensions: ["zip"]
        }
      ]
    });

    if (result.canceled || !result.filePath) {
      return { success: false, canceled: true };
    }

    return createEntoLibBackup(result.filePath);
  });

  ipcMain.handle("backup:restore", async () => {
    const selection = await dialog.showOpenDialog({
      title: "EntoLibバックアップを選択",
      properties: ["openFile"],
      filters: [
        {
          name: "EntoLib backup",
          extensions: ["zip"]
        }
      ]
    });

    if (selection.canceled || selection.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    const confirmation = await dialog.showMessageBox({
      type: "warning",
      title: "バックアップを復元",
      message: "現在のデータを選択したバックアップで置き換えます。",
      detail:
        "文献データベースと管理PDFが置き換わります。続行しますか？",
      buttons: ["キャンセル", "復元する"],
      defaultId: 0,
      cancelId: 0,
      noLink: true
    });

    if (confirmation.response !== 1) {
      return { success: false, canceled: true };
    }

    try {
      const restoreResult = await restoreEntoLibBackup(
        selection.filePaths[0]
      );

      if (restoreResult.success) {
        setTimeout(() => {
          app.relaunch();
          app.exit(0);
        }, 1200);
      }

      return restoreResult;
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : String(error);

      setTimeout(() => {
        app.relaunch();
        app.exit(0);
      }, 1800);

      return {
        success: false,
        message:
          "復元に失敗しました。元データへの復旧を試みました。\n\n" +
          message
      };
    }
  });

createWindow();
});

