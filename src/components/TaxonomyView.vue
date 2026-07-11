<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";

type TaxonRank =
  | "order"
  | "family"
  | "subfamily"
  | "tribe"
  | "genus"
  | "species"
  | "subspecies";

interface TaxonRecord {
  id: number;
  rank: TaxonRank;
  order_name: string;
  family: string;
  subfamily: string;
  tribe: string;
  genus: string;
  species: string;
  subspecies: string;
  authority: string;
  nomenclatural_year: number | null;
  scientific_name: string;
  type_repository: string;
  distribution_notes: string;
  notes: string;
  synonyms: string[];
  document_count: number;
}

interface DocumentRecord {
  id: number;
  authors: string;
  year: number | null;
  title: string;
  journal: string | null;
}

interface TaxonForm {
  rank: TaxonRank;
  order_name: string;
  family: string;
  subfamily: string;
  tribe: string;
  genus: string;
  species: string;
  subspecies: string;
  authority: string;
  nomenclatural_year: number | null;
  scientific_name: string;
  type_repository: string;
  distribution_notes: string;
  notes: string;
  synonymsText: string;
}

const ranks: TaxonRank[] = [
  "order",
  "family",
  "subfamily",
  "tribe",
  "genus",
  "species",
  "subspecies"
];

const taxa = ref<TaxonRecord[]>([]);
const documents = ref<DocumentRecord[]>([]);
const selectedTaxonId = ref<number | null>(null);
const linkedDocumentIds = ref<number[]>([]);
const taxonSearch = ref("");
const documentSearch = ref("");
const loading = ref(false);
const saving = ref(false);

const form = reactive<TaxonForm>({
  rank: "species",
  order_name: "",
  family: "",
  subfamily: "",
  tribe: "",
  genus: "",
  species: "",
  subspecies: "",
  authority: "",
  nomenclatural_year: null,
  scientific_name: "",
  type_repository: "",
  distribution_notes: "",
  notes: "",
  synonymsText: ""
});

const selectedTaxon = computed(() =>
  taxa.value.find((taxon) => taxon.id === selectedTaxonId.value) ?? null
);

const filteredDocuments = computed(() => {
  const query = documentSearch.value.trim().toLocaleLowerCase();
  if (!query) {
    return documents.value;
  }

  return documents.value.filter((document) =>
    [
      document.authors,
      document.year,
      document.title,
      document.journal
    ].some((value) =>
      String(value ?? "")
        .toLocaleLowerCase()
        .includes(query)
    )
  );
});

function resetForm(): void {
  Object.assign(form, {
    rank: "species",
    order_name: "",
    family: "",
    subfamily: "",
    tribe: "",
    genus: "",
    species: "",
    subspecies: "",
    authority: "",
    nomenclatural_year: null,
    scientific_name: "",
    type_repository: "",
    distribution_notes: "",
    notes: "",
    synonymsText: ""
  });
  selectedTaxonId.value = null;
  linkedDocumentIds.value = [];
}

function selectTaxon(taxon: TaxonRecord): void {
  selectedTaxonId.value = taxon.id;
  Object.assign(form, {
    rank: taxon.rank,
    order_name: taxon.order_name ?? "",
    family: taxon.family ?? "",
    subfamily: taxon.subfamily ?? "",
    tribe: taxon.tribe ?? "",
    genus: taxon.genus ?? "",
    species: taxon.species ?? "",
    subspecies: taxon.subspecies ?? "",
    authority: taxon.authority ?? "",
    nomenclatural_year: taxon.nomenclatural_year,
    scientific_name: taxon.scientific_name ?? "",
    type_repository: taxon.type_repository ?? "",
    distribution_notes: taxon.distribution_notes ?? "",
    notes: taxon.notes ?? "",
    synonymsText: taxon.synonyms.join("\n")
  });

  loadLinkedDocuments(taxon.id);
}

function formPayload() {
  return {
    ...form,
    synonyms: form.synonymsText
      .split(/\r?\n/)
      .map((value) => value.trim())
      .filter(Boolean)
  };
}

async function loadTaxa(): Promise<void> {
  loading.value = true;
  try {
    taxa.value = await window.ipcRenderer.invoke(
      "taxon:list",
      taxonSearch.value
    );
  } finally {
    loading.value = false;
  }
}

async function loadDocuments(): Promise<void> {
  documents.value = await window.ipcRenderer.invoke("document:list");
}

async function loadLinkedDocuments(taxonId: number): Promise<void> {
  linkedDocumentIds.value = await window.ipcRenderer.invoke(
    "taxon:linked-document-ids",
    taxonId
  );
}

async function saveTaxon(): Promise<void> {
  saving.value = true;
  try {
    if (selectedTaxonId.value === null) {
      const created = await window.ipcRenderer.invoke(
        "taxon:create",
        formPayload()
      ) as TaxonRecord;
      await loadTaxa();
      selectTaxon(created);
      alert("分類群を登録しました");
    } else {
      const updated = await window.ipcRenderer.invoke(
        "taxon:update",
        selectedTaxonId.value,
        formPayload()
      ) as TaxonRecord;
      await loadTaxa();
      selectTaxon(updated);
      alert("分類群を更新しました");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    alert(`分類群を保存できませんでした\n\n${message}`);
  } finally {
    saving.value = false;
  }
}

async function removeTaxon(): Promise<void> {
  if (selectedTaxonId.value === null || !selectedTaxon.value) {
    return;
  }

  const confirmed = window.confirm(
    `「${selectedTaxon.value.scientific_name}」を削除しますか？`
  );
  if (!confirmed) {
    return;
  }

  await window.ipcRenderer.invoke("taxon:trash", selectedTaxonId.value);
  resetForm();
  await loadTaxa();
}

async function toggleDocumentLink(documentId: number): Promise<void> {
  if (selectedTaxonId.value === null) {
    alert("先に分類群を選択または登録してください");
    return;
  }

  const linked = linkedDocumentIds.value.includes(documentId);
  await window.ipcRenderer.invoke(
    linked ? "taxon:unlink-document" : "taxon:link-document",
    selectedTaxonId.value,
    documentId
  );

  await loadLinkedDocuments(selectedTaxonId.value);
  await loadTaxa();
}

onMounted(async () => {
  await Promise.all([loadTaxa(), loadDocuments()]);
});
</script>

<template>
  <section class="taxonomy-view">
    <div class="taxonomy-sidebar">
      <div class="taxonomy-sidebar-header">
        <h2>Taxonomy</h2>
        <button type="button" @click="resetForm">New Taxon</button>
      </div>

      <input
        v-model="taxonSearch"
        type="search"
        placeholder="Search taxon or synonym..."
        @input="loadTaxa"
      />

      <p v-if="loading">読み込み中...</p>
      <p v-else-if="taxa.length === 0">分類群はまだありません。</p>

      <button
        v-for="taxon in taxa"
        :key="taxon.id"
        type="button"
        class="taxon-list-item"
        :class="{ active: taxon.id === selectedTaxonId }"
        @click="selectTaxon(taxon)"
      >
        <strong>{{ taxon.scientific_name }}</strong>
        <span>
          {{ taxon.rank }} · {{ taxon.document_count }} literature
        </span>
      </button>
    </div>

    <div class="taxonomy-main">
      <div class="taxonomy-form-header">
        <div>
          <h2>{{ selectedTaxonId === null ? "Add Taxon" : "Edit Taxon" }}</h2>
          <p>分類階級・学名・シノニム・産地・タイプ標本情報を管理します。</p>
        </div>

        <div class="taxonomy-actions">
          <button type="button" :disabled="saving" @click="saveTaxon">
            {{ saving ? "Saving..." : selectedTaxonId === null ? "Save" : "Update" }}
          </button>
          <button
            v-if="selectedTaxonId !== null"
            type="button"
            class="danger-button"
            @click="removeTaxon"
          >
            Delete
          </button>
        </div>
      </div>

      <div class="taxonomy-grid">
        <label>
          Rank
          <select v-model="form.rank">
            <option v-for="rank in ranks" :key="rank" :value="rank">
              {{ rank }}
            </option>
          </select>
        </label>

        <label>
          Scientific name
          <input
            v-model="form.scientific_name"
            type="text"
            placeholder="自動生成も可"
          />
        </label>

        <label>Order<input v-model="form.order_name" type="text" /></label>
        <label>Family<input v-model="form.family" type="text" /></label>
        <label>Subfamily<input v-model="form.subfamily" type="text" /></label>
        <label>Tribe<input v-model="form.tribe" type="text" /></label>
        <label>Genus<input v-model="form.genus" type="text" /></label>
        <label>Species<input v-model="form.species" type="text" /></label>
        <label>Subspecies<input v-model="form.subspecies" type="text" /></label>
        <label>Authority<input v-model="form.authority" type="text" /></label>
        <label>
          Nomenclatural year
          <input v-model.number="form.nomenclatural_year" type="number" />
        </label>
        <label>
          Type repository
          <input v-model="form.type_repository" type="text" />
        </label>

        <label class="wide-field">
          Synonyms（1行に1つ）
          <textarea v-model="form.synonymsText" rows="4" />
        </label>

        <label class="wide-field">
          Recorded localities / distribution
          <textarea v-model="form.distribution_notes" rows="4" />
        </label>

        <label class="wide-field">
          Notes
          <textarea v-model="form.notes" rows="4" />
        </label>
      </div>

      <section class="linked-literature">
        <div class="linked-literature-header">
          <div>
            <h3>Related literature</h3>
            <p>チェックを切り替えて、分類群と文献を関連付けます。</p>
          </div>
          <input
            v-model="documentSearch"
            type="search"
            placeholder="Search literature..."
          />
        </div>

        <p v-if="selectedTaxonId === null">
          文献を関連付けるには、分類群を保存または選択してください。
        </p>

        <label
          v-for="document in filteredDocuments"
          :key="document.id"
          class="document-link-row"
        >
          <input
            type="checkbox"
            :disabled="selectedTaxonId === null"
            :checked="linkedDocumentIds.includes(document.id)"
            @change="toggleDocumentLink(document.id)"
          />
          <span>
            <strong>{{ document.authors }} ({{ document.year ?? "n.d." }})</strong>
            {{ document.title }}
          </span>
        </label>
      </section>
    </div>
  </section>
</template>

<style scoped>
.taxonomy-view {
  display: grid;
  grid-template-columns: 290px minmax(0, 1fr);
  gap: 20px;
  align-items: start;
}

.taxonomy-sidebar,
.taxonomy-main {
  background: white;
  border: 1px solid #d8d8d8;
  border-radius: 8px;
  padding: 18px;
}

.taxonomy-sidebar {
  position: sticky;
  top: 16px;
  max-height: calc(100vh - 70px);
  overflow: auto;
}

.taxonomy-sidebar-header,
.taxonomy-form-header,
.linked-literature-header,
.taxonomy-actions {
  display: flex;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}

.taxonomy-sidebar h2,
.taxonomy-main h2,
.linked-literature h3 {
  margin: 0;
}

.taxonomy-sidebar > input,
.linked-literature-header input {
  width: 100%;
  box-sizing: border-box;
  padding: 9px;
  margin: 14px 0;
}

.taxon-list-item {
  width: 100%;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 4px;
  margin-bottom: 7px;
  padding: 10px;
  background: white;
  border: 1px solid #d8d8d8;
  border-radius: 6px;
  text-align: left;
}

.taxon-list-item.active {
  border-color: #333;
  background: #f0f0f0;
}

.taxon-list-item span {
  font-size: 12px;
  color: #666;
}

.taxonomy-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-top: 20px;
}

.taxonomy-grid label {
  display: flex;
  flex-direction: column;
  gap: 5px;
  font-weight: 600;
}

.taxonomy-grid input,
.taxonomy-grid select,
.taxonomy-grid textarea {
  width: 100%;
  box-sizing: border-box;
  padding: 9px;
  font: inherit;
  font-weight: normal;
}

.wide-field {
  grid-column: 1 / -1;
}

.danger-button {
  border-color: #b94a48;
  color: #b94a48;
  background: white;
}

.linked-literature {
  margin-top: 28px;
  border-top: 1px solid #ddd;
  padding-top: 20px;
}

.linked-literature-header input {
  max-width: 360px;
  margin: 0;
}

.document-link-row {
  display: flex;
  gap: 10px;
  align-items: flex-start;
  border-bottom: 1px solid #eee;
  padding: 9px 0;
}

.document-link-row input {
  margin-top: 4px;
}

.document-link-row span {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

@media (max-width: 900px) {
  .taxonomy-view {
    grid-template-columns: 1fr;
  }

  .taxonomy-sidebar {
    position: static;
    max-height: none;
  }

  .taxonomy-grid {
    grid-template-columns: 1fr;
  }

  .wide-field {
    grid-column: auto;
  }
}
</style>
