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

const showForm = ref(false);
const documents = ref<DocumentRecord[]>([]);
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
  const query = searchQuery.value.trim().toLocaleLowerCase();

  if (!query) {
    return documents.value;
  }

  return documents.value.filter((document) => {
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
    documents.value = await window.ipcRenderer.invoke("document:list");
  } catch (error) {
    console.error("文献一覧の取得に失敗しました:", error);
    alert("文献一覧を取得できませんでした");
  } finally {
    loading.value = false;
  }
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

    await loadDocuments();

    showForm.value = false;

    authors.value = "";
    year.value = null;
    title.value = "";
    journal.value = "";
    volume.value = "";
    issue.value = "";
    pages.value = "";
    doi.value = "";

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

onMounted(() => {
  loadDocuments();
});
</script>


<template>
  <div class="container">

    <h1>EntoLib</h1>

   <div class="toolbar">
  <input
    v-model="searchQuery"
    class="search-input"
    type="search"
    placeholder="Search authors, title, journal, DOI..."
  />

  <button @click="showForm = true">
    Add Paper
  </button>
</div>

    <table>
     <div v-if="showForm" class="form">

     <h2>Add Paper</h2>

     <label>Authors</label>
     <input type="text" v-model="authors">

     <label>Year</label>
     <input
     type="number"
     v-model.number="year"
     >

     <label>Title</label>
     <input type="text" v-model="title">

     <label>Journal</label>
     <input type="text" v-model="journal">
     <label>
      Volume
     <input type="text" v-model="volume">
      </label>

     <label>
     Issue
     <input type="text" v-model="issue">
     </label>

     <label>
     Pages
     <input
     type="text"
      v-model="pages"
      placeholder="例: 123–145"
     >
     </label>

     <label>DOI</label>
     <input type="text" v-model="doi">

     <div class="buttons">
      <button @click="saveDocument">
     Save
     </button>
     <button @click="showForm = false">Cancel</button>
     </div>

</div>
      
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
          : "まだ文献はありません"
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
        class="trash-button"
        type="button"
        @click="trashDocument(document)"
      >
        Trash
      </button>
    </td>
  </tr>
</template>
</tbody>
       </table>

  </div>
</template>
