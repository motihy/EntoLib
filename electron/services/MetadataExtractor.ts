import { readFile } from "node:fs/promises";
import {
  getDocumentProxy,
  getMeta
} from "unpdf";

export interface ExtractedDocumentMetadata {
  authors: string;
  year: number | null;
  title: string;
  journal: string;
  volume: string;
  issue: string;
  pages: string;
  doi: string;
  source: "crossref" | "pdf";
  warning: string | null;
}

interface CrossrefAuthor {
  given?: string;
  family?: string;
  name?: string;
}

interface CrossrefDate {
  "date-parts"?: number[][];
}

interface CrossrefWork {
  title?: string[];
  author?: CrossrefAuthor[];
  "container-title"?: string[];
  volume?: string;
  issue?: string;
  page?: string;
  DOI?: string;

  issued?: CrossrefDate;
  published?: CrossrefDate;
  "published-print"?: CrossrefDate;
  "published-online"?: CrossrefDate;
}

interface CrossrefResponse {
  message: CrossrefWork;
}

function toText(value: unknown): string {
  return typeof value === "string"
    ? value.trim()
    : "";
}

function cleanDoi(value: string): string {
  let doi = value
    .replace(
      /^https?:\/\/(?:dx\.)?doi\.org\//i,
      ""
    )
    .replace(/^doi:\s*/i, "")
    .trim();

  doi = doi.replace(/[.,;:]+$/g, "");

  const openingParentheses =
    (doi.match(/\(/g) ?? []).length;

  const closingParentheses =
    (doi.match(/\)/g) ?? []).length;

  if (
    doi.endsWith(")") &&
    closingParentheses > openingParentheses
  ) {
    doi = doi.slice(0, -1);
  }

  return doi;
}

function findDoi(text: string): string | null {
  const match = text.match(
    /10\.\d{4,9}\/[-._;()/:A-Z0-9]+/i
  );

  return match
    ? cleanDoi(match[0])
    : null;
}

function getYearFromCrossref(
  work: CrossrefWork
): number | null {
  const dateCandidates = [
    work["published-print"],
    work["published-online"],
    work.issued,
    work.published
  ];

  for (const candidate of dateCandidates) {
    const year =
      candidate?.["date-parts"]?.[0]?.[0];

    if (
      typeof year === "number" &&
      Number.isInteger(year)
    ) {
      return year;
    }
  }

  return null;
}

function getEmbeddedYear(
  value: unknown
): number | null {
  const text = toText(value);

  const match = text.match(
    /(?:19|20)\d{2}/
  );

  if (!match) {
    return null;
  }

  return Number(match[0]);
}

function formatAuthors(
  authors: CrossrefAuthor[] | undefined
): string {
  if (!authors?.length) {
    return "";
  }

  return authors
    .map((author) => {
      if (author.family && author.given) {
        return `${author.family}, ${author.given}`;
      }

      return (
        author.family ??
        author.given ??
        author.name ??
        ""
      );
    })
    .filter(Boolean)
    .join("; ");
}

async function readFirstPages(
  pdfPath: string,
  maximumPages = 5
): Promise<{
  text: string;
  info: Record<string, unknown>;
}> {
  const buffer = await readFile(pdfPath);

  const data = new Uint8Array(
    buffer.buffer,
    buffer.byteOffset,
    buffer.byteLength
  );

  const pdf = await getDocumentProxy(data);

  try {
    const metadata = await getMeta(pdf);

    const info =
      metadata.info as Record<
        string,
        unknown
      >;

    const pageCount = Math.min(
      pdf.numPages,
      maximumPages
    );

    const pageTexts: string[] = [];

    for (
      let pageNumber = 1;
      pageNumber <= pageCount;
      pageNumber += 1
    ) {
      const page =
        await pdf.getPage(pageNumber);

      const textContent =
        await page.getTextContent();

      const pageText = textContent.items
        .map((item) =>
          "str" in item
            ? item.str
            : ""
        )
        .join(" ");

      pageTexts.push(pageText);

      page.cleanup();
    }

    return {
      text: pageTexts.join("\n"),
      info
    };
  } finally {
    await pdf.destroy();
  }
}

async function fetchCrossrefWork(
  doi: string
): Promise<CrossrefWork | null> {
  try {
    const encodedDoi =
      encodeURIComponent(doi);

    const response = await fetch(
      `https://api.crossref.org/works/${encodedDoi}`,
      {
        headers: {
          "User-Agent":
            "EntoLib/0.0.0 (https://github.com/motihy/EntoLib)"
        }
      }
    );

    if (!response.ok) {
      return null;
    }

    const result =
      await response.json() as CrossrefResponse;

    return result.message;
  } catch (error) {
    console.error(
      "Crossref metadata request failed:",
      error
    );

    return null;
  }
}

export async function extractMetadataFromPdf(
  pdfPath: string
): Promise<ExtractedDocumentMetadata> {
  if (!pdfPath) {
    throw new Error(
      "先にPDFを選択してください"
    );
  }

  if (
    !pdfPath
      .toLocaleLowerCase()
      .endsWith(".pdf")
  ) {
    throw new Error(
      "選択されたファイルはPDFではありません"
    );
  }

  const { text, info } =
    await readFirstPages(pdfPath);

  const embeddedMetadataText =
    Object.values(info)
      .map(toText)
      .filter(Boolean)
      .join("\n");

  const doi =
    findDoi(text) ??
    findDoi(embeddedMetadataText);

  if (doi) {
    const crossrefWork =
      await fetchCrossrefWork(doi);

    if (crossrefWork) {
      return {
        authors: formatAuthors(
          crossrefWork.author
        ),
        year:
          getYearFromCrossref(
            crossrefWork
          ),
        title:
          crossrefWork.title?.[0]?.trim() ??
          "",
        journal:
          crossrefWork[
            "container-title"
          ]?.[0]?.trim() ?? "",
        volume:
          crossrefWork.volume?.trim() ??
          "",
        issue:
          crossrefWork.issue?.trim() ??
          "",
        pages:
          crossrefWork.page?.trim() ??
          "",
        doi:
          crossrefWork.DOI?.trim() ??
          doi,
        source: "crossref",
        warning: null
      };
    }
  }

  const title =
    toText(info.Title);

  const authors =
    toText(info.Author);

  const year =
    getEmbeddedYear(
      info.CreationDate
    );

  const hasReadableText =
    text.replace(/\s/g, "").length >= 30;

  let warning: string;

  if (!hasReadableText) {
    warning =
      "PDFから本文テキストを読み取れませんでした。スキャンPDFの可能性があります。入力内容を確認してください。";
  } else if (doi) {
    warning =
      "DOIは検出しましたが、Crossrefから書誌情報を取得できませんでした。PDF内の情報を使用しています。";
  } else {
    warning =
      "DOIを検出できませんでした。PDF内の埋め込み情報を使用しています。";
  }

  return {
    authors,
    year,
    title,
    journal: "",
    volume: "",
    issue: "",
    pages: "",
    doi: doi ?? "",
    source: "pdf",
    warning
  };
}