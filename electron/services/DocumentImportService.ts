import path from "node:path";

import {
  addDocument,
  findDocumentByFileHash
} from "../database/DatabaseManager";

import {
  extractMetadataFromPdf
} from "./MetadataExtractor";

import {
  calculateFileHash,
  importPdf,
  removeManagedPdf
} from "./PdfStorage";

export type BulkImportStatus =
  | "imported"
  | "duplicate"
  | "review"
  | "failed";

export interface BulkImportMetadataDraft {
  authors: string;
  year: number | null;
  title: string;
  journal: string;
  volume: string;
  issue: string;
  pages: string;
  doi: string;
}

export interface BulkImportResult {
  filePath: string;
  fileName: string;
  status: BulkImportStatus;
  title: string;
  message: string;
  metadata?: BulkImportMetadataDraft;
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

/**
 * 複数PDFを順番に解析し、登録可能なものをEntoLibへ取り込む。
 *
 * - 同じSHA-256のPDFは重複としてスキップ
 * - AuthorsまたはTitleを取得できないPDFは自動登録せず、reviewとして返す
 * - 1件の失敗で全体を停止しない
 */
export async function importDocumentsFromPdfs(
  pdfPaths: string[]
): Promise<BulkImportResult[]> {
  const uniquePdfPaths = Array.from(
    new Set(
      pdfPaths.filter(
        (pdfPath): pdfPath is string =>
          typeof pdfPath === "string" &&
          pdfPath.trim().length > 0
      )
    )
  );

  const results: BulkImportResult[] = [];

  for (const sourcePdfPath of uniquePdfPaths) {
    const fileName = path.basename(sourcePdfPath);
    let managedPdfPath = "";
    let pdfWasCopied = false;

    try {
      const fileHash = await calculateFileHash(
        sourcePdfPath
      );

      const duplicate = findDocumentByFileHash(
        fileHash
      );

      if (duplicate) {
        results.push({
          filePath: sourcePdfPath,
          fileName,
          status: "duplicate",
          title: duplicate.title,
          message: duplicate.deleted_at
            ? "同じPDFがゴミ箱に登録されています"
            : "同じPDFがLibraryに登録されています"
        });

        continue;
      }

      const metadata = await extractMetadataFromPdf(
        sourcePdfPath
      );

      const authors = metadata.authors.trim();
      const title = metadata.title.trim();

      if (!authors || !title) {
        results.push({
          filePath: sourcePdfPath,
          fileName,
          status: "review",
          title: title || fileName,
          message:
            "AuthorsまたはTitleを自動取得できなかったため、内容を確認してください",
          metadata: {
            authors,
            year: metadata.year,
            title,
            journal: metadata.journal.trim(),
            volume: metadata.volume.trim(),
            issue: metadata.issue.trim(),
            pages: metadata.pages.trim(),
            doi: metadata.doi.trim()
          }
        });

        continue;
      }

      managedPdfPath = await importPdf(
        sourcePdfPath
      );

      pdfWasCopied =
        sourcePdfPath !== managedPdfPath;

      addDocument({
        authors,
        year: metadata.year,
        title,
        journal: metadata.journal.trim(),
        volume: metadata.volume.trim(),
        issue: metadata.issue.trim(),
        pages: metadata.pages.trim(),
        doi: metadata.doi.trim() || null,
        pdf_path: managedPdfPath,
        file_hash: fileHash
      });

      results.push({
        filePath: sourcePdfPath,
        fileName,
        status: "imported",
        title,
        message:
          metadata.warning ??
          "書誌情報を自動取得して登録しました"
      });
    } catch (error) {
      if (pdfWasCopied && managedPdfPath) {
        try {
          await removeManagedPdf(managedPdfPath);
        } catch (cleanupError) {
          console.error(
            "Bulk import cleanup failed:",
            cleanupError
          );
        }
      }

      results.push({
        filePath: sourcePdfPath,
        fileName,
        status: "failed",
        title: fileName,
        message: getErrorMessage(error)
      });
    }
  }

  return results;
}
