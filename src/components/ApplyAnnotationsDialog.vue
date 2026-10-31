<template>
  <Dialog
    v-model:visible="dialogVisible"
    modal
    header="Apply Annotations"
    :style="{ width: '860px', maxWidth: 'calc(100vw - 32px)' }"
    :breakpoints="{ '640px': 'calc(100vw - 16px)' }"
    @after-hide="resetChoices"
  >
    <div v-if="prepared" class="apply-annotations">
      <section v-if="prepared.sidecars.length" class="apply-section">
        <h3 class="apply-section__title">Module sidecars</h3>
        <DataTable :value="sidecarRows" size="small" data-test="sidecars" dataKey="filename">
          <Column header="File" field="filename" />
          <Column header="Component">
            <template #body="{ data }">
              <span v-if="data.component">{{ data.component.componentName }}</span>
              <Tag v-if="data.component" :value="data.component.kind" severity="secondary" class="apply-tag" />
              <span v-else class="apply-muted">—</span>
            </template>
          </Column>
          <Column header="Attaches to math">
            <template #body="{ data }">
              <div class="apply-attach">
                <span v-if="data.match.isExact" class="apply-exact" data-test="sidecar-exact">
                  <i class="pi pi-check" aria-hidden="true"></i> {{ data.match.mathRef }}
                </span>
                <Select
                  v-else-if="data.component && data.match.candidates.length"
                  v-model="targets[data.filename]"
                  :options="data.match.candidates"
                  placeholder="Pick a math"
                  showClear
                  size="small"
                  class="apply-select"
                  :aria-label="`Math for ${data.filename}`"
                  data-test="sidecar-select"
                />
                <span v-if="!targets[data.filename]" class="apply-warn" data-test="sidecar-unmatched">
                  <i class="pi pi-exclamation-triangle" aria-hidden="true"></i>
                  {{ unmatchedText(data) }}
                </span>
              </div>
            </template>
          </Column>
        </DataTable>
      </section>

      <section class="apply-section">
        <h3 class="apply-section__title">
          Instances <span class="apply-muted">from {{ prepared.instanceFile.location }}</span>
        </h3>
        <DataTable :value="rows" size="small" data-test="instances" dataKey="subject">
          <Column header="Instance" field="name" />
          <Column header="Kind">
            <template #body="{ data }">
              <Tag :value="data.kind ?? 'unknown'" severity="secondary" class="apply-tag" />
            </template>
          </Column>
          <Column header="Module">
            <template #body="{ data }">
              <span v-if="data.nodeId" class="apply-muted" v-tooltip.top="'The existing instance keeps its module'">
                {{ data.mathRef }}
              </span>
              <Select
                v-else-if="data.candidates.length > 1"
                :modelValue="data.mathRef"
                :options="data.candidates"
                placeholder="Pick a module"
                size="small"
                class="apply-select"
                :invalid="!data.mathRef"
                :aria-label="`Module for ${data.name}`"
                data-test="module-select"
                @update:modelValue="(mathRef) => choose(data.subject, { mathRef })"
              />
              <span v-else-if="data.mathRef">{{ data.mathRef }}</span>
              <span v-else class="apply-warn" data-test="unresolved">
                <i class="pi pi-exclamation-triangle" aria-hidden="true"></i> Unresolved: skipped
              </span>
            </template>
          </Column>
          <Column header="Binds to">
            <template #body="{ data }">
              <Tag v-if="data.nodeId" :value="data.nodeName" severity="info" icon="pi pi-link" data-test="binds" />
              <Tag v-else-if="data.mathRef" value="New" severity="success" icon="pi pi-plus" />
              <span v-else class="apply-muted">—</span>
            </template>
          </Column>
          <Column header="Held constant (reservoir)">
            <template #body="{ data }">
              <Checkbox
                :modelValue="data.heldConstant"
                binary
                :disabled="!data.mathRef"
                :inputId="`held-${data.name}`"
                :aria-label="`Hold ${data.name} constant`"
                data-test="held"
                @update:modelValue="(heldConstant) => choose(data.subject, { heldConstant })"
              />
            </template>
          </Column>
        </DataTable>
        <Message
          v-for="(warning, index) in prepared.apiCoords.warnings"
          :key="index"
          severity="warn"
          size="small"
          variant="simple"
          class="apply-message"
        >
          {{ warning.message }}
        </Message>
      </section>

      <p class="apply-note">
        <i class="pi pi-info-circle" aria-hidden="true"></i>
        Held constant fixes the instance’s summed fluxes at 0. Undo removes the added instances and bindings; the
        sidecars and the instance file stay stored with the workspace.
      </p>
    </div>

    <template #footer>
      <Button variant="outlined" label="Cancel" @click="dialogVisible = false" />
      <Button :label="applyLabel" :disabled="!applicableCount" data-test="apply" @click="onApply" />
    </template>
  </Dialog>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import Button from 'primevue/button'
import Checkbox from 'primevue/checkbox'
import Column from 'primevue/column'
import DataTable from 'primevue/datatable'
import Dialog from 'primevue/dialog'
import Message from 'primevue/message'
import Select from 'primevue/select'
import Tag from 'primevue/tag'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  /** From useApplyAnnotations' readAnnotationFiles. */
  prepared: { type: Object, default: null },
  /** useApplyAnnotations' planRows. */
  planRows: { type: Function, required: true },
})

const emit = defineEmits(['update:modelValue', 'apply'])

const dialogVisible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

// Target math by sidecar filename, and the user's module and held-constant choices by instance subject.
const targets = ref({})
const choices = reactive(new Map())

function resetChoices() {
  const sidecars = props.prepared?.sidecars ?? []
  targets.value = Object.fromEntries(sidecars.map((entry) => [entry.filename, entry.match.mathRef]))
  choices.clear()
}

watch(() => props.prepared, resetChoices, { immediate: true })

const sidecarRows = computed(() => props.prepared?.sidecars ?? [])

/** Why a sidecar isn't stored yet. */
function unmatchedText(entry) {
  if (entry.error) return entry.error
  if (entry.match.candidates.length) return 'Not stored until a math is picked'
  return `No math has a ${entry.component.componentName} component: not stored`
}

/**
 * Records a choice for one instance.
 *
 * @param {string} subject
 * @param {{ mathRef?: string, heldConstant?: boolean }} choice
 */
function choose(subject, choice) {
  choices.set(subject, { ...choices.get(subject), ...choice })
}

const rows = computed(() => {
  if (!props.prepared) return []
  return props.planRows(props.prepared, targets.value).map((row) => {
    const choice = choices.get(row.subject) ?? {}
    const mathRef = !row.nodeId && row.candidates.includes(choice.mathRef) ? choice.mathRef : row.mathRef
    return { ...row, mathRef, heldConstant: mathRef ? (choice.heldConstant ?? row.heldConstant) : false }
  })
})

const applicableCount = computed(() => rows.value.filter((row) => row.mathRef).length)
const applyLabel = computed(() => {
  const added = rows.value.filter((row) => row.mathRef && !row.nodeId).length
  const bound = rows.value.filter((row) => row.mathRef && row.nodeId).length
  const parts = [added && `add ${added}`, bound && `bind ${bound}`].filter(Boolean)
  return parts.length ? `Apply (${parts.join(', ')})` : 'Apply'
})

function onApply() {
  emit('apply', { targets: { ...targets.value }, rows: rows.value.map((row) => ({ ...row })) })
  dialogVisible.value = false
}
</script>

<style scoped>
.apply-annotations {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.apply-section__title {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
}

.apply-tag {
  margin-left: 6px;
  font-size: 11px;
}

.apply-attach {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
}

.apply-select {
  min-width: 200px;
}

.apply-exact {
  color: var(--p-text-color);
}

.apply-exact .pi {
  color: var(--p-green-500);
}

.apply-warn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--p-orange-500);
  font-size: 13px;
}

.apply-muted {
  color: var(--p-text-muted-color);
  font-weight: normal;
}

.apply-message {
  margin-top: 6px;
}

.apply-note {
  display: flex;
  gap: 6px;
  margin: 0;
  color: var(--p-text-muted-color);
  font-size: 13px;
}
</style>
