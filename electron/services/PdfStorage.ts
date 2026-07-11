import { app } from "electron";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";

/**
 * EntoLibが管理するPDF保存フォルダーを返す
 */
export function getPdfStorageDirectory(): string {
  return path.join(
    app.getPath("documents"),
    "EntoLib",
    "library",
    "pdfs"
  );
}

/**
 * PDFがすでにEntoLib管理フォルダー内にあるか確認する
 */
function isManagedPdf(pdfPath: string): boolean {
  const storageDirectory = path.resolve(
    getPdfStorageDirectory()
  );

  const resolvedPdfPath = path.resolve(pdfPath);

  return (
    resolvedPdfPath === storageDirectory ||
    resolvedPdfPath.startsWith(
      storageDirectory + path.sep
    )
  );
}

/**
 * 選択されたPDFをEntoLib管理フォルダーへコピーする
 *
 * 戻り値はコピー後のPDFパス
 */
export async function importPdf(
  sourcePath: string
): Promise<string> {
  if (!sourcePath) {
    return "";
  }

  if (
    path.extname(sourcePath).toLocaleLowerCase() !==
    ".pdf"
  ) {
    throw new Error(
      "選択されたファイルはPDFではありません"
    );
  }

  // すでにEntoLib管理下ならコピーしない
  if (isManagedPdf(sourcePath)) {
    return sourcePath;
  }

  const storageDirectory =
    getPdfStorageDirectory();

  await mkdir(storageDirectory, {
    recursive: true
  });

  const destinationPath = path.join(
    storageDirectory,
    `${randomUUID()}.pdf`
  );

  await copyFile(
    sourcePath,
    destinationPath
  );

  console.log(
    "PDF imported:",
    destinationPath
  );

  return destinationPath;
}