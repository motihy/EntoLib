import { app } from "electron";
import {
  createHash,
  randomUUID
} from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  mkdir
} from "node:fs/promises";
import path from "node:path";

export function getPdfStorageDirectory(): string {
  return path.join(
    app.getPath("documents"),
    "EntoLib",
    "library",
    "pdfs"
  );
}

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

// PDFのSHA-256ハッシュを計算
export function calculateFileHash(
  pdfPath: string
): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(pdfPath);

    stream.on("error", reject);

    stream.on("data", (chunk) => {
      hash.update(chunk);
    });

    stream.on("end", () => {
      resolve(hash.digest("hex"));
    });
  });
}

// PDFをEntoLib管理フォルダーへコピー
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

  // すでにEntoLib管理フォルダー内ならコピーしない
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