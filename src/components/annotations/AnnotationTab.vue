<template>
  <div class="annotation-tab">
    <div class="annotation-tab__header">
      <Message v-if="sharedCount > 1" severity="info" size="small" data-test="shared-banner">
        Shared by {{ sharedCount }} instances: these annotations belong to the math, so they apply to each one.
      </Message>

      <div class="annotation-tab__kind">
        <span class="annotation-tab__label">Module</span>
        <SelectButton
          :model-value="kindValue"
          :options="KIND_OPTIONS"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          size="small"
          aria-label="Module kind"
          data-test="module-kind"
          @update:model-value="setKind"
        />
        <InputText
          v-if="kindValue === 'transporter'"
          v-model="accessionText"
          :invalid="!accession && (!!accessionText.trim() || !kind.transporter)"
          placeholder="UniProt accession, e.g. P11168"
          aria-label="UniProt accession"
          size="small"
          class="annotation-tab__accession"
          data-test="uniprot-accession"
          @update:model-value="commitAccession"
        />
      </div>

      <div class="annotation-tab__toolbar">
        <SelectButton
          v-model="filter"
          :options="FILTER_OPTIONS"
          option-label="label"
          option-value="value"
          :allow-empty="false"
          size="small"
          aria-label="Show variables"
          data-test="filter"
        />
        <label class="annotation-tab__toggle">
          <ToggleSwitch v-model="showConstants" aria-label="Show constants" data-test="show-constants" />
          <span>Show constants</span>
        </label>
      </div>

      <Message v-if="!isBound" severity="secondary" size="small" variant="simple" data-test="unbound-hint">
        Bind this instance to an ApiCoord for coupling suggestions.
      </Message>
    </div>

    <div class="annotation-tab__rows">
      <div
        v-for="row in shownRows"
        :key="row.name"
        :class="['annotation-row', { 'annotation-row--editing': editingName === row.name }]"
        :data-variable="row.name"
      >
        <div class="annotation-row__head">
          <span class="annotation-row__name">{{ row.name }}</span>
          <span v-if="row.units" class="annotation-row__units">{{ row.units }}</span>
          <span class="annotation-row__body">
            <template v-if="row.entry">
              <AnnotationChips
                :annotation="{ ...row.entry, variable: row.name }"
                :variable="row.name"
                :limit="3"
                :is-bound="isBound"
              />
              <Button
                icon="pi pi-pencil"
                text
                rounded
                size="small"
                severity="secondary"
                :aria-label="`Edit the annotation of ${row.name}`"
                data-test="edit-annotation"
                @click="startEditing(row)"
              />
              <Button
                icon="pi pi-times"
                text
                rounded
                size="small"
                severity="secondary"
                :aria-label="`Clear the annotation of ${row.name}`"
                data-test="clear-annotation"
                @click="clearEntry(row)"
              />
            </template>
            <Button
              v-else-if="editingName !== row.name"
              label="Annotate…"
              link
              size="small"
              class="annotation-row__annotate"
              data-test="annotate"
              @click="startEditing(row)"
            />
          </span>
        </div>

        <div v-if="editingName === row.name" class="annotation-editor" data-test="annotation-editor">
          <label class="annotation-editor__label" :for="`annotation-property-${row.name}`">Property</label>
          <Select
            v-model="form.property"
            :input-id="`annotation-property-${row.name}`"
            :options="PROPERTY_OPTIONS"
            option-label="label"
            option-value="value"
            placeholder="Choose a property"
            show-clear
            size="small"
            data-test="property"
          />

          <span class="annotation-editor__label">Species</span>
          <div>
            <AutoComplete
              :model-value="speciesItems"
              :suggestions="speciesSuggestions"
              option-label="label"
              multiple
              fluid
              size="small"
              :delay="120"
              placeholder="Type a species, or paste a ChEBI CURIE or IRI"
              aria-label="Species"
              data-test="species"
              @complete="(event) => findSpecies(event.query)"
              @update:model-value="setSpecies"
            >
              <template #option="{ option }">
                <span class="species-option">
                  <span>{{ option.label }}</span>
                  <span class="species-option__curie">{{ option.curie }}</span>
                </span>
              </template>
              <template #empty>{{ speciesNotice || 'No species matches.' }}</template>
            </AutoComplete>
          </div>

          <span class="annotation-editor__label">Where</span>
          <SelectButton
            v-model="form.location"
            :options="LOCATION_OPTIONS"
            option-label="label"
            option-value="value"
            size="small"
            aria-label="Where"
            class="annotation-editor__where"
            data-test="location"
          />

          <span class="annotation-editor__label">Port</span>
          <span class="annotation-editor__derived" data-test="derived">
            <template v-if="formRole">
              <span :title="ROLE_DESCRIPTIONS[formRole]">{{ formRole }}</span>
              · {{ MULTIPORT_TEXT[multiportTypeFor(formRole)] }} · {{ formPortStatus }}
            </template>
            <template v-else>No port until it has a property and a place</template>
          </span>

          <div class="annotation-editor__actions">
            <Button label="Cancel" text size="small" severity="secondary" @click="stopEditing" />
            <Button label="Done" size="small" data-test="done" @click="commitForm" />
          </div>
        </div>
      </div>

      <div v-if="!shownRows.length" class="annotation-tab__empty">No variables to show.</div>
    </div>

    <details v-if="otherTriples.length" class="annotation-tab__other" data-test="other-annotations">
      <summary>Other annotations ({{ otherTriples.length }})</summary>
      <p class="annotation-tab__other-note">Kept as written; this tab doesn’t edit them.</p>
      <ul>
        <li v-for="(line, i) in otherTriples" :key="i" class="annotation-tab__other-line">
          {{ line.subject }} {{ line.predicate }} {{ line.object }}
        </li>
      </ul>
    </details>
  </div>
</template>

<script setup>
/**
 * The instance editor's Annotations tab: the module's kind and each variable's property, species and place, as a
 * draft the editor saves with the instance. The sidecar belongs to the math, so every instance of it shares it.
 */
import { computed, reactive, ref, watch } from 'vue'

import AutoComplete from 'primevue/autocomplete'
import Button from 'primevue/button'
import InputText from 'primevue/inputtext'
import Message from 'primevue/message'
import Select from 'primevue/select'
import SelectButton from 'primevue/selectbutton'
import ToggleSwitch from 'primevue/toggleswitch'

import AnnotationChips from '../AnnotationChips.vue'
import { ROLE_DESCRIPTIONS, subjectText } from '../../services/annotations/display'
import {
  classifyAnnotationRow,
  getDraftEntry,
  getDraftKind,
  setDraftEntry,
  setDraftKind,
} from '../../services/annotations/draft'
import { GO, OPB, canonicalCurie, hasPrefix } from '../../services/annotations/iris'
import { displayLabel } from '../../services/annotations/labels'
import { roleOf } from '../../services/annotations/match'
import { multiportTypeFor } from '../../services/annotations/ports'
import { listOtherTriples } from '../../services/annotations/sidecarEdit'
import { parseSpeciesTerm, searchSpecies } from '../../services/annotations/species'

const props = defineProps({
  // Parameter rows, from useMathSession.
  rows: { type: Array, default: () => [] },
  // Each variable's kind, from useMathSession, or null before the math is analysed.
  variableKinds: { type: Map, default: null },
  // The math's parsed sidecar, under the editor's variable names; null when it has none.
  sidecar: { type: Object, default: null },
  // The sidecar's text, for the triples this tab doesn't edit.
  sidecarText: { type: String, default: null },
  // The unsaved edits, from createAnnotationDraft.
  draft: { type: Object, required: true },
  mathRef: { type: String, required: true },
  // The math, to find variables a sidecar names by '#id'.
  cellml: { type: String, default: '' },
  // How many instances use this math.
  sharedCount: { type: Number, default: 1 },
  // Whether the instance is bound to an ApiCoord.
  isBound: { type: Boolean, default: false },
  // Each annotated variable's port: 'connected' or 'exists'; a variable without one gets it on save.
  portStatus: { type: Map, default: () => new Map() },
  // ChEBI CURIEs other sidecars in the workspace use.
  workspaceTerms: { type: Array, default: () => [] },
  // Finds species for typed text, as { curie, label }; may return a promise. Defaults to the local table.
  findSpeciesTerms: { type: Function, default: null },
})

const emit = defineEmits(['update:draft'])

const KIND_OPTIONS = [
  { value: 'compartment', label: 'Compartment' },
  { value: 'membrane', label: 'Membrane' },
  { value: 'transporter', label: 'Transporter' },
  { value: 'none', label: 'None' },
]

const FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'unannotated', label: 'Unannotated' },
  { value: 'annotated', label: 'Annotated' },
]

const PROPERTY_OPTIONS = [
  OPB.concentration,
  OPB.molarFlowRate,
  OPB.fluidVolume,
  OPB.spatialArea,
  OPB.electricalPotential,
  OPB.chargeFlowRate,
].map((curie) => ({ value: curie, label: `${displayLabel(curie)} (${curie})` }))

const LOCATION_OPTIONS = [
  { value: 'self', label: 'This compartment' },
  { value: `self+${GO.plasmaMembrane}`, label: 'Its membrane' },
  { value: GO.cytoplasm, label: 'Cytoplasm' },
  { value: GO.extracellularRegion, label: 'Extracellular' },
  { value: GO.plasmaMembrane, label: 'Plasma membrane' },
]

const MULTIPORT_TEXT = { True: 'multiport', Sum: 'multiport, summed', None: 'basicport' }

// UniProt's accession format.
const ACCESSION_PATTERN = /^([OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9]([A-Z][A-Z0-9]{2}[0-9]){1,2})$/

const filter = ref('all')
const showConstants = ref(false)

// ── Module kind ─────────────────────────────────────────────────────────────
const kind = computed(() => getDraftKind(props.draft, props.sidecar))
const kindValue = computed(() => kind.value.componentKind ?? 'none')
const accessionText = ref('')

watch(
  () => kind.value.transporter,
  (transporter) => {
    if (transporter) accessionText.value = transporter.slice('uniprot:'.length)
  },
  { immediate: true }
)

/**
 * Reads typed text as a UniProt accession.
 *
 * @param {string} text - A bare accession, CURIE or IRI.
 * @returns {string|null} The uniprot CURIE, or null when it is not one.
 */
function parseAccession(text) {
  const trimmed = String(text ?? '').trim()
  if (!trimmed) return null
  const curie = canonicalCurie(trimmed)
  const id = hasPrefix(curie, 'uniprot') ? curie.slice('uniprot:'.length) : trimmed.toUpperCase()
  return ACCESSION_PATTERN.test(id) ? `uniprot:${id}` : null
}

const accession = computed(() => parseAccession(accessionText.value))

/**
 * Sets the module's kind.
 *
 * @param {'compartment'|'membrane'|'transporter'|'none'} value
 */
function setKind(value) {
  const componentKind = value === 'none' ? null : value
  emit('update:draft', setDraftKind(props.draft, props.sidecar, componentKind, componentKind === 'transporter' ? accession.value : null))
}

/** Sets the transporter's accession once it is a valid one, or drops it when the box is emptied. */
function commitAccession() {
  if (accessionText.value.trim() && !accession.value) return
  emit('update:draft', setDraftKind(props.draft, props.sidecar, 'transporter', accession.value))
}

// ── Rows ────────────────────────────────────────────────────────────────────
const annotationRows = computed(() =>
  props.rows
    .map((row) => ({
      name: row.name,
      units: row.units,
      role: classifyAnnotationRow(row, props.variableKinds),
      entry: getDraftEntry(props.draft, props.sidecar, row.name),
    }))
    .filter((row) => row.role !== 'voi')
)

const shownRows = computed(() =>
  annotationRows.value.filter((row) => {
    if (row.role === 'constant' && !showConstants.value && !row.entry && editingName.value !== row.name) return false
    if (filter.value === 'annotated') return !!row.entry
    if (filter.value === 'unannotated') return !row.entry
    return true
  })
)

// ── Inline editor ───────────────────────────────────────────────────────────
const editingName = ref(null)
const form = reactive({ property: null, species: [], location: null })

/**
 * Opens the inline editor on a row, filled from its annotation.
 *
 * @param {{ name: string, entry: Object|null }} row
 */
function startEditing(row) {
  editingName.value = row.name
  form.property = row.entry?.property ?? null
  form.species = [...(row.entry?.species ?? [])]
  form.location = row.entry?.location ?? null
  speciesNotice.value = ''
}

function stopEditing() {
  editingName.value = null
}

/** Puts the inline editor's annotation into the draft. */
function commitForm() {
  const entry = { property: form.property, species: form.species, location: form.location }
  emit('update:draft', setDraftEntry(props.draft, props.sidecar, editingName.value, entry))
  stopEditing()
}

/**
 * Clears a row's annotation in the draft.
 *
 * @param {{ name: string }} row
 */
function clearEntry(row) {
  if (editingName.value === row.name) stopEditing()
  emit('update:draft', setDraftEntry(props.draft, props.sidecar, row.name, null))
}

const formRole = computed(() => (form.property && form.location ? roleOf(form) : null))

const PORT_STATUS_TEXT = { connected: 'connected', exists: 'port exists' }
const formPortStatus = computed(() => PORT_STATUS_TEXT[props.portStatus.get(editingName.value)] ?? 'port will be created')

// ── Species ─────────────────────────────────────────────────────────────────
const speciesItems = computed(() => form.species.map((curie) => ({ curie, label: displayLabel(curie) })))
const speciesSuggestions = ref([])
const speciesNotice = ref('')

/**
 * Lists the species matching typed text, from the given search or the local table and workspace.
 *
 * @param {string} query
 */
async function findSpecies(query) {
  const search = props.findSpeciesTerms ?? ((text) => searchSpecies(text, { workspaceTerms: props.workspaceTerms, labelOf: displayLabel }))
  const results = await search(query)
  const chosen = new Set(form.species)
  speciesSuggestions.value = results.filter((item) => !chosen.has(item.curie))
  const looksLikeTerm = /[:_/]/.test(query ?? '')
  speciesNotice.value = looksLikeTerm && !results.length ? `${query.trim()} is not a ChEBI term.` : ''
}

/**
 * Sets the chosen species from the AutoComplete's items, reading typed text as a pasted term.
 *
 * @param {Array<{ curie: string }|string>} items
 */
function setSpecies(items) {
  const curies = (items ?? []).map((item) => (typeof item === 'string' ? parseSpeciesTerm(item) : item?.curie))
  form.species = [...new Set(curies.filter(Boolean))]
}

// ── Other annotations ───────────────────────────────────────────────────────
const SHORT_PREFIXES = [
  ['bqbiol:', 'http://biomodels.net/biology-qualifiers/'],
  ['dcterms:', 'http://purl.org/dc/terms/'],
  ['rdf:', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'],
  ['rdfs:', 'http://www.w3.org/2000/01/rdf-schema#'],
]

/**
 * A term as the "Other annotations" list shows it.
 *
 * @param {Object} term - An RDF term.
 * @returns {string}
 */
function termText(term) {
  if (term.termType === 'BlankNode') return '[entity]'
  if (term.termType === 'Literal') return JSON.stringify(term.value)
  const prefixed = SHORT_PREFIXES.find(([, iri]) => term.value.startsWith(iri))
  if (prefixed) return `${prefixed[0]}${term.value.slice(prefixed[1].length)}`
  const curie = canonicalCurie(term.value)
  return curie !== term.value ? curie : subjectText(term.value)
}

const otherTriples = ref([])

watch(
  () => [props.sidecarText, props.mathRef, props.cellml],
  async ([text, mathRef, cellml]) => {
    try {
      const triples = await listOtherTriples(text, mathRef, { cellml: cellml || undefined })
      otherTriples.value = triples.map((t) => ({ subject: termText(t.subject), predicate: termText(t.predicate), object: termText(t.object) }))
    } catch {
      otherTriples.value = []
    }
  },
  { immediate: true }
)
</script>

<style scoped>
.annotation-tab {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  height: 100%;
  min-height: 0;
  font-size: 0.875rem;
}

.annotation-tab__header {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.annotation-tab__kind,
.annotation-tab__toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.annotation-tab__label,
.annotation-editor__label {
  color: var(--p-text-muted-color);
}

.annotation-tab__accession {
  width: 14rem;
}

.annotation-tab__toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  cursor: pointer;
}

.annotation-tab__rows {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  border-top: 1px solid var(--p-content-border-color);
}

.annotation-row {
  padding: 0.25rem 0.25rem;
  border-bottom: 1px solid var(--p-content-border-color);
}

.annotation-row--editing {
  background: var(--p-content-hover-background);
}

.annotation-row__head {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: 2rem;
}

.annotation-row__name {
  flex: 0 0 auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-weight: 600;
}

.annotation-row__units {
  flex: 0 0 auto;
  color: var(--p-text-muted-color);
  font-size: 0.75rem;
}

.annotation-row__body {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.25rem;
  flex: 1 1 auto;
  min-width: 0;
}

.annotation-editor {
  display: grid;
  grid-template-columns: max-content minmax(0, 1fr);
  align-items: center;
  gap: 0.5rem 0.75rem;
  padding: 0.5rem 0.25rem 0.5rem 1rem;
}

.annotation-editor__where {
  flex-wrap: wrap;
}

.annotation-editor__derived {
  color: var(--p-text-muted-color);
  text-transform: none;
}

.annotation-editor__actions {
  grid-column: 1 / -1;
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}

.species-option {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  width: 100%;
}

.species-option__curie {
  color: var(--p-text-muted-color);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.75rem;
}

.annotation-tab__empty {
  padding: 1rem;
  color: var(--p-text-muted-color);
  text-align: center;
}

.annotation-tab__other {
  flex: 0 0 auto;
  color: var(--p-text-muted-color);
}

.annotation-tab__other summary {
  cursor: pointer;
}

.annotation-tab__other-note {
  margin: 0.25rem 0;
}

.annotation-tab__other ul {
  margin: 0;
  padding-left: 1rem;
  max-height: 8rem;
  overflow-y: auto;
}

.annotation-tab__other-line {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.75rem;
  overflow-wrap: anywhere;
}
</style>
