<script setup lang="ts">
import { ref } from "vue";

const showForm = ref(false);

const authors = ref("");
const year = ref<number | null>(null);
const title = ref("");
const journal = ref("");
const doi = ref("");

async function saveDocument() {
  await window.ipcRenderer.invoke("document:add", {
    authors: authors.value,
    year: year.value,
    title: title.value,
    journal: journal.value,
    doi: doi.value,
    pdf_path: ""
  });

  alert("保存しました");

  showForm.value = false;

  authors.value = "";
  year.value = null;
  title.value = "";
  journal.value = "";
  doi.value = "";
}
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
     <input type="number" v-model="year">

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
        <tr>
          <td colspan="3">まだ文献はありません</td>
        </tr>
      </tbody>

    </table>

  </div>
</template>
