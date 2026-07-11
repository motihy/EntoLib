<script setup lang="ts">
import { computed, onMounted, ref } from "vue";

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
  created_at: string;
  deleted_at: string | null;
}

type ViewMode = "library" | "trash";

const currentView = ref<ViewMode>("library");
const showForm = ref(false);

const documents = ref<DocumentRecord[]>([]);
const trashedDocuments = ref<DocumentRecord[]>([]);
const loading = ref(false);
const searchQuery = ref("");

const authors = ref("");
const year = ref<number | null>(null);
const title = ref("");
const journal = ref("");
const volume = ref("");
const issue = ref("");
const pages = ref("");
const doi = ref("");

const filteredDocuments = computed(() => {
  const source =
    currentView.value === "library"
      ? documents.value
      : trashedDocuments.value;

  const query = searchQuery.value.trim().toLocaleLowerCase();

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

async function loadDocuments() {
  loading.value = true;

  try {
    documents.value =
      await window.ipcRenderer.invoke("document:list");
  } catch (error) {
    console.error("文献一覧の取得に失敗しました:", error);
    alert("文献一覧を取得できませんでした");
  } finally {
    loading.value = false;
  }
}

async function loadTrashedDocuments() {
  loading.value = true;

  try {
    trashedDocuments.value =
      await window.ipcRenderer.invoke("document:trash-list");
  } catch (error) {
    console.error("ゴミ箱の取得に失敗しました:", error);
    alert("ゴミ箱を取得できませんでした");
  } finally {
    loading.value = false;
  }
}

async function showLibraryView() {
  currentView.value = "library";
  showForm.value = false;
  searchQuery.value = "";

  await loadDocuments();
}

async function showTrashView() {
  currentView.value = "trash";
  showForm.value = false;
  searchQuery.value = "";

  await loadTrashedDocuments();
}

async function saveDocument() {
  if (!authors.value.trim() || !title.value.trim()) {
    alert("AuthorsとTitleを入力してください");
    return;
  }

  try {
    await window.ipcRenderer.invoke("document:add", {
      authors: authors.value.trim(),
      year: year.value,
      title: title.value.trim(),
      journal: journal.value.trim(),
      volume: volume.value.trim(),
      issue: issue.value.trim(),
      pages: pages.value.trim(),
      doi: doi.value.trim() || null,
      pdf_path: ""
    });

    authors.value = "";
    year.value = null;
    title.value = "";
    journal.value = "";
    volume.value = "";
    issue.value = "";
    pages.value = "";
    doi.value = "";

    showForm.value = false;

    await loadDocuments();

    alert("保存しました");
  } catch (error) {
    console.error("保存に失敗しました:", error);
    alert("保存に失敗しました");
  }
}

async function trashDocument(document: DocumentRecord) {
  const confirmed = window.confirm(
    `「${document.title}」をゴミ箱へ移動しますか？`
  );

  if (!confirmed) {
    return;
  }

  try {
    const moved = await window.ipcRenderer.invoke(
      "document:trash",
      document.id
    );

    if (!moved) {
      alert("文献をゴミ箱へ移動できませんでした");
      return;
    }

    await loadDocuments();
  } catch (error) {
    console.error("ゴミ箱への移動に失敗しました:", error);
    alert("ゴミ箱への移動に失敗しました");
  }
}

async function restoreDocument(document: DocumentRecord) {
  try {
    const restored = await window.ipcRenderer.invoke(
      "document:restore",
      document.id
    );

    if (!restored) {
      alert("文献を元に戻せませんでした");
      return;
    }

    await loadTrashedDocuments();
  } catch (error) {
    console.error("文献の復元に失敗しました:", error);
    alert("文献の復元に失敗しました");
  }
}

onMounted(() => {
  loadDocuments();
});
</script>

<template>
  <div class="container">
    <h1>EntoLib</h1>

    <div class="view-tabs">
      <button
        type="button"
        :class="{ active: currentView === 'library' }"
        @click="showLibraryView"
      >
        Library
      </button>

      <button
        type="button"
        :class="{ active: currentView === 'trash' }"
        @click="showTrashView"
      >
        Trash
      </button>
    </div>

    <div class="toolbar">
      <input
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
        @click="showForm = true"
      >
        Add Paper
      </button>
    </div>

    <table>
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
          <td colspan="7">読み込み中...</td>
        </tr>

        <tr v-else-if="filteredDocuments.length === 0">
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
            <td>{{ document.authors }}</td>
            <td>{{ document.year ?? "" }}</td>
            <td>{{ document.title }}</td>
            <td>{{ document.journal ?? "" }}</td>

            <td>
              {{ document.volume ?? "" }}
              <span v-if="document.issue">
                ({{ document.issue }})
              </span>
            </td>

            <td>{{ document.pages ?? "" }}</td>

            <td>
              <button
                v-if="currentView === 'library'"
                class="trash-button"
                type="button"
                @click="trashDocument(document)"
              >
                Trash
              </button>

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
      v-if="showForm && currentView === 'library'"
      class="form"
    >
      <label>
        Authors
        <input v-model="authors" type="text" />
      </label>

      <label>
        Year
        <input v-model.number="year" type="number" />
      </label>

      <label>
        Title
        <input v-model="title" type="text" />
      </label>

      <label>
        Journal
        <input v-model="journal" type="text" />
      </label>

      <label>
        Volume
        <input v-model="volume" type="text" />
      </label>

      <label>
        Issue
        <input v-model="issue" type="text" />
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
        <input v-model="doi" type="text" />
      </label>

      <div class="buttons">
        <button type="button" @click="saveDocument">
          Save
        </button>

        <button type="button" @click="showForm = false">
          Cancel
        </button>
      </div>
    </div>
  </div>
</template>