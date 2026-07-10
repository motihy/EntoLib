<script setup lang="ts">
import { onMounted, ref } from "vue";

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
}

const showForm = ref(false);
const documents = ref<DocumentRecord[]>([]);
const loading = ref(false);

const authors = ref("");
const year = ref<number | null>(null);
const title = ref("");
const journal = ref("");
const doi = ref("");

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
      doi: doi.value.trim() || null,
      pdf_path: ""
    });

    await loadDocuments();

    showForm.value = false;

    authors.value = "";
    year.value = null;
    title.value = "";
    journal.value = "";
    doi.value = "";

    alert("保存しました");
  } catch (error) {
    console.error("保存に失敗しました:", error);
    alert("保存に失敗しました");
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
        </tr>
      </thead>

      <tbody>
        <tr v-if="loading">
       <td colspan="3">読み込み中...</td>
       </tr>

        <tr v-else-if="documents.length === 0">
       <td colspan="3">まだ文献はありません</td>
        </tr>

       <tr
       v-else
       v-for="document in documents"
       :key="document.id"
       >
        <td>{{ document.authors }}</td>
        <td>{{ document.year ?? "" }}</td>
        <td>{{ document.title }}</td>
       </tr>
       </tbody>

       </table>

  </div>
</template>
