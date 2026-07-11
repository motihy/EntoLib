import {
  addDocument,
  getDocuments,
  moveDocumentToTrash,
  getTrashedDocuments,
  restoreDocument,
  updateDocument
} from "./database/DatabaseManager";
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell
} from "electron";
console.log("MAIN.TS LOADED");

import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const require = createRequire(import.meta.url)
const __dirname = path.dirname(fileURLToPath(import.meta.url))

// The built directory structure
//
// ├─┬─┬ dist
// │ │ └── index.html
// │ │
// │ ├─┬ dist-electron
// │ │ ├── main.js
// │ │ └── preload.mjs
// │
process.env.APP_ROOT = path.join(__dirname, '..')

// 🚧 Use ['ENV_NAME'] avoid vite:define plugin - Vite@2.x
export const VITE_DEV_SERVER_URL = process.env['VITE_DEV_SERVER_URL']
export const MAIN_DIST = path.join(process.env.APP_ROOT, 'dist-electron')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'dist')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

let win: BrowserWindow | null

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(process.env.VITE_PUBLIC, 'electron-vite.svg'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.mjs'),
    },
  })

  // Test active push message to Renderer-process.
  win.webContents.on('did-finish-load', () => {
    win?.webContents.send('main-process-message', (new Date).toLocaleString())
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
  } else {
    // win.loadFile('dist/index.html')
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('activate', () => {
  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(() => {
  // 文献を登録
  ipcMain.handle("document:add", (_, documentData) => {
    addDocument(documentData);
    return true;
  });

  // 通常の文献一覧を取得
  ipcMain.handle("document:list", () => {
    return getDocuments();
  });

  // 文献をゴミ箱へ移動
  ipcMain.handle("document:trash", (_, id: number) => {
    return moveDocumentToTrash(id);
  });

  // ゴミ箱内の文献一覧を取得
  ipcMain.handle("document:trash-list", () => {
    return getTrashedDocuments();
  });

  // ゴミ箱から文献を復元
  ipcMain.handle("document:restore", (_, id: number) => {
    return restoreDocument(id);
  });
  // 文献情報を更新
  ipcMain.handle("document:update", (_, documentData) => {
    return updateDocument(documentData);
  });
    // PDFファイルを選択
  ipcMain.handle("document:select-pdf", async () => {
    const result = await dialog.showOpenDialog({
      title: "PDFを選択",
      properties: ["openFile"],
      filters: [
        {
          name: "PDF files",
          extensions: ["pdf"]
        }
      ]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    return result.filePaths[0];
  });
    // 登録されているPDFを既定のアプリで開く
  ipcMain.handle(
    "document:open-pdf",
    async (_, pdfPath: string) => {
      if (!pdfPath) {
        return {
          success: false,
          message: "PDFが登録されていません"
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
  createWindow();
});
