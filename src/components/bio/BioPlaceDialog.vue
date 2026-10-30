<template>
  <Dialog
    :visible="true"
    modal
    :header="HEADERS[mode]"
    :style="{ width: '440px' }"
    class="compact-dialog"
    data-testid="bio-place-dialog"
    @update:visible="(visible) => !visible && emit('cancel')"
  >
    <template v-if="mode === 'assign'">
      <p class="dialog-label">Show {{ name }} as:</p>
      <Select
        v-model="role"
        :options="ROLE_OPTIONS"
        option-label="label"
        option-value="id"
        class="w-full"
        data-testid="bio-place-role"
      />
    </template>

    <template v-else>
      <p class="dialog-label">
        {{ mode === 'cell' ? 'Module for the cell’s inside:' : 'Module for the compartment:' }}
      </p>
      <Select
        v-model="moduleRef"
        :options="moduleOptions('compartment')"
        option-label="label"
        option-value="moduleRef"
        filter
        placeholder="Pick a module…"
        class="w-full"
        data-testid="bio-place-module"
      />
      <template v-if="mode === 'cell'">
        <p class="dialog-label">Module for its membrane (optional):</p>
        <Select
          v-model="membraneRef"
          :options="[{ moduleRef: null, label: 'None' }, ...moduleOptions('membrane')]"
          option-label="label"
          option-value="moduleRef"
          filter
          class="w-full"
          data-testid="bio-place-membrane"
        />
      </template>
    </template>

    <!-- Which cell, and where on or beside it -->
    <template v-if="needsCell">
      <p class="dialog-label">{{ needsSide ? 'Against:' : 'In:' }}</p>
      <Select
        v-model="cell"
        :options="cellOptions"
        option-label="label"
        option-value="id"
        :placeholder="cells.length ? 'Pick a cell…' : 'There are no cells yet'"
        :disabled="!cells.length"
        class="w-full"
        data-testid="bio-place-cell"
      />
      <SelectButton
        v-if="needsSide && cell"
        v-model="side"
        :options="SIDE_OPTIONS"
        option-label="label"
        option-value="id"
        :allow-empty="false"
        size="small"
        class="bio-place-side"
        data-testid="bio-place-side"
      />
    </template>

    <template #footer>
      <div class="dialog-footer">
        <Button label="Cancel" severity="secondary" outlined class="compact-btn" @click="emit('cancel')" />
        <Button
          :label="mode === 'assign' ? 'Apply' : 'Add'"
          class="compact-btn"
          :disabled="!ready"
          data-testid="bio-place-confirm"
          @click="confirm"
        />
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { computed, onMounted, ref, watch } from 'vue'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Select from 'primevue/select'
import SelectButton from 'primevue/selectbutton'
import { useLibraryStore } from '../../stores/libraryStore'

const props = defineProps({
  /** 'assign' (what a dropped instance is), 'cell' (add a cell) or 'compartment' (add a compartment). */
  mode: { type: String, required: true },
  /** The instance's name, when assigning. */
  name: { type: String, default: '' },
  /** Its role as worked out from its annotations, when assigning. */
  initialRole: { type: String, default: 'none' },
  /** The cells there are: [{ id, name }]. */
  cells: { type: Array, default: () => [] },
})

const emit = defineEmits(['confirm', 'cancel'])

const HEADERS = { assign: 'What is it?', cell: 'Add Cell', compartment: 'Add Compartment' }

const ROLE_OPTIONS = [
  { id: 'membraneProtein', label: 'A protein in a cell’s membrane' },
  { id: 'cytosol', label: 'A cell (its inside)' },
  { id: 'membrane', label: 'A cell’s membrane' },
  { id: 'cytosolic', label: 'A process inside a cell' },
  { id: 'region', label: 'A compartment outside cells' },
  { id: 'none', label: 'Nothing physiological (a card)' },
]

const SIDE_OPTIONS = [
  { id: 'apical', label: 'Apical' },
  { id: 'basolateral', label: 'Basolateral' },
  { id: 'left', label: 'Left side' },
  { id: 'right', label: 'Right side' },
]

const libraryStore = useLibraryStore()

const role = ref(props.mode === 'compartment' ? 'region' : props.mode === 'cell' ? 'cytosol' : props.initialRole)
const moduleRef = ref(null)
const membraneRef = ref(null)
const cell = ref(props.cells.length === 1 ? props.cells[0].id : null)
const side = ref('apical')

const needsCell = computed(() => ['membraneProtein', 'membrane', 'cytosolic', 'region'].includes(role.value))
const needsSide = computed(() => role.value === 'membraneProtein' || role.value === 'region')
// A protein or compartment may go nowhere in particular; the rest need their cell.
const cellOptions = computed(() => [
  ...(needsSide.value
    ? [{ id: null, label: role.value === 'region' ? 'Not against a cell' : 'Not in a membrane yet' }]
    : []),
  ...props.cells.map(({ id, name }) => ({ id, label: name })),
])
const ready = computed(() => {
  if (props.mode !== 'assign' && !moduleRef.value) return false
  if (role.value === 'membrane' || role.value === 'cytosolic') return !!cell.value
  return true
})

// Sidecars are parsed when first needed, so a module's kind is known for sorting.
const parsed = ref(0)
onMounted(async () => {
  if (props.mode === 'assign') return
  const mathRefs = new Set([...libraryStore.availableModules.values()].map((module) => module.mathRef).filter(Boolean))
  await Promise.all([...mathRefs].map((mathRef) => libraryStore.ensureModuleAnnotations(mathRef)))
  parsed.value++
})

/**
 * The library's modules, those whose annotations say they are this kind first.
 *
 * @param {'compartment'|'membrane'} kind
 * @returns {Array<{moduleRef: string, label: string}>}
 */
function moduleOptions(kind) {
  void parsed.value
  const kindOf = (module) => libraryStore.getParsedModuleAnnotations(module.mathRef)?.component?.kind ?? null
  return [...libraryStore.availableModules.values()]
    .filter((module) => module.mathRef)
    .map((module) => ({
      moduleRef: module.moduleRef,
      label: kindOf(module) === kind ? `${module.moduleRef} (${kind})` : module.moduleRef,
      match: kindOf(module) === kind,
    }))
    .sort((a, b) => Number(b.match) - Number(a.match) || a.moduleRef.localeCompare(b.moduleRef))
}

watch(role, () => {
  if (!needsSide.value && cell.value === null && props.cells.length === 1) cell.value = props.cells[0].id
})

function confirm() {
  const lateral = side.value === 'left' || side.value === 'right'
  const placement = cell.value
    ? { cell: cell.value, facet: lateral ? 'lateral' : side.value, ...(lateral && { at: side.value }) }
    : null
  emit('confirm', {
    role: role.value,
    moduleRef: moduleRef.value,
    membraneRef: membraneRef.value,
    cell: cell.value,
    placement,
  })
}
</script>

<style scoped>
.dialog-label {
  margin: 0.75rem 0 0.35rem;
}

.dialog-label:first-child {
  margin-top: 0;
}

.bio-place-side {
  margin-top: 0.5rem;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.5rem;
}
</style>
