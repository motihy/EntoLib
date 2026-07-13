<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  ref
} from "vue";

import TaxonomyView from "./components/TaxonomyView.vue";

interface DocumentRecord {
  id: number;
  authors: string;
  year: number | null;
  title: string;
  journal: string | null;
  volume: string | null;
  issue: string | null;
  pages: string | null;
  doi: string | null;
  pdf_path: string;
  file_hash: string | null;
  created_at: string;
  deleted_at: string | null;
}

interface ExtractedDocumentMetadata {
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

type BulkImportStatus =
  | "imported"
  | "duplicate"
  | "review"
  | "failed";

interface BulkImportMetadataDraft {
  authors: string;
  year: number | null;
  title: string;
  journal: string;
  volume: string;
  issue: string;
  pages: string;
  doi: string;
}

interface BulkImportResult {
  filePath: string;
  fileName: string;
  status: BulkImportStatus;
  title: string;
  message: string;
  metadata?: BulkImportMetadataDraft;
}

interface BulkReviewItem extends BulkImportMetadataDraft {
  filePath: string;
  fileName: string;
  message: string;
  saving: boolean;
  error: string;
}

type ViewMode = "library" | "trash" | "review" | "taxonomy";

type CitationFormat =
  | "bibliography"
  | "narrative"
  | "parenthetical"
  | "doi";

interface LibraryInfo {
  root: string;
  databasePath: string;
  pdfDirectory: string;
  backupDirectory: string;
}

const currentView = ref<ViewMode>("library");
const showForm = ref(false);
const editingDocumentId = ref<number | null>(null);
const formSection = ref<HTMLElement | null>(null);
const searchInput = ref<HTMLInputElement | null>(null);
const authorsInput = ref<HTMLInputElement | null>(null);

const documents = ref<DocumentRecord[]>([]);
const trashedDocuments = ref<DocumentRecord[]>([]);

const loading = ref(false);
const backupBusy = ref(false);
const extractingMetadata = ref(false);
const bulkImporting = ref(false);
const bulkSelectionCount = ref(0);
const bulkImportResults = ref<BulkImportResult[]>([]);
const reviewQueue = ref<BulkReviewItem[]>([]);
const reviewSaving = ref(false);
const searchQuery = ref("");
const libraryInfo = ref<LibraryInfo | null>(null);
const libraryBusy = ref(false);
const statusMessage = ref("");
const statusKind = ref<"success" | "error" | "info">(
  "info"
);

let statusTimer: ReturnType<typeof setTimeout> | null = null;

const authors = ref("");
const year = ref<number | null>(null);
const title = ref("");
const journal = ref("");
const volume = ref("");
const issue = ref("");
const pages = ref("");
const doi = ref("");
const pdfPath = ref("");

const filteredDocuments = computed(() => {
  const source =
    currentView.value === "library"
      ? documents.value
      : trashedDocuments.value;

  const query = searchQuery.value
    .trim()
    .toLocaleLowerCase();

  if (!query) {
    return source;
  }

  return source.filter((document) => {
    const searchableValues = [
      document.authors,
      document.year,
      document.title,
      document.journal,
      document.volume,
      document.issue,
      document.pages,
      document.doi
    ];

    return searchableValues.some((value) =>
      String(value ?? "")
        .toLocaleLowerCase()
        .includes(query)
    );
  });
});

const bulkImportSummary = computed(() => {
  const count = (status: BulkImportStatus) =>
    bulkImportResults.value.filter(
      (result) => result.status === status
    ).length;

  return {
    imported: count("imported"),
    duplicate: count("duplicate"),
    review: count("review"),
    failed: count("failed")
  };
});

function bulkStatusLabel(
  status: BulkImportStatus
): string {
  switch (status) {
    case "imported":
      return "登録済み";
    case "duplicate":
      return "重複";
    case "review":
      return "要確認";
    case "failed":
      return "失敗";
  }
}

function setStatus(
  message: string,
  kind: "success" | "error" | "info" = "info"
) {
  statusMessage.value = message;
  statusKind.value = kind;

  if (statusTimer) {
    clearTimeout(statusTimer);
  }

  statusTimer = setTimeout(() => {
    statusMessage.value = "";
    statusTimer = null;
  }, 5000);
}

async function restoreTextInputFocus(
  target: "search" | "authors" = "search"
) {
  await nextTick();

  try {
    await window.ipcRenderer.invoke(
      "window:restore-focus"
    );
  } catch (error) {
    console.error(
      "ウィンドウのフォーカス復元に失敗しました:",
      error
    );
  }

  window.focus();

  setTimeout(() => {
    const targetInput =
      target === "authors"
        ? authorsInput.value
        : searchInput.value;

    targetInput?.focus();
  }, 50);
}

function resetForm() {
  authors.value = "";
  year.value = null;
  title.value = "";
  journal.value = "";
  volume.value = "";
  issue.value = "";
  pages.value = "";
  doi.value = "";
  pdfPath.value = "";
}

async function scrollToForm() {
  await nextTick();

  formSection.value?.scrollIntoView({
    behavior: "smooth",
    block: "start"
  });
}

async function openAddForm() {
  editingDocumentId.value = null;
  resetForm();
  showForm.value = true;

  await scrollToForm();
}

async function startEdit(
  document: DocumentRecord
) {
  editingDocumentId.value = document.id;

  authors.value = document.authors;
  year.value = document.year;
  title.value = document.title;
  journal.value = document.journal ?? "";
  volume.value = document.volume ?? "";
  issue.value = document.issue ?? "";
  pages.value = document.pages ?? "";
  doi.value = document.doi ?? "";
  pdfPath.value = document.pdf_path ?? "";

  showForm.value = true;

  await scrollToForm();
}

function closeForm() {
  showForm.value = false;
  editingDocumentId.value = null;
  resetForm();
}

async function selectPdf() {
  try {
    const selectedPath =
      await window.ipcRenderer.invoke(
        "document:select-pdf"
      );

    if (selectedPath) {
      pdfPath.value = selectedPath;
    }
  } catch (error) {
    console.error(
      "PDFの選択に失敗しました:",
      error
    );

    alert("PDFを選択できませんでした");
  } finally {
    await restoreTextInputFocus("authors");
  }
}

async function bulkImportPdfs() {
  try {
    const selectedPaths =
      await window.ipcRenderer.invoke(
        "document:select-pdfs"
      ) as string[];

    if (!selectedPaths.length) {
      await restoreTextInputFocus("search");
      return;
    }

    bulkSelectionCount.value =
      selectedPaths.length;
    bulkImporting.value = true;
    bulkImportResults.value = [];

    const results =
      await window.ipcRenderer.invoke(
        "document:bulk-import",
        selectedPaths
      ) as BulkImportResult[];

    bulkImportResults.value = results;

    const newReviewItems = results
      .filter(
        (result) =>
          result.status === "review" &&
          result.metadata
      )
      .map((result) => ({
        filePath: result.filePath,
        fileName: result.fileName,
        message: result.message,
        authors: result.metadata?.authors ?? "",
        year: result.metadata?.year ?? null,
        title: result.metadata?.title ?? "",
        journal: result.metadata?.journal ?? "",
        volume: result.metadata?.volume ?? "",
        issue: result.metadata?.issue ?? "",
        pages: result.metadata?.pages ?? "",
        doi: result.metadata?.doi ?? "",
        saving: false,
        error: ""
      }));

    const existingReviewItems = new Map(
      reviewQueue.value.map((item) => [
        item.filePath,
        item
      ])
    );

    for (const item of newReviewItems) {
      existingReviewItems.set(
        item.filePath,
        item
      );
    }

    reviewQueue.value = Array.from(
      existingReviewItems.values()
    );

    await loadDocuments();

    const imported = results.filter(
      (result) =>
        result.status === "imported"
    ).length;

    const duplicate = results.filter(
      (result) =>
        result.status === "duplicate"
    ).length;

    const review = results.filter(
      (result) =>
        result.status === "review"
    ).length;

    const failed = results.filter(
      (result) =>
        result.status === "failed"
    ).length;

    setStatus(
      `一括追加完了：登録 ${imported}件・重複 ${duplicate}件・要確認 ${review}件・失敗 ${failed}件`,
      failed > 0 ? "error" : "success"
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      "PDFの一括追加に失敗しました:",
      error
    );

    alert(
      `PDFを一括追加できませんでした\n\n${message}`
    );
  } finally {
    bulkImporting.value = false;
    bulkSelectionCount.value = 0;
    await restoreTextInputFocus("search");
  }
}

async function extractPdfMetadata() {
  if (!pdfPath.value) {
    alert("先にPDFを選択してください");
    return;
  }

  extractingMetadata.value = true;

  try {
    const result =
      await window.ipcRenderer.invoke(
        "document:extract-metadata",
        pdfPath.value
      ) as ExtractedDocumentMetadata;

    if (result.authors) {
      authors.value = result.authors;
    }

    if (result.year !== null) {
      year.value = result.year;
    }

    if (result.title) {
      title.value = result.title;
    }

    if (result.journal) {
      journal.value = result.journal;
    }

    if (result.volume) {
      volume.value = result.volume;
    }

    if (result.issue) {
      issue.value = result.issue;
    }

    if (result.pages) {
      pages.value = result.pages;
    }

    if (result.doi) {
      doi.value = result.doi;
    }

    if (result.warning) {
      alert(result.warning);
    }
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      "書誌情報の抽出に失敗しました:",
      error
    );

    alert(
      `書誌情報を取得できませんでした\n\n${message}`
    );
  } finally {
    extractingMetadata.value = false;
  }
}

async function openPdf(
  document: DocumentRecord
) {
  if (!document.pdf_path) {
    alert(
      "この文献にはPDFが登録されていません"
    );
    return;
  }

  try {
    const result =
      await window.ipcRenderer.invoke(
        "document:open-pdf",
        document.pdf_path
      );

    if (!result.success) {
      alert(
        `PDFを開けませんでした\n\n${result.message}`
      );
    }
  } catch (error) {
    console.error(
      "PDFを開けませんでした:",
      error
    );

    alert("PDFを開けませんでした");
  }
}

async function loadDocuments() {
  loading.value = true;

  try {
    documents.value =
      await window.ipcRenderer.invoke(
        "document:list"
      );
  } catch (error) {
    console.error(
      "文献一覧の取得に失敗しました:",
      error
    );

    alert("文献一覧を取得できませんでした");
  } finally {
    loading.value = false;
  }
}

async function loadTrashedDocuments() {
  loading.value = true;

  try {
    trashedDocuments.value =
      await window.ipcRenderer.invoke(
        "document:trash-list"
      );
  } catch (error) {
    console.error(
      "ゴミ箱の取得に失敗しました:",
      error
    );

    alert("ゴミ箱を取得できませんでした");
  } finally {
    loading.value = false;
  }
}

async function showLibraryView() {
  currentView.value = "library";
  searchQuery.value = "";
  closeForm();

  await loadDocuments();
}

async function showTrashView() {
  currentView.value = "trash";
  searchQuery.value = "";
  closeForm();

  await loadTrashedDocuments();
}

function showReviewView() {
  currentView.value = "review";
  searchQuery.value = "";
  closeForm();
}

function getReviewErrorMessage(
  error: unknown
): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

async function saveReviewItem(
  item: BulkReviewItem,
  showSuccess = true
): Promise<boolean> {
  if (!item.authors.trim() || !item.title.trim()) {
    item.error =
      "AuthorsとTitleを入力してください";
    return false;
  }

  item.saving = true;
  item.error = "";

  try {
    await window.ipcRenderer.invoke(
      "document:add",
      {
        authors: item.authors.trim(),
        year: item.year,
        title: item.title.trim(),
        journal: item.journal.trim(),
        volume: item.volume.trim(),
        issue: item.issue.trim(),
        pages: item.pages.trim(),
        doi: item.doi.trim() || null,
        pdf_path: item.filePath
      }
    );

    reviewQueue.value =
      reviewQueue.value.filter(
        (reviewItem) =>
          reviewItem.filePath !== item.filePath
      );

    bulkImportResults.value =
      bulkImportResults.value.filter(
        (result) =>
          !(
            result.status === "review" &&
            result.filePath === item.filePath
          )
      );

    await loadDocuments();

    if (showSuccess) {
      alert("確認した文献を登録しました");
    }

    return true;
  } catch (error) {
    item.error = getReviewErrorMessage(error);
    return false;
  } finally {
    item.saving = false;
  }
}

async function saveAllReviewItems() {
  const validItems = reviewQueue.value.filter(
    (item) =>
      item.authors.trim() &&
      item.title.trim()
  );

  if (!validItems.length) {
    alert(
      "AuthorsとTitleが入力済みの文献がありません"
    );
    return;
  }

  reviewSaving.value = true;

  let savedCount = 0;

  try {
    for (const item of [...validItems]) {
      const saved = await saveReviewItem(
        item,
        false
      );

      if (saved) {
        savedCount += 1;
      }
    }
  } finally {
    reviewSaving.value = false;
  }

  alert(
    `${savedCount}件をLibraryへ登録しました`
  );
}

async function saveDocument() {
  if (
    !authors.value.trim() ||
    !title.value.trim()
  ) {
    alert(
      "AuthorsとTitleを入力してください"
    );
    return;
  }

  const documentData = {
    authors: authors.value.trim(),
    year: year.value,
    title: title.value.trim(),
    journal: journal.value.trim(),
    volume: volume.value.trim(),
    issue: issue.value.trim(),
    pages: pages.value.trim(),
    doi: doi.value.trim() || null,
    pdf_path: pdfPath.value
  };

  const isEditing =
    editingDocumentId.value !== null;

  try {
    if (isEditing) {
      const updated =
        await window.ipcRenderer.invoke(
          "document:update",
          {
            id: editingDocumentId.value,
            ...documentData
          }
        );

      if (!updated) {
        alert(
          "文献を更新できませんでした"
        );
        return;
      }
    } else {
      await window.ipcRenderer.invoke(
        "document:add",
        documentData
      );
    }

    closeForm();
    await loadDocuments();

    alert(
      isEditing
        ? "更新しました"
        : "保存しました"
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      "文献の保存に失敗しました:",
      error
    );

    alert(
      `文献を保存できませんでした\n\n${message}`
    );
  }
}

async function trashDocument(
  document: DocumentRecord
) {
  const confirmed = window.confirm(
    `「${document.title}」をゴミ箱へ移動しますか？`
  );

  if (!confirmed) {
    return;
  }

  try {
    const moved =
      await window.ipcRenderer.invoke(
        "document:trash",
        document.id
      );

    if (!moved) {
      alert(
        "文献をゴミ箱へ移動できませんでした"
      );
      return;
    }

    await loadDocuments();
  } catch (error) {
    console.error(
      "ゴミ箱への移動に失敗しました:",
      error
    );

    alert(
      "ゴミ箱への移動に失敗しました"
    );
  }
}

async function restoreDocument(
  document: DocumentRecord
) {
  try {
    const restored =
      await window.ipcRenderer.invoke(
        "document:restore",
        document.id
      );

    if (!restored) {
      alert(
        "文献を元に戻せませんでした"
      );
      return;
    }

    await loadTrashedDocuments();
  } catch (error) {
    console.error(
      "文献の復元に失敗しました:",
      error
    );

    alert(
      "文献の復元に失敗しました"
    );
  }
}

function showTaxonomyView() {
  currentView.value = "taxonomy";
  searchQuery.value = "";
  closeForm();
}
function splitAuthors(authorText: string): string[] {
  const trimmed = authorText.trim();

  if (!trimmed) {
    return [];
  }

  if (trimmed.includes(";")) {
    return trimmed
      .split(";")
      .map((author) => author.trim())
      .filter(Boolean);
  }

  return trimmed
    .split(/\s+(?:and|&)\s+/i)
    .map((author) => author.trim())
    .filter(Boolean);
}

function authorSurname(author: string): string {
  const beforeComma = author.split(",")[0]?.trim();

  if (author.includes(",") && beforeComma) {
    return beforeComma;
  }

  const words = author
    .replace(/[.]/g, "")
    .trim()
    .split(/\s+/);

  return words[words.length - 1] ?? author.trim();
}

function inTextAuthorLabel(
  document: DocumentRecord,
  narrative: boolean
): string {
  const surnames = splitAuthors(document.authors)
    .map(authorSurname)
    .filter(Boolean);

  if (surnames.length === 0) {
    return document.authors.trim() || "Unknown";
  }

  if (surnames.length === 1) {
    return surnames[0];
  }

  if (surnames.length === 2) {
    return narrative
      ? `${surnames[0]} and ${surnames[1]}`
      : `${surnames[0]} & ${surnames[1]}`;
  }

  return `${surnames[0]} et al.`;
}

function cleanDoiForCitation(value: string): string {
  return value
    .trim()
    .replace(
      /^https?:\/\/(?:dx\.)?doi\.org\//i,
      ""
    )
    .replace(/^doi:\s*/i, "");
}

function ensureFinalPeriod(value: string): string {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  return /[.!?]$/.test(trimmed)
    ? trimmed
    : `${trimmed}.`;
}

function formatBibliography(
  document: DocumentRecord
): string {
  const parts: string[] = [];

  if (document.authors.trim()) {
    parts.push(
      ensureFinalPeriod(document.authors)
    );
  }

  if (document.year !== null) {
    parts.push(`${document.year}.`);
  }

  if (document.title.trim()) {
    parts.push(
      ensureFinalPeriod(document.title)
    );
  }

  const sourceParts: string[] = [];

  if (document.journal?.trim()) {
    sourceParts.push(document.journal.trim());
  }

  let volumeIssue = document.volume?.trim() ?? "";

  if (document.issue?.trim()) {
    volumeIssue += `(${document.issue.trim()})`;
  }

  if (volumeIssue) {
    sourceParts.push(volumeIssue);
  }

  let source = sourceParts.join(" ");

  if (document.pages?.trim()) {
    source += source
      ? `: ${document.pages.trim()}`
      : document.pages.trim();
  }

  if (source) {
    parts.push(ensureFinalPeriod(source));
  }

  if (document.doi?.trim()) {
    parts.push(
      `https://doi.org/${cleanDoiForCitation(document.doi)}`
    );
  }

  return parts.join(" ");
}

function formatCitation(
  document: DocumentRecord,
  format: CitationFormat
): string {
  const citationYear =
    document.year !== null
      ? String(document.year)
      : "n.d.";

  switch (format) {
    case "bibliography":
      return formatBibliography(document);
    case "narrative":
      return `${inTextAuthorLabel(document, true)} (${citationYear})`;
    case "parenthetical":
      return `(${inTextAuthorLabel(document, false)}, ${citationYear})`;
    case "doi": {
      if (!document.doi?.trim()) {
        throw new Error(
          "この文献にはDOIが登録されていません"
        );
      }

      return `https://doi.org/${cleanDoiForCitation(document.doi)}`;
    }
  }
}

async function copyCitationFromSelect(
  document: DocumentRecord,
  event: Event
) {
  const select = event.target as HTMLSelectElement;
  const format = select.value as CitationFormat;

  if (!format) {
    return;
  }

  try {
    const citation = formatCitation(
      document,
      format
    );

    await window.ipcRenderer.invoke(
      "clipboard:write-text",
      citation
    );

    setStatus(
      `「${document.title}」の引用情報をコピーしました`,
      "success"
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    setStatus(message, "error");
  } finally {
    select.selectedIndex = 0;
    await restoreTextInputFocus("search");
  }
}

async function loadLibraryInfo() {
  try {
    libraryInfo.value =
      await window.ipcRenderer.invoke(
        "library:get-info"
      ) as LibraryInfo;
  } catch (error) {
    console.error(
      "ライブラリ情報の取得に失敗しました:",
      error
    );
  }
}

async function changeLibraryLocation() {
  libraryBusy.value = true;

  try {
    const result =
      await window.ipcRenderer.invoke(
        "library:change-location"
      );

    if (result?.canceled) {
      return;
    }

    if (!result?.success) {
      throw new Error(
        result?.message ??
          "ライブラリ保存先を変更できませんでした"
      );
    }

    alert(
      "ライブラリを新しい保存先へコピーしました。\n\nEntoLibを再起動します。元のデータは削除されていません。"
    );

    await window.ipcRenderer.invoke(
      "app:relaunch"
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error(
      "ライブラリ保存先の変更に失敗しました:",
      error
    );

    alert(
      `ライブラリ保存先を変更できませんでした\n\n${message}`
    );
  } finally {
    libraryBusy.value = false;
    await restoreTextInputFocus("search");
  }
}

async function createBackup() {
  backupBusy.value = true;

  try {
    const result = await window.ipcRenderer.invoke(
      "backup:create"
    );

    if (result?.canceled) {
      return;
    }

    if (!result?.success) {
      alert(
        result?.message ??
          "バックアップを作成できませんでした"
      );
      return;
    }

    const sizeMegabytes =
      typeof result.sizeBytes === "number"
        ? (result.sizeBytes / 1024 / 1024).toFixed(1)
        : "?";

    alert(
      "バックアップを作成しました\n\n" +
        result.path +
        "\n\nサイズ: " +
        sizeMegabytes +
        " MB"
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error("Backup failed:", error);
    alert(
      "バックアップを作成できませんでした\n\n" +
        message
    );
  } finally {
    backupBusy.value = false;
  }
}

async function restoreBackup() {
  backupBusy.value = true;

  try {
    const result = await window.ipcRenderer.invoke(
      "backup:restore"
    );

    if (result?.canceled) {
      return;
    }

    if (!result?.success) {
      alert(
        result?.message ??
          "バックアップを復元できませんでした"
      );
      return;
    }

    alert(
      (result.message ?? "バックアップを復元しました") +
        "\n\nEntoLibを再起動します。"
    );
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : String(error);

    console.error("Restore failed:", error);
    alert(
      "バックアップを復元できませんでした\n\n" +
        message
    );
  } finally {
    backupBusy.value = false;
  }
}

onMounted(() => {
  loadDocuments();
  loadLibraryInfo();
});
</script>

<template>
  <div class="container">
    <h1>EntoLib</h1>

    <div class="backup-toolbar">
      <button
        type="button"
        :disabled="backupBusy"
        @click="createBackup"
      >
        {{ backupBusy ? "処理中..." : "Backup" }}
      </button>

      <button
        type="button"
        :disabled="backupBusy"
        @click="restoreBackup"
      >
        Restore Backup
      </button>

      <button
        type="button"
        :disabled="libraryBusy || backupBusy"
        @click="changeLibraryLocation"
      >
        {{
          libraryBusy
            ? "Moving Library..."
            : "Library Location"
        }}
      </button>
    </div>

    <div class="library-location">
      <strong>Library:</strong>
      <span>{{ libraryInfo?.root ?? "読み込み中..." }}</span>
    </div>

    <p
      v-if="statusMessage"
      class="status-message"
      :class="`status-${statusKind}`"
    >
      {{ statusMessage }}
    </p>

    <div class="view-tabs">
      <button
        type="button"
        :class="{
          active: currentView === 'library'
        }"
        @click="showLibraryView"
      >
        Library
      </button>

      <button
        type="button"
        :class="{
          active: currentView === 'trash'
        }"
        @click="showTrashView"
      >
        Trash
      </button>

      <button
        type="button"
        :class="{
          active: currentView === 'review'
        }"
        @click="showReviewView"
      >
        Review ({{ reviewQueue.length }})
      </button>
      <button
        type="button"
        :class="{ active: currentView === 'taxonomy' }"
        @click="showTaxonomyView"
      >
        Taxonomy
      </button>
    </div>

    <div class="toolbar">
      <input
        v-if="currentView !== 'review' && currentView !== 'taxonomy'"
        ref="searchInput"
        v-model="searchQuery"
        class="search-input"
        type="search"
        :placeholder="
          currentView === 'library'
            ? 'Search authors, title, journal, DOI...'
            : 'Search trash...'
        "
      />

      <button
        v-if="currentView === 'library'"
        type="button"
        :disabled="bulkImporting"
        @click="bulkImportPdfs"
      >
        {{
          bulkImporting
            ? `Importing ${bulkSelectionCount} PDFs...`
            : "Add PDFs"
        }}
      </button>

      <button
        v-if="currentView === 'library'"
        type="button"
        :disabled="bulkImporting"
        @click="openAddForm"
      >
        Add Paper
      </button>
    </div>
    <TaxonomyView v-if="currentView === 'taxonomy'" />

    <section
      v-if="currentView !== 'taxonomy' && bulkImportResults.length > 0"
      class="bulk-results"
    >
      <div class="bulk-results-header">
        <h2>Bulk Import Results</h2>

        <button
          type="button"
          @click="bulkImportResults = []"
        >
          Clear
        </button>
      </div>

      <p class="bulk-summary">
        登録 {{ bulkImportSummary.imported }}件・
        重複 {{ bulkImportSummary.duplicate }}件・
        要確認 {{ bulkImportSummary.review }}件・
        失敗 {{ bulkImportSummary.failed }}件
      </p>

      <div class="bulk-result-list">
        <article
          v-for="result in bulkImportResults"
          :key="`${result.filePath}-${result.status}`"
          class="bulk-result-item"
          :class="`status-${result.status}`"
        >
          <strong>
            {{ bulkStatusLabel(result.status) }}
          </strong>

          <span>{{ result.title }}</span>

          <small>
            {{ result.fileName }} — {{ result.message }}
          </small>

          <button
            v-if="result.status === 'review'"
            class="review-button"
            type="button"
            @click="showReviewView"
          >
            Review
          </button>
        </article>
      </div>
    </section>

    <section
      v-if="currentView === 'review'"
      class="review-section"
    >
      <div class="review-header">
        <div>
          <h2>Review Queue</h2>
          <p>
            自動取得できなかった項目を補って登録します。
          </p>
        </div>

        <button
          type="button"
          :disabled="
            reviewSaving ||
            reviewQueue.length === 0
          "
          @click="saveAllReviewItems"
        >
          {{
            reviewSaving
              ? "Saving..."
              : "Save All Valid"
          }}
        </button>
      </div>

      <p v-if="reviewQueue.length === 0">
        確認が必要な文献はありません。
      </p>

      <div
        v-else
        class="review-list"
      >
        <article
          v-for="item in reviewQueue"
          :key="item.filePath"
          class="review-card"
        >
          <div class="review-file">
            <strong>{{ item.fileName }}</strong>
            <small>{{ item.message }}</small>
          </div>

          <div class="review-grid">
            <label>
              Authors
              <input
                v-model="item.authors"
                type="text"
              />
            </label>

            <label>
              Year
              <input
                v-model.number="item.year"
                type="number"
              />
            </label>

            <label class="review-title-field">
              Title
              <input
                v-model="item.title"
                type="text"
              />
            </label>

            <label>
              Journal
              <input
                v-model="item.journal"
                type="text"
              />
            </label>

            <label>
              Volume
              <input
                v-model="item.volume"
                type="text"
              />
            </label>

            <label>
              Issue
              <input
                v-model="item.issue"
                type="text"
              />
            </label>

            <label>
              Pages
              <input
                v-model="item.pages"
                type="text"
              />
            </label>

            <label>
              DOI
              <input
                v-model="item.doi"
                type="text"
              />
            </label>
          </div>

          <p
            v-if="item.error"
            class="review-error"
          >
            {{ item.error }}
          </p>

          <div class="review-actions">
            <button
              type="button"
              :disabled="item.saving"
              @click="saveReviewItem(item)"
            >
              {{
                item.saving
                  ? "Saving..."
                  : "Add to Library"
              }}
            </button>
          </div>
        </article>
      </div>
    </section>

    <table v-if="currentView !== 'review' && currentView !== 'taxonomy'">
      <thead>
        <tr>
          <th>Authors</th>
          <th>Year</th>
          <th>Title</th>
          <th>Journal</th>
          <th>Volume</th>
          <th>Pages</th>
          <th>Actions</th>
        </tr>
      </thead>

      <tbody>
        <tr v-if="loading">
          <td colspan="7">
            読み込み中...
          </td>
        </tr>

        <tr
          v-else-if="
            filteredDocuments.length === 0
          "
        >
          <td colspan="7">
            {{
              searchQuery.trim()
                ? "一致する文献がありません"
                : currentView === "library"
                  ? "まだ文献はありません"
                  : "ゴミ箱は空です"
            }}
          </td>
        </tr>

        <template v-else>
          <tr
            v-for="document in filteredDocuments"
            :key="document.id"
          >
            <td>
              {{ document.authors }}
            </td>

            <td>
              {{ document.year ?? "" }}
            </td>

            <td>
              {{ document.title }}
            </td>

            <td>
              {{ document.journal ?? "" }}
            </td>

            <td>
              {{ document.volume ?? "" }}

              <span v-if="document.issue">
                ({{ document.issue }})
              </span>
            </td>

            <td>
              {{ document.pages ?? "" }}
            </td>

            <td>
              <div
                v-if="currentView === 'library'"
                class="action-buttons"
              >
                <button
                  class="open-button"
                  type="button"
                  :disabled="!document.pdf_path"
                  @click="openPdf(document)"
                >
                  Open PDF
                </button>

                <select
                  class="citation-select"
                  aria-label="引用情報をコピー"
                  @change="copyCitationFromSelect(document, $event)"
                >
                  <option value="" selected disabled>
                    Copy citation...
                  </option>
                  <option value="bibliography">
                    Reference list
                  </option>
                  <option value="narrative">
                    Author (Year)
                  </option>
                  <option value="parenthetical">
                    (Author, Year)
                  </option>
                  <option
                    value="doi"
                    :disabled="!document.doi"
                  >
                    DOI link
                  </option>
                </select>

                <button
                  class="edit-button"
                  type="button"
                  @click="startEdit(document)"
                >
                  Edit
                </button>

                <button
                  class="trash-button"
                  type="button"
                  @click="trashDocument(document)"
                >
                  Trash
                </button>
              </div>

              <button
                v-else
                class="restore-button"
                type="button"
                @click="restoreDocument(document)"
              >
                Restore
              </button>
            </td>
          </tr>
        </template>
      </tbody>
    </table>

    <div
      v-if="
        showForm &&
        currentView === 'library'
      "
      ref="formSection"
      class="form"
    >
      <h2>
        {{
          editingDocumentId === null
            ? "Add Paper"
            : "Edit Paper"
        }}
      </h2>

      <label>
        Authors

        <input
          ref="authorsInput"
          v-model="authors"
          type="text"
        />
      </label>

      <label>
        Year

        <input
          v-model.number="year"
          type="number"
        />
      </label>

      <label>
        Title

        <input
          v-model="title"
          type="text"
        />
      </label>

      <label>
        Journal

        <input
          v-model="journal"
          type="text"
        />
      </label>

      <label>
        Volume

        <input
          v-model="volume"
          type="text"
        />
      </label>

      <label>
        Issue

        <input
          v-model="issue"
          type="text"
        />
      </label>

      <label>
        Pages

        <input
          v-model="pages"
          type="text"
          placeholder="例: 123–145"
        />
      </label>

      <label>
        DOI

        <input
          v-model="doi"
          type="text"
        />
      </label>

      <label>
        PDF

        <div class="pdf-select-row">
          <input
            v-model="pdfPath"
            type="text"
            readonly
            placeholder="PDFは選択されていません"
          />

          <button
            type="button"
            @click="selectPdf"
          >
            Select PDF
          </button>

          <button
            type="button"
            :disabled="
              !pdfPath ||
              extractingMetadata
            "
            @click="extractPdfMetadata"
          >
            {{
              extractingMetadata
                ? "Reading..."
                : "Extract Metadata"
            }}
          </button>
        </div>
      </label>

      <div class="buttons">
        <button
          type="button"
          @click="saveDocument"
        >
          {{
            editingDocumentId === null
              ? "Save"
              : "Update"
          }}
        </button>

        <button
          type="button"
          @click="closeForm"
        >
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.bulk-results {
  margin: 16px 0 20px;
  padding: 16px;
  border: 1px solid #d0d0d0;
  border-radius: 8px;
  background: #ffffff;
}

.bulk-results-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.bulk-results-header h2 {
  margin: 0;
  font-size: 18px;
}

.bulk-summary {
  margin: 10px 0;
  font-weight: 600;
}

.bulk-result-list {
  display: grid;
  gap: 8px;
  max-height: 260px;
  overflow-y: auto;
}

.bulk-result-item {
  display: grid;
  grid-template-columns: 72px minmax(180px, 1fr) auto;
  gap: 4px 10px;
  padding: 10px;
  border-left: 4px solid #777777;
  background: #f7f7f7;
}

.bulk-result-item small {
  grid-column: 2;
  overflow-wrap: anywhere;
}

.review-button {
  grid-column: 3;
  grid-row: 1 / span 2;
  align-self: center;
}

.status-imported {
  border-left-color: #357a38;
}

.status-duplicate {
  border-left-color: #8a6d1d;
}

.status-review {
  border-left-color: #9a5a00;
}

.status-failed {
  border-left-color: #b94a48;
}

.review-section {
  margin: 16px 0 20px;
  padding: 16px;
  border: 1px solid #d0d0d0;
  border-radius: 8px;
  background: #ffffff;
}

.review-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 16px;
}

.review-header h2,
.review-header p {
  margin: 0;
}

.review-header p {
  margin-top: 4px;
}

.review-list {
  display: grid;
  gap: 16px;
}

.review-card {
  padding: 14px;
  border: 1px solid #d8d8d8;
  border-radius: 8px;
  background: #fafafa;
}

.review-file {
  display: grid;
  gap: 4px;
  margin-bottom: 12px;
  overflow-wrap: anywhere;
}

.review-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(130px, 1fr));
  gap: 10px;
}

.review-grid label {
  display: grid;
  gap: 5px;
  font-size: 13px;
  font-weight: 600;
}

.review-grid input {
  min-width: 0;
  padding: 8px;
  border: 1px solid #cccccc;
  border-radius: 5px;
  background: #ffffff;
}

.review-title-field {
  grid-column: span 2;
}

.review-error {
  margin: 10px 0 0;
  color: #b94a48;
  white-space: pre-wrap;
}

.review-actions {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

@media (max-width: 900px) {
  .review-grid {
    grid-template-columns: repeat(2, minmax(130px, 1fr));
  }
}

</style>

