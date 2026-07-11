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

const __dirname = path.dirname(
  fileURLToPath(import.meta.url)
);

console.log("MAIN.TS LOADED");

// ビルド後のフォルダー構成
//
// ├─ dist
// │  └─ index.html
// │
// └─ dist-electron
//    ├─ main.js
//    └─ preload.mjs
//
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

// すべてのウィンドウが閉じられたとき
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
    win = null;
  }
});

// macOSでDockアイコンが押されたとき
app.on("activate", () => {
  if (
    BrowserWindow.getAllWindows()
      .length === 0
  ) {
    createWindow();
  }
});

app.whenReady().then(() => {
  /*
   * 文献を新規登録
   */
  ipcMain.handle(
    "document:add",
    async (_, documentData) => {
      const sourcePdfPath =
        typeof documentData.pdf_path ===
        "string"
          ? documentData.pdf_path
          : "";

      // コピー前のPDFからSHA-256を計算
      const fileHash = sourcePdfPath
        ? await calculateFileHash(
            sourcePdfPath
          )
        : null;

      // 同じPDFが登録済みか確認
      if (fileHash) {
        const duplicate =
          findDocumentByFileHash(
            fileHash
          );

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

      // EntoLib管理フォルダーへコピー
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
        // DOI重複などで登録に失敗した場合、
        // 今回新しくコピーしたPDFを削除
        if (pdfWasCopied) {
          await removeManagedPdf(
            managedPdfPath
          );
        }

        throw error;
      }
    }
  );

  /*
   * Libraryの文献一覧を取得
   */
  ipcMain.handle(
    "document:list",
    () => {
      return getDocuments();
    }
  );

  /*
   * 文献をゴミ箱へ移動
   */
  ipcMain.handle(
    "document:trash",
    (_, id: number) => {
      return moveDocumentToTrash(id);
    }
  );

  /*
   * ゴミ箱の文献一覧を取得
   */
  ipcMain.handle(
    "document:trash-list",
    () => {
      return getTrashedDocuments();
    }
  );

  /*
   * ゴミ箱から文献を復元
   */
  ipcMain.handle(
    "document:restore",
    (_, id: number) => {
      return restoreDocument(id);
    }
  );

  /*
   * 文献情報を更新
   */
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

      // 編集中の文献自身を除外して
      // 重複PDFを検索
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
        const updated =
          updateDocument({
            ...documentData,
            pdf_path: managedPdfPath,
            file_hash: fileHash
          });

        // 対象文献が存在しなかった場合
        if (!updated && pdfWasCopied) {
          await removeManagedPdf(
            managedPdfPath
          );
        }

        return updated;
      } catch (error) {
        // DOI重複などで更新に失敗した場合
        if (pdfWasCopied) {
          await removeManagedPdf(
            managedPdfPath
          );
        }

        throw error;
      }
    }
  );

  /*
   * WindowsのPDF選択画面を開く
   */
  ipcMain.handle(
    "document:select-pdf",
    async () => {
      const result =
        await dialog.showOpenDialog({
          title: "PDFを選択",

          properties: [
            "openFile"
          ],

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

  /*
   * PDFから書誌情報を抽出
   */
  ipcMain.handle(
    "document:extract-metadata",
    async (
      _,
      pdfPath: string
    ) => {
      return extractMetadataFromPdf(
        pdfPath
      );
    }
  );

  /*
   * 登録済みPDFを既定アプリで開く
   */
  ipcMain.handle(
    "document:open-pdf",
    async (
      _,
      pdfPath: string
    ) => {
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

  // IPC登録後に画面を作成
  createWindow();
});