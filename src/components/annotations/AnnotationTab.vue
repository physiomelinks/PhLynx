<template>
  <div class="annotation-tab">
    <div class="annotation-tab__header">
      <div class="annotation-tab__kind">
        <span class="annotation-tab__group">
          <span class="annotation-tab__label">Module kind</span>
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
        </span>
        <span v-if="kindValue === 'compartment'" class="annotation-tab__group">
          <span class="annotation-tab__label">Space</span>
          <SelectButton
            :model-value="spaceKindValue"
            :options="SPACE_KIND_OPTIONS"
            option-label="label"
            option-value="value"
            :allow-empty="false"
            size="small"
            aria-label="Space kind"
            data-test="space-kind"
            @update:model-value="setSpaceKind"
          />
        </span>
        <span v-if="kindValue === 'transporter'" class="annotation-tab__group">
          <span class="annotation-tab__label">Protein</span>
          <AutoComplete
            :model-value="accessionText"
            :suggestions="proteinSuggestions"
            option-label="accession"
            :invalid="!accession && (!!accessionText.trim() || !kind.transporter)"
            :delay="120"
            placeholder="UniProt, e.g. P11168"
            aria-label="UniProt accession"
            size="small"
            class="annotation-tab__accession"
            data-test="uniprot-accession"
            @complete="(event) => findProteins(event.query)"
            @update:model-value="setAccessionText"
          >
            <template #option="{ option }">
              <span class="term-option">
                <span>
                  {{ option.label }}
                  <span class="term-option__note">
                    {{ [option.gene, option.organism].filter(Boolean).join(' · ') }}
                  </span>
                </span>
                <span class="term-option__curie">{{ option.accession }}</span>
              </span>
            </template>
            <template #empty>No reviewed UniProt entry matches.</template>
            <template #footer>
              <div v-if="proteinLookup !== 'idle'" class="term-lookup" data-test="protein-lookup">
                {{ LOOKUP_TEXT[proteinLookup] }}
              </div>
            </template>
          </AutoComplete>
          <span class="annotation-tab__protein" :title="mediatorName" data-test="protein-label">
            {{ mediatorName }}
          </span>
        </span>
        <span class="annotation-tab__spacer" />
        <span class="annotation-tab__group">
          <Button
            label="Import"
            icon="pi pi-upload"
            text
            size="small"
            severity="secondary"
            data-test="import"
            @click="fileInput?.click()"
          />
          <Button
            label="Export .ttl"
            icon="pi pi-download"
            text
            size="small"
            severity="secondary"
            data-test="export"
            @click="exportSidecar"
          />
          <input
            ref="fileInput"
            type="file"
            accept=".ttl,text/turtle"
            class="annotation-tab__file"
            aria-label="Annotations file to import"
            data-test="import-file"
            @change="onImportFile"
          />
        </span>
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

      <div class="annotation-tab__toolbar annotation-tab__status">
        <span class="annotation-tab__shared" data-test="shared">
          Shared by {{ sharedCount }} {{ sharedCount === 1 ? 'instance' : 'instances' }} · edits apply to its module
        </span>
        <span class="annotation-tab__count" data-test="count">
          {{ annotatedCount }} of {{ listedRows.length }} annotated
        </span>
      </div>

      <Message
        v-if="moduleTermProblems.length"
        severity="warn"
        size="small"
        variant="simple"
        data-test="module-term-warning"
      >
        Check the module’s terms: {{ moduleTermProblems.join('; ') }}.
      </Message>

      <div v-if="selected.size" :key="bulkKey" class="annotation-bulk" data-test="bulk">
        <span>With {{ selected.size }} selected:</span>
        <Select
          :model-value="null"
          :options="BULK_PROPERTY_OPTIONS"
          option-label="label"
          option-value="value"
          placeholder="Set what"
          size="small"
          aria-label="Set what for the selected variables"
          data-test="bulk-what"
          @update:model-value="(value) => applyBulk('what', value)"
        />
        <AutoComplete
          :model-value="null"
          :suggestions="speciesSuggestions"
          option-label="label"
          size="small"
          :delay="120"
          placeholder="Set of what"
          aria-label="Set of what for the selected variables"
          data-test="bulk-species"
          @complete="(event) => findSpecies(event.query, [])"
          @option-select="(event) => applyBulk('species', event.value?.curie)"
        >
          <template #option="{ option }">
            <span class="term-option">
              <span>{{ option.label }}</span>
              <span class="term-option__curie">{{ option.curie }}</span>
            </span>
          </template>
        </AutoComplete>
        <Select
          :model-value="null"
          :options="kindLocations"
          option-label="label"
          option-value="value"
          placeholder="Set whose"
          size="small"
          aria-label="Set whose for the selected variables"
          data-test="bulk-whose"
          @update:model-value="(value) => applyBulk('whose', value)"
        />
        <Button
          label="Clear"
          text
          size="small"
          severity="secondary"
          data-test="bulk-clear"
          @click="applyBulk('clear')"
        />
      </div>
      <span v-if="bulkNote" class="annotation-bulk__note" role="status" data-test="bulk-note">{{ bulkNote }}</span>
    </div>

    <div class="annotation-tab__rows">
      <table class="annotation-table">
        <thead>
          <tr>
            <th class="annotation-table__check">
              <Checkbox
                :model-value="allShownSelected"
                binary
                :disabled="!shownRows.length"
                aria-label="Select all shown variables"
                data-test="select-all"
                @update:model-value="selectAllShown"
              />
            </th>
            <th class="annotation-table__variable">Variable</th>
            <th class="annotation-table__units">Units</th>
            <th class="annotation-table__what">What</th>
            <th class="annotation-table__species">Of what</th>
            <th class="annotation-table__whose">Whose</th>
            <th class="annotation-table__from">From</th>
            <th class="annotation-table__port">Port</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="row in shownRows"
            :key="row.name"
            :class="['annotation-row', { 'annotation-row--incomplete': row.port.kind === 'incomplete' }]"
            :data-variable="row.name"
          >
            <td class="annotation-table__check">
              <Checkbox
                :model-value="selected.has(row.name)"
                binary
                :aria-label="`Select ${row.name}`"
                data-test="select"
                @update:model-value="(value) => setSelected(row.name, value)"
              />
            </td>
            <td class="annotation-row__name" :title="row.units ? `${row.name} (${row.units})` : row.name">
              <i
                v-if="row.termProblems.length"
                v-tooltip.top="`${row.termProblems.join('; ')}; check the term`"
                class="pi pi-exclamation-triangle annotation-row__term-warning"
                :aria-label="row.termProblems.join('; ')"
                data-test="term-warning"
              />
              <span class="annotation-row__name-text">{{ row.name }}</span>
              <span class="annotation-row__units-suffix" aria-hidden="true">{{ row.units }}</span>
            </td>
            <td class="annotation-row__units" :title="row.units">{{ row.units }}</td>
            <td :class="['annotation-row__what', { 'annotation-row__what--warn': row.unitsProblem }]">
              <Select
                :model-value="row.entry?.property ?? null"
                :options="propertyOptionsFor(row.entry?.property)"
                :title="optionLabel(propertyOptionsFor(row.entry?.property), row.entry?.property)"
                option-label="label"
                option-value="value"
                placeholder="—"
                size="small"
                :aria-label="`What for ${row.name}`"
                data-test="what"
                @update:model-value="(value) => setProperty(row, value)"
              />
              <i
                v-if="row.unitsProblem"
                v-tooltip.top="`${row.unitsProblem}; check the property or the units`"
                class="pi pi-exclamation-triangle annotation-row__warning"
                :aria-label="row.unitsProblem"
                data-test="units-warning"
              />
            </td>
            <td class="annotation-row__species">
              <AutoComplete
                :model-value="speciesItemsOf(row)"
                :title="speciesItemsOf(row).map(({ label }) => label).join(', ') || undefined"
                :suggestions="speciesSuggestions"
                option-label="label"
                multiple
                fluid
                size="small"
                :delay="120"
                :disabled="!takesSpecies(row.entry?.property)"
                :placeholder="takesSpecies(row.entry?.property) && !row.entry.species.length ? 'Species' : ''"
                :aria-label="`Of what for ${row.name}`"
                data-test="species"
                @complete="(event) => findSpecies(event.query, row.entry?.species ?? [])"
                @update:model-value="(items) => setSpecies(row, items)"
              >
                <template #option="{ option }">
                  <span class="term-option">
                    <span>
                      {{ option.label }}
                      <span v-if="option.isObsolete" class="term-option__obsolete" data-test="obsolete">obsolete</span>
                    </span>
                    <span class="term-option__curie">{{ option.curie }}</span>
                  </span>
                </template>
                <template #empty>{{ speciesNotice || 'No species matches.' }}</template>
                <template #footer>
                  <div v-if="speciesLookup !== 'idle'" class="term-lookup" data-test="species-lookup">
                    {{ LOOKUP_TEXT[speciesLookup] }}
                  </div>
                </template>
              </AutoComplete>
            </td>
            <td class="annotation-row__whose">
              <Select
                :model-value="row.entry?.location ?? null"
                :options="locationOptionsOf(row)"
                :title="optionLabel(locationOptionsOf(row), row.entry?.location)"
                option-label="label"
                option-value="value"
                placeholder="—"
                show-clear
                size="small"
                :aria-label="`Whose for ${row.name}`"
                data-test="whose"
                @update:model-value="(value) => setLocation(row, value)"
              >
                <template #value="{ value, placeholder }">
                  <template v-if="unusualLocationOf(row, value)">
                    <span class="annotation-row__place" aria-hidden="true">{{ unusualLocationOf(row, value).name }}</span>
                    <i class="pi pi-exclamation-triangle annotation-row__unusual" aria-hidden="true" />
                    <span class="annotation-row__sr-only">{{ unusualLocationOf(row, value).label }}</span>
                  </template>
                  <template v-else>{{ optionLabel(locationOptionsOf(row), value) ?? placeholder }}</template>
                </template>
              </Select>
            </td>
            <td class="annotation-row__from">
              <Select
                v-if="row.isFlow"
                :model-value="row.entry.from ?? null"
                :options="fromOptionsOf(row)"
                :title="optionLabel(fromOptionsOf(row), row.entry.from)"
                option-label="label"
                option-value="value"
                :disabled="!fromOptionsOf(row).length"
                placeholder="—"
                show-clear
                size="small"
                :aria-label="`From for ${row.name}`"
                data-test="from"
                @update:model-value="(value) => setFrom(row, value)"
              />
            </td>
            <td class="annotation-table__port">
              <span
                v-tooltip.top="row.port.text"
                :class="['annotation-port', `annotation-port--${row.port.kind}`]"
                :aria-label="row.port.text"
                data-test="port"
                >{{ row.port.mark }}</span
              >
              <i
                v-if="row.isFlow"
                v-tooltip.top="row.process"
                class="pi pi-info-circle annotation-port__process"
                :aria-label="row.process"
                data-test="process"
              />
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="!shownRows.length" class="annotation-tab__empty">No variables to show.</div>
    </div>

    <details v-if="otherTriples.length" class="annotation-tab__other" data-test="other-annotations">
      <summary>More ({{ otherTriples.length }})</summary>
      <p class="annotation-tab__other-note">
        Other statements in the file, kept as written; this tab doesn’t edit them.
      </p>
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
 * The instance editor's Annotations tab: the module's kind, and a table of its variables in math order whose cells
 * say what each one is, of what and whose, as a draft the editor saves with the instance. The sidecar belongs to the
 * math, so every instance of it shares it. Nothing is filled in for the user: bulk edits apply chosen values to
 * ticked rows only.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'

import AutoComplete from 'primevue/autocomplete'
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import Message from 'primevue/message'
import Select from 'primevue/select'
import SelectButton from 'primevue/selectbutton'
import ToggleSwitch from 'primevue/toggleswitch'

import { locationText, subjectText } from '../../services/annotations/display'
import {
  classifyAnnotationRow,
  draftBaseSidecar,
  getDraftEntry,
  getDraftKind,
  getDraftSpaceKind,
  importDraftSidecar,
  isAnnotatedEntry,
  setDraftEntry,
  setDraftKind,
  setDraftSpaceKind,
} from '../../services/annotations/draft'
import { GO, OPB, canonicalCurie, hasPrefix, isFlowProperty, takesSpecies } from '../../services/annotations/iris'
import { displayLabel } from '../../services/annotations/labels'
import { isCompleteAnnotation } from '../../services/annotations/match'
import { parseSidecar } from '../../services/annotations/sidecar'
import { editSidecar, listOtherTriples } from '../../services/annotations/sidecarEdit'
import { propertyUnitsProblem } from '../../services/annotations/propertyUnits'
import { parseSpeciesTerm, searchSpecies } from '../../services/annotations/species'
import { variableIdsOf } from '../../services/math/variableIds'
import { createDebouncedSearch, lookupTerm, searchChebi } from '../../services/ontology/ols'
import { ensureCachedLabelSource, isObsoleteTerm } from '../../services/ontology/termCache'
import { searchUniprot } from '../../services/ontology/uniprot'
import {
  ACCESSION_PATTERN,
  entryTerms,
  findUnknownTerms,
  sidecarTerms,
  termIdProblem,
  termIdProblems,
  unknownTermProblem,
  variableTerms,
} from '../../services/annotations/termIds'
import { escapeHtml } from '../../utils/importBatch'
import { notify } from '../../utils/notify'
import { legacyDownload } from '../../utils/save'
import { extractUnitDefinitions } from '../../utils/units'

const props = defineProps({
  // Parameter rows, from useMathSession.
  rows: { type: Array, default: () => [] },
  // Each variable's kind, from useMathSession, or null before the math is analysed.
  variableKinds: { type: Map, default: null },
  // The math's parsed sidecar, under the editor's variable names; null when it has none.
  sidecar: { type: Object, default: null },
  // The sidecar's text, for the triples this tab doesn't edit and for export.
  sidecarText: { type: String, default: null },
  // The unsaved edits, from createAnnotationDraft.
  draft: { type: Object, required: true },
  mathRef: { type: String, required: true },
  // The math, to find variables a sidecar names by '#id', and their order.
  cellml: { type: String, default: '' },
  // How many instances use this math.
  sharedCount: { type: Number, default: 1 },
  // Each annotated variable's port: 'connected' or 'exists'; a variable without one gets it on save.
  portStatus: { type: Map, default: () => new Map() },
  // ChEBI CURIEs other sidecars in the workspace use.
  workspaceTerms: { type: Array, default: () => [] },
  // Finds species for typed text, as { curie, label }; may return a promise. Defaults to the local table.
  findSpeciesTerms: { type: Function, default: null },
  // Searches ChEBI online for typed text, as (query, { signal }) => Promise<{ curie, label, isObsolete }[]>.
  searchRemoteSpecies: { type: Function, default: searchChebi },
  // Looks up a ChEBI or GO term's label online, as (curie) => Promise<{ label, isObsolete }|null>; null when unknown.
  lookupOntologyTerm: { type: Function, default: lookupTerm },
  // Searches reviewed UniProt entries for typed text, as (query, { signal }) => Promise<{ accession, label }[]>.
  searchProteins: { type: Function, default: searchUniprot },
  // The library's units definitions, as libraryStore.unitDefinitions, to check units against properties.
  unitDefinitions: { type: Map, default: () => new Map() },
  // Asks before an import replaces the annotations, as () => Promise<boolean>.
  confirmImport: { type: Function, default: async () => true },
  // Saves a file, as (filename, blob) => void.
  download: { type: Function, default: legacyDownload },
})

const emit = defineEmits(['update:draft'])

const KIND_OPTIONS = [
  { value: 'compartment', label: 'Compartment' },
  { value: 'membrane', label: 'Membrane' },
  { value: 'transporter', label: 'Transporter' },
  { value: 'none', label: 'None' },
]

// What space a compartment is, the user's choice: never inferred, and no role depends on it.
const SPACE_KIND_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: GO.cytoplasm, label: 'Cytoplasm' },
  { value: GO.extracellularRegion, label: 'Extracellular' },
]

const FILTER_OPTIONS = [
  { value: 'all', label: 'All' },
  { value: 'unannotated', label: 'Unannotated' },
  { value: 'annotated', label: 'Annotated' },
]

const capitalise = (text) => text.charAt(0).toUpperCase() + text.slice(1)

const BULK_PROPERTY_OPTIONS = [
  OPB.concentration,
  OPB.amount,
  OPB.molarFlowRate,
  OPB.fluidVolume,
  OPB.spatialArea,
  OPB.electricalPotential,
  OPB.chargeFlowRate,
].map((curie) => ({ value: curie, label: capitalise(displayLabel(curie)) }))

// 'None' clears the row's annotation.
const NONE = 'none'
const PROPERTY_OPTIONS = [...BULK_PROPERTY_OPTIONS, { value: NONE, label: 'None' }]

/**
 * The properties a row offers: the usual ones, plus the row's own when a side-car gave it one that isn't offered
 * (e.g. an older file's OPB:00593), so the cell still shows it.
 *
 * @param {string|null|undefined} property - The row's property.
 * @returns {Array<{value: string, label: string}>}
 */
function propertyOptionsFor(property) {
  if (!property || PROPERTY_OPTIONS.some((option) => option.value === property)) return PROPERTY_OPTIONS
  return [{ value: property, label: capitalise(displayLabel(property)) }, ...PROPERTY_OPTIONS]
}

const PLACE = {
  self: 'self',
  ownMembrane: `self+${GO.plasmaMembrane}`,
  cytoplasm: GO.cytoplasm,
  extracellular: GO.extracellularRegion,
  plasmaMembrane: GO.plasmaMembrane,
}

// The places each module kind offers; without a kind, all of them.
const LOCATION_OPTIONS = {
  compartment: [
    { value: PLACE.self, label: 'This compartment' },
    { value: PLACE.ownMembrane, label: 'Its membrane' },
  ],
  membrane: [
    { value: PLACE.self, label: 'This membrane' },
    { value: PLACE.cytoplasm, label: 'Cytoplasm' },
    { value: PLACE.extracellular, label: 'Extracellular' },
  ],
  transporter: [
    { value: PLACE.cytoplasm, label: 'Cytoplasm' },
    { value: PLACE.extracellular, label: 'Extracellular' },
    { value: PLACE.plasmaMembrane, label: 'Plasma membrane' },
  ],
  none: [
    { value: PLACE.self, label: 'This compartment' },
    { value: PLACE.ownMembrane, label: 'Its membrane' },
    { value: PLACE.cytoplasm, label: 'Cytoplasm' },
    { value: PLACE.extracellular, label: 'Extracellular' },
    { value: PLACE.plasmaMembrane, label: 'Plasma membrane' },
  ],
}

// What the module's own place is called, by its kind.
const SELF_NAMES = {
  compartment: 'this compartment',
  membrane: 'this membrane',
  transporter: 'this transporter',
  none: 'this module',
}

// The sides a flow may come from; the place it flows into is left out.
const FROM_OPTIONS = [
  { value: GO.cytoplasm, label: 'Cytoplasm' },
  { value: GO.extracellularRegion, label: 'Extracellular' },
]

const LOOKUP_TEXT = { searching: 'Searching online…', unavailable: 'Online lookup unavailable' }

// Typed text this short, or that looks like a pasted term, is not searched online.
const MIN_REMOTE_QUERY_LENGTH = 3

// An imported file larger than this is refused unread.
const MAX_IMPORT_BYTES = 5 * 1024 * 1024

ensureCachedLabelSource()

const filter = ref('all')
const showConstants = ref(false)

// The sidecar the draft edits (an imported one replaces the math's), and its text.
const base = computed(() => draftBaseSidecar(props.draft, props.sidecar))
const baseText = computed(() => (props.draft.imported ? props.draft.imported.text : props.sidecarText))

// ── Module kind ─────────────────────────────────────────────────────────────
const kind = computed(() => getDraftKind(props.draft, base.value))
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
  const transporter = componentKind === 'transporter' ? accession.value : null
  emit('update:draft', setDraftKind(props.draft, base.value, componentKind, transporter))
}

const spaceKindValue = computed(() => getDraftSpaceKind(props.draft, base.value) ?? 'none')

/**
 * Sets the compartment's space kind.
 *
 * @param {string} value - A GO cellular component, or 'none'.
 */
function setSpaceKind(value) {
  emit('update:draft', setDraftSpaceKind(props.draft, base.value, value === 'none' ? null : value))
}

const accessionLabel = computed(() => {
  const label = accession.value ? displayLabel(accession.value) : null
  return label && label !== accession.value ? label : null
})

// The module's name, from its sidecar or else its math.
const moduleName = computed(() => base.value?.componentName || props.mathRef.split(':').at(-1) || 'module')

// The transporter as the table names it: its protein's name, else the module's own name.
const mediatorName = computed(() => accessionLabel.value ?? moduleName.value)

/**
 * Sets the accession box from typed text or a chosen UniProt entry.
 *
 * @param {string|{ accession: string }|null} value
 */
function setAccessionText(value) {
  accessionText.value = typeof value === 'string' ? value : (value?.accession ?? '')
  commitAccession()
}

/** Sets the transporter's accession once it is a valid one, or drops it when the box is emptied. */
function commitAccession() {
  if (accessionText.value.trim() && !accession.value) return
  emit('update:draft', setDraftKind(props.draft, base.value, 'transporter', accession.value))
}

const proteinSuggestions = ref([])
const proteinLookup = ref('idle')
const remoteProteinSearch = createDebouncedSearch((query, options) => props.searchProteins(query, options))

/**
 * Lists reviewed UniProt entries matching typed text; a typed accession still works when the lookup fails.
 *
 * @param {string} query
 */
async function findProteins(query) {
  const text = String(query ?? '').trim()
  if (text.length < MIN_REMOTE_QUERY_LENGTH) {
    remoteProteinSearch.cancel()
    proteinSuggestions.value = []
    proteinLookup.value = 'idle'
    return
  }
  proteinLookup.value = 'searching'
  try {
    const results = await remoteProteinSearch(text)
    if (results === null) return
    proteinSuggestions.value = results
    proteinLookup.value = 'idle'
  } catch {
    proteinSuggestions.value = []
    proteinLookup.value = 'unavailable'
  }
}

// ── Rows ────────────────────────────────────────────────────────────────────
// The math's own units definitions over the library's, with a cache for resolving them.
const units = computed(() => ({
  definitions: new Map([...props.unitDefinitions, ...extractUnitDefinitions(props.cellml)]),
  cache: new Map(),
}))
const unitsProblem = (property, rowUnits) =>
  propertyUnitsProblem(property, rowUnits, units.value.definitions, units.value.cache)

// Each variable's place in the math; rows the math doesn't declare go last.
const mathOrder = computed(() => {
  const names = [...props.cellml.matchAll(/<variable\b[^>]*?\bname="([^"]+)"/g)].map((match) => match[1])
  return new Map([...new Set(names)].map((name, index) => [name, index]))
})

const selfName = computed(() => SELF_NAMES[kindValue.value])
const kindLocations = computed(() => LOCATION_OPTIONS[kindValue.value])
const isSelfLocation = (location) => !!location && (location === 'self' || location.startsWith('self+'))

/** A place as the table reads it, e.g. 'cytoplasm' or 'this compartment'. */
function placeName(location) {
  const option = kindLocations.value.find(({ value }) => value === location)
  return option ? option.label.toLowerCase() : locationText(location, selfName.value)
}

/**
 * What an incomplete entry still needs to be a port, e.g. 'what and whose'.
 *
 * @param {Object} entry
 * @returns {string}
 */
function missingOf(entry) {
  const missing = [
    !entry.property && 'what',
    takesSpecies(entry.property) && !entry.species?.length && 'of what',
    !entry.location && 'whose',
  ].filter(Boolean)
  return missing.join(missing.length > 2 ? ', ' : ' and ').replace(/, (?=[^,]*$)/, ' and ')
}

const PORT_STATUS = {
  connected: { kind: 'exists', mark: '●', text: 'Port exists and is connected' },
  exists: { kind: 'exists', mark: '●', text: 'Port exists' },
}

/**
 * A row's port: one it has, one save creates, none, or none until its annotation is complete.
 *
 * @param {string} name
 * @param {Object|null} entry
 * @returns {{ kind: string, mark: string, text: string }}
 */
function portOf(name, entry) {
  if (!entry) return { kind: 'none', mark: '–', text: 'Not annotated, so no port' }
  if (!isCompleteAnnotation(entry)) {
    return { kind: 'incomplete', mark: '⚠', text: `No port until it has ${missingOf(entry)}` }
  }
  return PORT_STATUS[props.portStatus.get(name)] ?? { kind: 'new', mark: '○', text: 'Port will be created on save' }
}

/**
 * The process a flow annotation describes, e.g. 'Na⁺ extracellular → cytoplasm, via SGLT1'.
 *
 * @param {Object} entry
 * @returns {string}
 */
function processOf(entry) {
  const what = entry.species?.length
    ? entry.species.map((curie) => displayLabel(curie)).join(' + ')
    : entry.property === OPB.chargeFlowRate
      ? 'charge'
      : 'flow'
  const into = entry.location ? placeName(entry.location) : 'somewhere not yet chosen'
  const route = entry.from ? `${placeName(entry.from)} → ${into}` : `→ ${into}`
  const mediator = kindValue.value === 'transporter' ? `, via ${mediatorName.value}` : ''
  return `Process: ${what} ${route}${mediator}`
}

const orderOf = (name) => mathOrder.value.get(name) ?? Infinity

// ── Term ids ────────────────────────────────────────────────────────────────
// ChEBI and GO terms OLS has said it doesn't know, and every term looked up so far.
const unknownTerms = ref(new Set())
const lookedUp = new Set()

/**
 * The terms a row cites: its entry's, and while it is unedited, its saved process's and participants'.
 *
 * @param {string} name
 * @param {Object|null} entry
 * @returns {string[]}
 */
function rowTerms(name, entry) {
  if (props.draft.variables.has(name)) return entryTerms(entry)
  const saved = base.value?.variables?.find((variable) => variable.variable === name)
  return saved ? variableTerms(saved) : entryTerms(entry)
}

/**
 * What is wrong with some terms: ids that don't fit their ontology, and terms OLS doesn't know.
 *
 * @param {string[]} terms
 * @returns {string[]}
 */
const termProblemsOf = (terms) =>
  terms.flatMap((curie) => {
    const problem = termIdProblem(curie) ?? (unknownTerms.value.has(curie) ? unknownTermProblem(curie) : null)
    return problem ? [problem] : []
  })

// The module's own terms, as the side-car the draft edits has them.
const moduleTerms = computed(() =>
  sidecarTerms(base.value ? { ...base.value, variables: [] } : null).map(({ curie }) => curie)
)
const moduleTermProblems = computed(() => [...new Set(termProblemsOf(moduleTerms.value))])

const annotationRows = computed(() =>
  props.rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => orderOf(a.row.name) - orderOf(b.row.name) || a.index - b.index)
    .map(({ row }) => {
      const entry = getDraftEntry(props.draft, base.value, row.name)
      const isFlow = !!entry && isFlowProperty(entry.property)
      const terms = rowTerms(row.name, entry)
      return {
        name: row.name,
        units: row.units,
        role: classifyAnnotationRow(row, props.variableKinds),
        entry,
        isFlow,
        process: isFlow ? processOf(entry) : null,
        port: portOf(row.name, entry),
        unitsProblem: entry?.property ? unitsProblem(entry.property, row.units) : null,
        terms,
        termProblems: termProblemsOf(terms),
      }
    })
    .filter((row) => row.role !== 'voi')
)

// Looks each new ChEBI and GO term up on OLS once, to warn of those it doesn't know.
watch(
  () => [...new Set([...moduleTerms.value, ...annotationRows.value.flatMap((row) => row.terms)])],
  async (terms) => {
    const fresh = terms.filter((curie) => !lookedUp.has(curie))
    if (!fresh.length) return
    fresh.forEach((curie) => lookedUp.add(curie))
    const unknown = await findUnknownTerms(
      fresh.map((curie) => ({ where: '', curie })),
      (curie) => props.lookupOntologyTerm(curie)
    )
    if (unknown.length) unknownTerms.value = new Set([...unknownTerms.value, ...unknown.map(({ curie }) => curie)])
  },
  { immediate: true }
)

// Rows edited here stay listed, so a constant doesn't vanish when its annotation is cleared.
const touched = ref(new Set())

// The rows the constants switch lists: every variable, and constants when shown, annotated or edited here.
const listedRows = computed(() =>
  annotationRows.value.filter(
    (row) => row.role !== 'constant' || showConstants.value || !!row.entry || touched.value.has(row.name)
  )
)

const annotatedCount = computed(() => listedRows.value.filter((row) => row.entry).length)

const shownRows = computed(() =>
  listedRows.value.filter((row) => {
    if (filter.value === 'annotated') return !!row.entry
    if (filter.value === 'unannotated') return !row.entry
    return true
  })
)

// ── Cell edits ──────────────────────────────────────────────────────────────
/**
 * A row's entry with a change, keeping it consistent: species only for a property of a species, and a source only
 * for a flow into a side other than the source. Null once it says nothing.
 *
 * @param {Object|null} entry
 * @param {Object} change - Fields to set.
 * @returns {Object|null}
 */
function changedEntry(entry, change) {
  const next = { property: null, species: [], location: null, from: null, ...entry, ...change }
  if (!takesSpecies(next.property)) next.species = []
  const keepsFrom = isFlowProperty(next.property) && next.location && !isSelfLocation(next.location)
  if (!keepsFrom || next.from === next.location) next.from = null
  return isAnnotatedEntry(next) ? next : null
}

/**
 * Drafts new entries for some rows at once.
 *
 * @param {Array<[string, Object|null]>} edits - Variable name and its new entry.
 */
function draftEntries(edits) {
  let draft = props.draft
  for (const [name, entry] of edits) draft = setDraftEntry(draft, base.value, name, entry)
  touched.value = new Set([...touched.value, ...edits.map(([name]) => name)])
  emit('update:draft', draft)
}

const editRow = (row, change) => draftEntries([[row.name, changedEntry(row.entry, change)]])

/**
 * Sets a row's property; 'none' clears its annotation.
 *
 * @param {{ name: string, entry: Object|null }} row
 * @param {string|null} property
 */
function setProperty(row, property) {
  if (!property || property === NONE) draftEntries([[row.name, null]])
  else editRow(row, { property })
}

/**
 * Sets a row's species from its AutoComplete's items, reading typed text as a pasted term.
 *
 * @param {{ name: string, entry: Object|null }} row
 * @param {Array<{ curie: string }|string>} items
 */
function setSpecies(row, items) {
  const curies = (items ?? []).map((item) => (typeof item === 'string' ? parseSpeciesTerm(item) : item?.curie))
  editRow(row, { species: [...new Set(curies.filter(Boolean))] })
}

const setLocation = (row, location) => editRow(row, { location: location ?? null })
const setFrom = (row, from) => editRow(row, { from: from ?? null })

/** The label of the option with this value, for a cell's title; undefined when there is none. */
const optionLabel = (options, value) => options.find((option) => option.value === value)?.label

const speciesItemsOf = (row) => (row.entry?.species ?? []).map((curie) => ({ curie, label: displayLabel(curie) }))

/**
 * The places a row may choose: its kind's, then the one it has if the kind doesn't offer it.
 *
 * @param {{ entry: Object|null }} row
 * @returns {Array<{ value: string, label: string }>}
 */
function locationOptionsOf(row) {
  const location = row.entry?.location
  if (!location || kindLocations.value.some(({ value }) => value === location)) return kindLocations.value
  const note = kindValue.value === 'none' ? '' : ` (not usual for a ${kindValue.value})`
  const name = capitalise(placeName(location))
  return [...kindLocations.value, { value: location, label: `${name}${note}`, name, isUnusual: Boolean(note) }]
}

/**
 * A row's chosen place when its kind doesn't offer it, shown as its name and a warning to fit a narrow cell.
 *
 * @param {{ entry: Object|null }} row
 * @param {string|null} value
 * @returns {{ name: string, label: string }|undefined}
 */
const unusualLocationOf = (row, value) =>
  locationOptionsOf(row).find((option) => option.isUnusual && option.value === value)

/**
 * The sides a flow row may come from: the other side to the one it flows into; none into the module itself.
 *
 * @param {{ entry: Object }} row
 * @returns {Array<{ value: string, label: string }>}
 */
function fromOptionsOf(row) {
  const { location } = row.entry
  if (!location || isSelfLocation(location)) return []
  return FROM_OPTIONS.filter(({ value }) => value !== location)
}

// ── Selection and bulk edits ────────────────────────────────────────────────
const selected = ref(new Set())
const bulkNote = ref('')
// Renews the bulk bar's controls, so each shows its placeholder again once applied.
const bulkKey = ref(0)

/**
 * Ticks or unticks a row.
 *
 * @param {string} name
 * @param {boolean} isSelected
 */
function setSelected(name, isSelected) {
  const next = new Set(selected.value)
  if (isSelected) next.add(name)
  else next.delete(name)
  selected.value = next
  bulkNote.value = ''
}

const allShownSelected = computed(
  () => shownRows.value.length > 0 && shownRows.value.every((row) => selected.value.has(row.name))
)

/** Ticks every shown row, or unticks them all. */
function selectAllShown(isSelected) {
  selected.value = isSelected ? new Set(shownRows.value.map((row) => row.name)) : new Set()
  bulkNote.value = ''
}

// Ticked rows no longer listed are dropped from the selection.
watch(listedRows, (rows) => {
  const names = new Set(rows.map((row) => row.name))
  if ([...selected.value].some((name) => !names.has(name))) {
    selected.value = new Set([...selected.value].filter((name) => names.has(name)))
  }
})

const BULK_TEXT = { what: 'what', species: 'of what', whose: 'whose' }

/**
 * Applies one chosen value to the ticked rows only, skipping rows it doesn't suit, and says how many it skipped.
 *
 * @param {'what'|'species'|'whose'|'clear'} field
 * @param {string} [value]
 */
function applyBulk(field, value) {
  if (field !== 'clear' && !value) return
  const rows = annotationRows.value.filter((row) => selected.value.has(row.name))
  const edits = []
  let skipped = 0
  for (const row of rows) {
    if (field === 'clear') edits.push([row.name, null])
    else if (field === 'what') edits.push([row.name, changedEntry(row.entry, { property: value })])
    else if (field === 'whose') edits.push([row.name, changedEntry(row.entry, { location: value })])
    else if (takesSpecies(row.entry?.property)) edits.push([row.name, changedEntry(row.entry, { species: [value] })])
    else skipped++
  }
  if (edits.length) draftEntries(edits)
  bulkKey.value++
  const rowCount = plural(edits.length, 'row')
  const done = field === 'clear' ? `Cleared ${rowCount}` : `Set ${BULK_TEXT[field]} on ${rowCount}`
  const skip = skipped ? `; skipped ${plural(skipped, 'row')} whose What takes no species` : ''
  bulkNote.value = `${done}${skip}.`
}

const plural = (count, noun) => `${count} ${noun}${count === 1 ? '' : 's'}`

// ── Species ─────────────────────────────────────────────────────────────────
const speciesSuggestions = ref([])
const speciesNotice = ref('')
const speciesLookup = ref('idle')
const remoteSpeciesSearch = createDebouncedSearch((query, options) => props.searchRemoteSpecies(query, options))
let latestSpeciesQuery = null

/**
 * Marks each suggestion obsolete when its cached term is.
 *
 * @param {Array<{ curie: string, isObsolete?: boolean }>} items
 * @returns {Array<{ curie: string, isObsolete?: boolean }>}
 */
function withObsolete(items) {
  return items.map((item) =>
    item.isObsolete === undefined && isObsoleteTerm(item.curie) ? { ...item, isObsolete: true } : item
  )
}

/**
 * Lists the species matching typed text: the given search or the local table and workspace at once, then ChEBI
 * results online, and a pasted term's label once it resolves.
 *
 * @param {string} query
 * @param {string[]} chosen - Species the row already has, left out.
 */
async function findSpecies(query, chosen) {
  latestSpeciesQuery = query
  const local = (text) => searchSpecies(text, { workspaceTerms: props.workspaceTerms, labelOf: displayLabel })
  const search = props.findSpeciesTerms ?? local
  const results = await search(query)
  if (latestSpeciesQuery !== query) return
  const has = new Set(chosen)
  speciesSuggestions.value = withObsolete(results.filter((item) => !has.has(item.curie)))
  const looksLikeTerm = /[:_/]/.test(query ?? '')
  speciesNotice.value = looksLikeTerm && !results.length ? `${query.trim()} is not a ChEBI term.` : ''

  const pasted = parseSpeciesTerm(query)
  if (pasted) resolvePastedSpecies(pasted, query)

  const text = String(query ?? '').trim()
  if (looksLikeTerm || text.length < MIN_REMOTE_QUERY_LENGTH) {
    remoteSpeciesSearch.cancel()
    speciesLookup.value = 'idle'
    return
  }
  speciesLookup.value = 'searching'
  try {
    const remote = await remoteSpeciesSearch(text)
    if (remote === null || latestSpeciesQuery !== query) return
    const shown = new Set([...has, ...speciesSuggestions.value.map((item) => item.curie)])
    const added = remote.filter((item) => !shown.has(item.curie)).map((item) => ({ ...item, source: 'chebi' }))
    speciesSuggestions.value = [...speciesSuggestions.value, ...withObsolete(added)]
    speciesLookup.value = 'idle'
  } catch {
    if (latestSpeciesQuery === query) speciesLookup.value = 'unavailable'
  }
}

/**
 * Looks up a pasted species' label online when it has none yet, and shows it on its suggestion.
 *
 * @param {string} curie
 * @param {string} query - The query it was pasted in, so a later query is left alone.
 */
async function resolvePastedSpecies(curie, query) {
  if (displayLabel(curie) !== curie) return
  try {
    const term = await props.lookupOntologyTerm(curie)
    if (!term || latestSpeciesQuery !== query) return
    speciesSuggestions.value = speciesSuggestions.value.map((item) =>
      item.curie === curie ? { ...item, label: term.label, isObsolete: term.isObsolete } : item
    )
  } catch {
    // Offline: the pasted CURIE still works without its label.
  }
}

onBeforeUnmount(() => {
  remoteSpeciesSearch.cancel()
  remoteProteinSearch.cancel()
})

// ── Import and export ───────────────────────────────────────────────────────
const fileInput = ref(null)

/** Imports the chosen file, then empties the input so the same file can be chosen again. */
async function onImportFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (file) await importFile(file)
}

/**
 * Replaces this math's sidecar in the draft with a file's, once confirmed, and shows what it couldn't read.
 *
 * @param {File|Blob} file - A Turtle sidecar.
 */
async function importFile(file) {
  if (file.size > MAX_IMPORT_BYTES) {
    notify.error({ title: 'Import', message: 'The file is too large to be an annotations file.' })
    return
  }
  if (!(await props.confirmImport())) return
  let text
  try {
    text = await file.text()
  } catch {
    notify.error({ title: 'Import', message: 'Could not read the file.' })
    return
  }
  const sidecar = await parseSidecar(text, { mathRef: props.mathRef, cellml: props.cellml || undefined })
  const problems = sidecar.warnings.map((warning) => warning.message)
  if (sidecar.unreadable) {
    notify.error({ title: 'Import', message: problems.map(escapeHtml).join('<br>') })
    return
  }
  const unresolved = sidecar.unresolved?.length ?? 0
  if (unresolved) problems.push(`${plural(unresolved, 'annotation')} name variables this math doesn’t have.`)
  problems.push(...termIdProblems(sidecarTerms(sidecar)).map(({ where, problem }) => `${where}: ${problem}.`))
  touched.value = new Set()
  selected.value = new Set()
  emit('update:draft', importDraftSidecar(text, sidecar))
  if (problems.length) notify.warning({ title: 'Import', message: problems.map(escapeHtml).join('<br>') })
}

/**
 * The sidecar text with the draft applied, as save would write it for this math. A variable annotated anew without
 * an id in the math is left out, since only a save gives it one.
 *
 * @returns {Promise<{ text: string, leftOut: number }>}
 */
async function buildExportText() {
  const ids = variableIdsOf(props.cellml)
  const edits = [...props.draft.variables].filter(([name, entry]) => ids.has(name) || entry === null)
  const leftOut = props.draft.variables.size - edits.length
  const { componentKind, transporter } = getDraftKind(props.draft, null)
  const text = await editSidecar(baseText.value ?? '', props.mathRef, {
    ...(props.draft.componentKind !== undefined ? { componentKind, transporter: transporter ?? undefined } : {}),
    spaceKind: props.draft.spaceKind,
    variables: new Map(edits),
    cellml: props.cellml || undefined,
  })
  return { text, leftOut }
}

/** Downloads the sidecar, draft included, as '<module>.ttl'. */
async function exportSidecar() {
  try {
    const { text, leftOut } = await buildExportText()
    props.download(`${moduleName.value}.ttl`, new Blob([text], { type: 'text/turtle' }))
    if (leftOut) {
      const count = plural(leftOut, 'new annotation')
      const message = `${count} left out: save the instance first to give the variables ids.`
      notify.warning({ title: 'Export', message: escapeHtml(message) })
    }
  } catch (error) {
    notify.error({ title: 'Export', message: escapeHtml(`Could not export the annotations: ${error.message}`) })
  }
}

// ── Other annotations ───────────────────────────────────────────────────────
const SHORT_PREFIXES = [
  ['bqbiol:', 'http://biomodels.net/biology-qualifiers/'],
  ['dcterms:', 'http://purl.org/dc/terms/'],
  ['rdf:', 'http://www.w3.org/1999/02/22-rdf-syntax-ns#'],
  ['rdfs:', 'http://www.w3.org/2000/01/rdf-schema#'],
]

/**
 * A term as the "More" list shows it.
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
  () => [baseText.value, props.mathRef, props.cellml],
  async ([text, mathRef, cellml]) => {
    try {
      const triples = await listOtherTriples(text, mathRef, { cellml: cellml || undefined })
      otherTriples.value = triples.map((t) => ({
        subject: termText(t.subject),
        predicate: termText(t.predicate),
        object: termText(t.object),
      }))
    } catch {
      otherTriples.value = []
    }
  },
  { immediate: true }
)

defineExpose({ importFile })
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
.annotation-tab__toolbar,
.annotation-tab__group,
.annotation-bulk {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.annotation-tab__kind {
  row-gap: 0.375rem;
}

/* A label and its control wrap as a unit, and only split when even that is too wide */
.annotation-tab__group {
  min-width: 0;
  max-width: 100%;
  column-gap: 0.375rem;
}

/* The header's button groups keep their labels whole with tighter padding */
.annotation-tab__header :deep(.p-togglebutton-content) {
  padding: 0.25rem 0.5rem;
}

.annotation-tab__header :deep(.p-button-sm) {
  padding-inline: 0.375rem;
}

.annotation-tab__label,
.annotation-tab__shared,
.annotation-tab__count,
.annotation-bulk__note {
  color: var(--p-text-muted-color);
}

.annotation-tab__shared,
.annotation-bulk__note {
  font-size: 0.75rem;
}

.annotation-tab__spacer {
  flex: 1 1 auto;
}

.annotation-tab__file {
  display: none;
}

.annotation-tab__accession {
  width: 10rem;
  max-width: 100%;
}

.annotation-tab__accession :deep(.p-autocomplete-input) {
  width: 100%;
}

.annotation-tab__toggle {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  cursor: pointer;
}

.annotation-tab__count {
  margin-left: auto;
}

.annotation-tab__status {
  row-gap: 0.125rem;
  font-size: 0.75rem;
}

/* The bulk controls share the bar's width, wrapping two to a line when it is narrow */
.annotation-bulk > :is(.p-select, .p-autocomplete) {
  flex: 1 1 7rem;
  min-width: 6.5rem;
  max-width: 11rem;
}

.annotation-bulk :deep(.p-autocomplete-input) {
  width: 100%;
}

.annotation-bulk {
  padding: 0.25rem 0.5rem;
  border-radius: 0.375rem;
  background: var(--p-content-hover-background);
}

.annotation-tab__rows {
  container: annotation-rows / inline-size;
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  border-top: 1px solid var(--p-content-border-color);
}

.annotation-table {
  width: 100%;
  table-layout: fixed;
  border-collapse: collapse;
  font-size: 0.8125rem;
}

.annotation-table th {
  position: sticky;
  top: 0;
  z-index: 1;
  padding: 0.375rem 0.25rem;
  background: var(--p-content-background);
  color: var(--p-text-muted-color);
  font-weight: 500;
  text-align: left;
  white-space: nowrap;
}

.annotation-table td {
  padding: 0.125rem 0.25rem;
  border-bottom: 1px solid var(--p-content-border-color);
  vertical-align: middle;
}

.annotation-table :deep(.p-select) {
  width: 100%;
}

.annotation-table :deep(.p-select .p-select-label) {
  padding: 0.25rem 0.375rem;
  font-size: 0.8125rem;
}

/* Cells read as text: a select's chevron and clear button show only on its row's hover or focus */
.annotation-table :deep(.p-select-dropdown),
.annotation-table :deep(.p-select-clear-icon) {
  display: none;
}

.annotation-row:hover :deep(.p-select-dropdown),
.annotation-row:hover :deep(.p-select-clear-icon),
.annotation-row :deep(.p-select.p-focus .p-select-clear-icon),
.annotation-row :deep(.p-select.p-focus .p-select-dropdown) {
  display: flex;
  width: 1.25rem;
}

.annotation-row:hover :deep(.p-select-clear-icon),
.annotation-row :deep(.p-select.p-focus .p-select-clear-icon) {
  display: block;
  position: static;
  margin: auto 0;
}

.annotation-table :deep(.p-autocomplete .p-autocomplete-input-multiple) {
  min-height: 1.5rem;
  padding: 0.125rem 0.25rem;
  gap: 0.125rem;
}

.annotation-table :deep(.p-autocomplete .p-autocomplete-chip) {
  flex: 0 1 auto;
  min-width: 0;
  padding: 0 0.375rem;
  font-size: 0.75rem;
  white-space: nowrap;
}

/* A chip too long for a narrow box ends in an ellipsis; the cell's title has the full species */
.annotation-table :deep(.p-autocomplete-chip .p-chip-label) {
  overflow: hidden;
  text-overflow: ellipsis;
}

/* The species box shows its chips on one line, with room to type only while focused */
.annotation-table :deep(.p-autocomplete-input-multiple) {
  flex-wrap: nowrap;
  overflow: hidden;
}

.annotation-table :deep(.p-autocomplete-input-chip) {
  flex: 0 0 0;
  min-width: 0;
}

.annotation-table :deep(.p-autocomplete.p-focus .p-autocomplete-input-chip),
.annotation-table :deep(.p-autocomplete-input-chip:only-child) {
  flex: 1 1 3rem;
}

.annotation-table :deep(.p-autocomplete .p-autocomplete-input-chip) {
  padding-block: 0;
}

.annotation-table :deep(.p-autocomplete .p-autocomplete-input-chip input) {
  width: 100%;
  padding: 0.125rem 0;
  font-size: 0.75rem;
}

/* A chip's remove button shows, like the selects' clear buttons, only on hover or focus */
.annotation-table :deep(.p-chip-remove-icon) {
  display: none;
}

.annotation-row:hover :deep(.p-chip-remove-icon),
.annotation-row :deep(.p-autocomplete.p-focus .p-chip-remove-icon) {
  display: inline-block;
}

/* A row whose What takes no species shows an empty cell, not a greyed box */
.annotation-table :deep(.p-autocomplete-input-multiple.p-disabled) {
  border-color: transparent;
  background: transparent;
  box-shadow: none;
}

.annotation-table__variable {
  width: 5.5rem;
}

.annotation-table__units {
  width: 4rem;
}

.annotation-table__what {
  width: 9.5rem;
}

/* Of what takes the width the others leave */

.annotation-table__whose {
  width: 9.5rem;
}

.annotation-table__from {
  width: 7.5rem;
}

.annotation-table__check {
  width: 1.75rem;
}

.annotation-table__port {
  width: 2.5rem;
  text-align: center;
  white-space: nowrap;
}

/*
 * Narrower than the one-line row needs (the editor's default split on a laptop), each row takes two lines: the
 * variable, its units and port, then its What, Of what, Whose and From under the column labels.
 */
@container annotation-rows (max-width: 46rem) {
  .annotation-table,
  .annotation-table thead,
  .annotation-table tbody {
    display: block;
  }

  .annotation-table thead {
    position: sticky;
    top: 0;
    z-index: 1;
    background: var(--p-content-background);
    border-bottom: 1px solid var(--p-content-border-color);
  }

  .annotation-table tr {
    display: grid;
    grid-template-columns: 1.5rem minmax(0, 1.2fr) minmax(0, 0.95fr) minmax(0, 1.15fr) minmax(0, 0.9fr);
    grid-template-areas:
      'check name name name port'
      '. what species whose from';
    align-items: center;
    column-gap: 0.125rem;
  }

  /* The header is one line of the second line's labels; Variable, Units and Port stay for screen readers */
  .annotation-table thead tr {
    grid-template-areas: 'check what species whose from';
  }

  /* The units read as a suffix to the name; their own cell stays for screen readers */
  .annotation-table th:is(.annotation-table__variable, .annotation-table__units, .annotation-table__port),
  .annotation-table td.annotation-row__units {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip-path: inset(50%);
    white-space: nowrap;
  }

  .annotation-table tbody tr {
    padding: 0.125rem 0 0.25rem;
    border-bottom: 1px solid var(--p-content-border-color);
  }

  .annotation-table th {
    position: static;
    width: auto;
    padding: 0.125rem 0.4375rem;
  }

  .annotation-table th.annotation-table__check {
    padding-inline: 0.125rem;
  }

  .annotation-table td {
    width: auto;
    min-width: 0;
    padding: 0.0625rem 0.125rem;
    border-bottom: none;
  }

  .annotation-table :deep(.p-select .p-select-label) {
    padding-inline: 0.25rem;
  }

  .annotation-table__check {
    grid-area: check;
  }

  .annotation-table__variable,
  .annotation-row__name {
    grid-area: name;
  }

  .annotation-table__what,
  .annotation-row__what {
    grid-area: what;
  }

  .annotation-table__species,
  .annotation-row__species {
    grid-area: species;
  }

  .annotation-table__whose,
  .annotation-row__whose {
    grid-area: whose;
  }

  .annotation-table__from,
  .annotation-row__from {
    grid-area: from;
  }

  .annotation-table__port {
    grid-area: port;
    justify-self: end;
  }

  .annotation-row__name {
    display: flex;
    align-items: baseline;
    gap: 0.375rem;
  }

  .annotation-row__name .annotation-row__units-suffix {
    display: inline;
  }

  .annotation-table__what,
  .annotation-table__species,
  .annotation-table__whose,
  .annotation-table__from,
  .annotation-table :deep(.p-select .p-select-label) {
    font-size: 0.75rem;
  }
}

.annotation-row--incomplete {
  background: color-mix(in srgb, var(--p-orange-500) 10%, transparent);
}

.annotation-row__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* Leads the name, so a long name can't push it out of sight */
.annotation-row__term-warning {
  margin-right: 0.25rem;
  color: var(--p-orange-500);
  font-size: 0.875rem;
}

.annotation-row__name-text {
  overflow: hidden;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-weight: 600;
  text-overflow: ellipsis;
}

.annotation-row__units-suffix {
  display: none;
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  color: var(--p-text-muted-color);
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.annotation-row__units {
  overflow: hidden;
  color: var(--p-text-muted-color);
  font-size: 0.75rem;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.annotation-row__what > * {
  vertical-align: middle;
}

.annotation-row__what--warn :deep(.p-select) {
  width: calc(100% - 1.25rem);
}

.annotation-row__warning {
  margin-left: 0.25rem;
  color: var(--p-orange-500);
  font-size: 0.875rem;
}

.annotation-row__place {
  display: inline-block;
  max-width: calc(100% - 1rem);
  overflow: hidden;
  text-overflow: ellipsis;
  vertical-align: bottom;
}

.annotation-row__unusual {
  margin-left: 0.25rem;
  color: var(--p-orange-500);
  font-size: 0.75rem;
}

.annotation-row__sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

.annotation-port {
  display: inline-block;
  min-width: 1rem;
  cursor: default;
}

.annotation-port--exists {
  color: var(--p-primary-color);
}

.annotation-port--new,
.annotation-port--none {
  color: var(--p-text-muted-color);
}

.annotation-port--incomplete {
  color: var(--p-orange-500);
}

.annotation-port__process {
  margin-left: 0.25rem;
  color: var(--p-text-muted-color);
  font-size: 0.75rem;
}

.term-option {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
  width: 100%;
}

.term-option__curie {
  color: var(--p-text-muted-color);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.75rem;
}

.term-option__note {
  color: var(--p-text-muted-color);
  font-size: 0.75rem;
}

.term-option__obsolete {
  margin-left: 0.25rem;
  padding: 0 0.25rem;
  border-radius: 0.25rem;
  background: var(--p-orange-100);
  color: var(--p-orange-800);
  font-size: 0.6875rem;
  text-transform: uppercase;
}

.term-lookup {
  padding: 0.375rem 0.75rem;
  border-top: 1px solid var(--p-content-border-color);
  color: var(--p-text-muted-color);
  font-size: 0.75rem;
}

.annotation-tab__protein {
  color: var(--p-text-muted-color);
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
