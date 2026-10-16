<template>
  <div class="edge-appearance-panel">
    <div v-if="selectedEdges.length" class="panel-block" data-testid="edge-appearance-selection">
      <span class="block-title">
        Connection appearance
        <span class="context-count">({{ selectedEdges.length }} selected)</span>
      </span>
      <ConnectionAppearanceFields
        :appearance="selectionAppearance.appearance"
        :mixed="selectionAppearance.mixed"
        @change="setSelectionAppearance"
        @preview="previewSelectionColour"
        @preview-end="endPreview"
      />
      <Button
        label="Use as default for new connections"
        icon="pi pi-bookmark"
        size="small"
        outlined
        :disabled="selectionAppearance.mixed.length > 0"
        @click="setConnectionDefaults(selectionAppearance.appearance)"
      />
    </div>

    <div v-else class="panel-block" data-testid="edge-appearance-defaults">
      <span class="block-title">New connections</span>
      <p class="hint">Select connections to style them. New connections start like this:</p>
      <ConnectionAppearanceFields
        :appearance="defaultAppearance"
        @change="(patch) => setConnectionDefaults({ ...defaultAppearance, ...patch })"
      />
      <Button
        label="Apply to all connections"
        icon="pi pi-check-square"
        size="small"
        outlined
        :disabled="!edges.length"
        @click="applyDefaultsToAll"
      />
    </div>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import Button from 'primevue/button'

import ConnectionAppearanceFields from './ConnectionAppearanceFields.vue'
import { useNodeDataHistory } from '../composables/useNodeDataHistory'
import { useFlowHistoryStore } from '../stores/historyStore'
import { useWorkspaceAppearanceStore } from '../stores/workspaceAppearanceStore'
import { FLOW_IDS } from '../utils/constants'
import { resolveEdgeAppearance, withEdgeAppearance } from '../utils/edges'

const APPEARANCE_KEYS = ['colour', 'path', 'arrow', 'width']

const { edges, findEdge, getSelectedEdges } = useVueFlow(FLOW_IDS.MAIN)
const { recordEdit } = useNodeDataHistory(FLOW_IDS.MAIN)
const history = useFlowHistoryStore()
const appearanceStore = useWorkspaceAppearanceStore()

const selectedEdges = computed(() => getSelectedEdges.value)

/** The selection's shared appearance, taken from its first edge where values differ, and the keys that differ. */
const selectionAppearance = computed(() => {
  const resolved = selectedEdges.value.map((edge) => resolveEdgeAppearance(edge.data?.appearance))
  const mixed = APPEARANCE_KEYS.filter((key) => new Set(resolved.map((appearance) => appearance[key])).size > 1)
  return { appearance: resolved[0] ?? resolveEdgeAppearance(), mixed }
})

const defaultAppearance = computed(() => resolveEdgeAppearance(appearanceStore.connectionDefaults))

/**
 * Gives edges new appearance values, replacing their data so pasted copies sharing it keep theirs.
 *
 * @param {Array<string>} ids
 * @param {Function} appearanceFor - Takes an edge's current appearance and returns its new one.
 */
function writeAppearance(ids, appearanceFor) {
  ids.forEach((id) => {
    const edge = findEdge(id)
    if (edge) edge.data = withEdgeAppearance(edge.data, appearanceFor(edge.data?.appearance ?? {}))
  })
}

// ── Colour preview ─────────────────────────────────────────────────────
// Edge data from before the colour picker opened, put back when it closes.
let previewBase = null

/**
 * Shows a colour on the selection without recording it.
 *
 * @param {string|null} colour
 */
function previewSelectionColour(colour) {
  if (!previewBase) previewBase = new Map(selectedEdges.value.map((edge) => [edge.id, edge.data]))
  writeAppearance([...previewBase.keys()], (appearance) => ({ ...appearance, colour }))
}

function endPreview() {
  previewBase?.forEach((data, id) => {
    const edge = findEdge(id)
    if (edge) edge.data = data
  })
  previewBase = null
}

watch(() => selectedEdges.value.map((edge) => edge.id).join('\n'), endPreview)
onBeforeUnmount(endPreview)

/**
 * Sets appearance values on every selected edge as one undo step; a built-in value removes its key.
 *
 * @param {Object} patch - Appearance values by key.
 */
function setSelectionAppearance(patch) {
  const ids = selectedEdges.value.map((edge) => edge.id)
  if (!ids.length) return
  recordEdit({
    type: 'set-edge-appearance',
    nodeIds: [],
    keys: [],
    edgeIds: ids,
    edgeKeys: ['appearance'],
    apply: () => writeAppearance(ids, (appearance) => ({ ...appearance, ...patch })),
  })
}

/**
 * Sets the appearance new connections start with, as an undo step.
 *
 * @param {Object} appearance
 */
function setConnectionDefaults(appearance) {
  const before = { ...appearanceStore.connectionDefaults }
  appearanceStore.setConnectionDefaults(appearance)
  const after = { ...appearanceStore.connectionDefaults }
  if (JSON.stringify(before) === JSON.stringify(after)) return
  history.executeAndAddCommand({
    type: 'set-connection-defaults',
    undo: () => appearanceStore.setConnectionDefaults(before),
    redo: () => appearanceStore.setConnectionDefaults(after),
  })
}

/** Gives every connection the default appearance as one undo step. */
function applyDefaultsToAll() {
  const ids = edges.value.map((edge) => edge.id)
  const defaults = { ...appearanceStore.connectionDefaults }
  recordEdit({
    type: 'apply-connection-defaults',
    nodeIds: [],
    keys: [],
    edgeIds: ids,
    edgeKeys: ['appearance'],
    apply: () => writeAppearance(ids, () => defaults),
  })
}
</script>

<style scoped>
.edge-appearance-panel {
  display: flex;
  flex-direction: column;
}

.panel-block {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.block-title {
  font-size: 0.85rem;
  font-weight: 600;
}

.context-count {
  font-weight: normal;
  color: var(--p-text-muted-color);
}

.hint {
  margin: 0;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}
</style>
