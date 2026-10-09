<template>
  <div
    class="instance-node"
    :id="id"
    ref="instanceNode"
    :class="{ selected: selected, 'instance-node--simulated': isSimulated }"
    @contextmenu.stop.prevent="openContextMenu"
    @mousedown.capture="StopDrag"
    @dblclick="openInstanceEditor('parameters')"
  >
    <NodeResizer min-width="200" min-height="120" :is-visible="selected" />

    <div :class="['instance-card', { 'has-category': categoryStyle }]" :style="categoryStyle">
      <!-- Top Actions Row -->
      <div class="card-header-actions">
        <div class="instance-details">
          <div class="detail-item">
            <i class="pi pi-box detail-icon"></i>
            <span class="detail-value">{{ componentName }}</span>
          </div>
          <div class="detail-item">
            <i class="pi pi-file detail-icon"></i>
            <span class="detail-value">{{ mathFile }}</span>
          </div>
        </div>
        <div style="flex-grow: 1; min-width: 1.5em;"></div> <!-- Spacer to push buttons to the right -->
        <div v-if="isMissingParameters" class="status-indicator">
          <i
            class="pi pi-exclamation-triangle warning-icon"
            v-tooltip.top="'At least one parameter has not been assigned a value'"
          ></i>
        </div>
        <Button
          rounded
          iconOnly
          size="small"
          severity="secondary"
          class="instance-button"
          icon="pi pi-pencil"
          @click="openInstanceEditor('parameters')"
          v-tooltip.bottom="{ value: 'Edit instance', showDelay: 300 }"
        />
      </div>

      <!-- Node Title Block -->
      <div class="instance-name" @dblclick="startEditing">
        <span v-if="!isEditing" class="name-text">
          {{ data.name }}
        </span>
        <SanitisedInput
          v-else
          ref="nameInputRef"
          v-model="editingName"
          :sanitise="sanitiseName"
          floating
          @commit="saveEdit"
          @revert="cancelEdit"
        />
      </div>
    </div>

    <template v-for="handle in data.handles" :key="handle.uid">
      <Handle
        :id="getHandleId(handle)"
        :ref="'handle_' + handle.side + '_' + handle.uid"
        :position="handlePosition(handle.side)"
        :class="['handle',
        `handle--${handle.variant|| 'default'}`,
        { 'handle--inert': handle.variant === HANDLE_VARIANT.GHOST && selected && isCornerHandle(handle, data.handles)},
        ]"
        :style="getHandleStyle(handle, data.handles)"
        v-tooltip.bottom="{ value: handle.name, showDelay: 1000 }"
        @mouseenter="onHandleEnter(handle.uid)"
        @mouseleave="onHandleLeave"
        @pointerdown="!isEditing && !(selected && isCornerHandle(handle, data.handles)) && handle.variant === HANDLE_VARIANT.GHOST && beginGhostActivation(props.id, handle.uid)"
      >
        <Button
          v-show="hoveredHandleUid === handle.uid && handle.variant !== HANDLE_VARIANT.GHOST"
          :class="['delete-handle-popover-btn', 'popover-' + handle.side]"
          icon="pi pi-trash"
          severity="danger"
          rounded
          text
          size="small"
          @mouseenter="onHandleEnter(handle.uid)"
          @mouseleave="onHandleLeave"
          @mousedown.stop
          @click.stop="removeHandle(handle.uid)"
        />
      </Handle>
    </template>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { Handle, useVueFlow } from '@vue-flow/core'
import { NodeResizer } from '@vue-flow/node-resizer'
import Button from 'primevue/button'

import SanitisedInput from './SanitisedInput.vue'
import { useLibraryStore } from '../stores/libraryStore'
import { useFlowHistoryStore } from '../stores/historyStore'
import { useSimulationResultsStore } from '../stores/simulationResultsStore'
import { useNodeThemeStore } from '../stores/nodeThemeStore'
import { getHandleId, getHandleStyle, handlePosition, isCornerHandle } from '../utils/handles'
import { sanitiseName } from '../utils/identifiers'
import { notify } from '../utils/notify'
import { isEditableVariableType, isEmpty } from '../utils/variables'
import { detachReactivity } from '../utils/reactivity'
import { HANDLE_VARIANT } from '../utils/constants'
import { categoryStyle as themeCategoryStyle } from '../utils/nodeThemes'
import { useHandleManagement } from '../composables/useHandleManagement'
import { useNodeDataHistory } from '../composables/useNodeDataHistory'

import '../assets/vueflownode.css'

const { id: flowId, addEdges, edges, removeEdges, updateNodeData, updateNodeInternals, nodes, viewport } = useVueFlow()
const { beginGhostActivation, revertPendingGhostIfUnused } = useHandleManagement()
const { recordEdit } = useNodeDataHistory(flowId)
const historyStore = useFlowHistoryStore()
const libraryStore = useLibraryStore()
const nodeThemeStore = useNodeThemeStore()

const props = defineProps({
  id: {
    type: String,
    required: true,
  },
  selected: {
    type: Boolean,
    default: false,
  },
  data: {
    type: Object,
    required: true,
  }, // { handles, variables, mathRef, moduleRef, ports, name }
})

const simulationResultsStore = useSimulationResultsStore()
// Outlined while the Simulation tab shows results of a selection that includes it.
const isSimulated = computed(() => !!simulationResultsStore.results && !!simulationResultsStore.scopeNodeIds?.includes(props.id))

const emit = defineEmits([
  'open-instance-editor',
  'open-context-menu',
])

function openInstanceEditor(defaultTab = 'parameters') {
  emit('open-instance-editor', {
    id: props.id,
    name: props.data.name,
    mathRef: props.data.mathRef,
    variables: props.data.variables,
    ports: props.data.ports,
    handles: props.data.handles,
    defaultTab,
  })
}

// Computed, so the card follows a save that moves the node to new math.
const componentName = computed(() => props.data.mathRef.split(':')[1])

const mathFile = computed(() => props.data.mathRef.split(':')[0])

// The node stores a category key; the active theme decides its colour (none when the theme lacks it).
const categoryStyle = computed(() => themeCategoryStyle(nodeThemeStore.activeTheme, props.data.domainType))

const isMissingParameters = computed(() => {
  for (const variable of props.data.variables || []) {
    if (isEditableVariableType(variable.type)) {
      if (variable.type === 'global_constant') {
        const globalConstant = libraryStore.getGlobalConstant(variable.name)
        if (isEmpty(globalConstant?.value)) {
          return true
        }
      } else if (isEmpty(variable.value)) {
        return true
      }
    }
  }
  return false
})

const portMenuRef = ref(null)

function togglePortMenu(event) {
  portMenuRef.value?.toggle(event)
}

const applyHandles = async (handlesToSet) => {
  updateNodeData(props.id, { handles: handlesToSet })
  await nextTick()
  updateNodeInternals(props.id)
}

const hoveredHandleUid = ref(null)
let enterTimeout = null
let leaveTimeout = null

function onHandleEnter(uid) {
  // 1. Cancel the hide timer if the user quickly moved back
  clearTimeout(leaveTimeout) 
  
  // 2. Only start the show timer if the button isn't already visible
  if (hoveredHandleUid.value !== uid) {
    enterTimeout = setTimeout(() => {
      hoveredHandleUid.value = uid
    }, 1000) // Adjust this value (in milliseconds) to change how long they must hover
  }
}

function onHandleLeave() {
  // 1. Cancel the show timer if they moved their mouse away before it appeared
  clearTimeout(enterTimeout) 
  
  // 2. Start the hide timer (gives a 150ms grace period to move the mouse to the button)
  leaveTimeout = setTimeout(() => {
    hoveredHandleUid.value = null
  }, 150) 
}

async function removeHandle(handleIdToRemove) {
  const oldHandles = detachReactivity(props.data.handles)

  const handle = oldHandles.find((h) => h.uid === handleIdToRemove)
  if (!handle) return

  const handleId = getHandleId(handle)

  // Find all edges connected to this specific port handle.
  // We need to snapshot these edge objects so we can restore them later
  const connectedEdges = edges.value.filter(
    (edge) =>
      (edge.source === props.id && edge.sourceHandle === handleId) ||
      (edge.target === props.id && edge.targetHandle === handleId)
  )

  const edgesSnapshot = connectedEdges.map((edge) => detachReactivity(edge))

  // Define New Handles (for Redo)
  const newHandles = props.data.handles.map(
    (h) => h.uid === handleIdToRemove ? { ...h, variant: HANDLE_VARIANT.GHOST } : h
  )

  // Add Composite Command to History
  historyStore.executeAndAddCommand({
    type: 'remove-handle',
    undo: async () => {
      // Restore the handle first (so the handle exists in the DOM).
      await applyHandles(oldHandles)

      // Then, restore the edges.
      if (edgesSnapshot.length > 0) {
        addEdges(edgesSnapshot)
      }
    },
    redo: async () => {
      // Remove the edges.
      if (edgesSnapshot.length > 0) {
        removeEdges(edgesSnapshot.map((e) => e.id))
      }

      // Then, remove the handle.
      await applyHandles(newHandles)
    },
  })
}

const isEditing = ref(false)
const editingName = ref('')
const nameInputRef = ref(null)

// Panning or zooming the canvas moves the field without a scroll or resize event, so re-anchor the popover.
watch(viewport, () => {
  if (isEditing.value) nameInputRef.value?.updatePosition()
})

async function startEditing(event) {
  event.stopPropagation()

  isEditing.value = true
  editingName.value = props.data.name

  await nextTick()
  nameInputRef.value?.focus()
}

function StopDrag(event) {
  if (isEditing.value) {
    event.stopPropagation()
  }
}

// This is triggered by pressing Enter or clicking away
function saveEdit() {
  // Unmounting the field can fire a late blur, so ignore commits once editing has ended.
  if (!isEditing.value) return
  revertPendingGhostIfUnused()
  if (!editingName.value || editingName.value.trim() === '') {
    isEditing.value = false
    return
  }

  const sanitisedName = sanitiseName(editingName.value)

  if (!sanitisedName) {
    isEditing.value = false
    return
  }

  const nameExists = nodes.value.some((node) => node.id !== props.id && node.data && node.data.name === sanitisedName)

  if (nameExists) {
    notify.error({ message: 'An instance with this name already exists.' })
    return
  }

  recordEdit({
    type: 'rename-node',
    nodeIds: [props.id],
    keys: ['name'],
    apply: () => updateNodeData(props.id, { name: sanitisedName }),
  })
  isEditing.value = false
}

// This is triggered by pressing Escape
function cancelEdit() {
  isEditing.value = false
}

function openContextMenu(event) {
  emit('open-context-menu', {
    clientX: event.clientX,
    clientY: event.clientY,
    id: props.id,
  })
}
</script>

<style lang="scss" scoped>
@import '../assets/vueflowhandle.css';

.vue-flow__handle.handle--default {
  width: 14px;
  height: 14px;
  border-radius: 50%;
  background: var(--p-text-color);
  opacity: 1;
}

.vue-flow__handle.handle--ghost {
  width: 25px;
  height: 25px;
  border-radius: 50%;
  background: transparent;
  border: none;
  opacity: 0;
  pointer-events: auto;
}

.vue-flow__handle.handle--ghost:hover,
.vue-flow__handle.handle--ghost.valid {
  background-color: rgba(34, 197, 94, 0.15);
  border-color: #22c55e;  
  border-style: solid;
  opacity: 1;
}

.vue-flow__handle.handle--ghost.handle--inert {
  pointer-events: none;
}

.instance-name {
  margin-top: auto; 
  min-height: 2rem; 
  margin-left: 1%;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%; 
  font-weight: 600;
  font-size: 1.2rem;
  padding-bottom: 0.25rem;
  margin-top: 0.5em;
  margin-bottom: 0.5em;
}

.instance-name :deep(.p-inputtext) {
  width: 100%;
  padding-top: 0.2rem;
  padding-bottom: 0.2rem;
}

.name-text {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.instance-node {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-width: 200px;
  min-height: 120px;
  box-sizing: border-box;
  border-radius: 10px;
}

.instance-card {
  flex: 1 1 auto; 
  min-height: 0;   
  margin: 0;
  border-radius: 10px;
  box-sizing: border-box;
  position: relative;
  color: var(--p-text-color);
  border: 3px solid color-mix(in srgb, var(--p-text-color) 4%, transparent);
  box-shadow: 0 1px 2px color-mix(in srgb, var(--p-text-color) 6%, transparent);
  transition: box-shadow 120ms ease;
  padding: 0.5rem 0.75rem 0.65rem 0.75rem;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
}

.instance-card:hover {
  box-shadow: 0 4px 10px color-mix(in srgb, var(--p-text-color) 12%, transparent);
}

.warning-icon {
  color: var(--p-orange-500);
  font-size: 0.85rem;
  cursor: help;
}

.warning-icon:hover {
  color: var(--p-orange-600);
}

.card-header-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.35rem;
  width: 100%;
  min-height: 1.6rem;
  z-index: 10;
}

.instance-details {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
  overflow: hidden;
}

.detail-item {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.75rem;
  color: color-mix(in srgb, var(--p-text-color) 70%, transparent);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.detail-icon {
  font-size: 0.7rem;
  flex-shrink: 0;
  opacity: 0.8;
}

.detail-value {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.instance-button {
  margin: 0;
  flex-shrink: 0; 
  width: 1.6rem !important;
  height: 1.6rem !important;
  padding: 0 !important;
}

.status-indicator {
  background-color: color-mix(in srgb, var(--p-orange-500) 20%, var(--p-content-background));
  border-radius: 50%;
  width: 1.6rem;
  height: 1.6rem;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: 0 2px 4px color-mix(in srgb, var(--p-text-color) 10%, transparent);
}

.instance-button :deep(.p-button-icon),
.instance-button :deep(i) {
  font-size: 0.75rem !important;
  width: 0.75rem;
  height: 0.75rem;
}

/* Base appearance for the popover */
.delete-handle-popover-btn {
  position: absolute;
  background-color: var(--p-content-background);
  box-shadow: 0 4px 10px color-mix(in srgb, var(--p-text-color) 20%, transparent);
  border: 1px solid color-mix(in srgb, var(--p-text-color) 10%, transparent);
  z-index: 20;
  cursor: pointer;
}

/* Position for Top handles (Appears above) */
.popover-top {
  top: 50%;
  left: 50%;
  transform: translate(-50%, calc(-100% - 14px));
}

/* Position for Bottom handles (Appears below) */
.popover-bottom {
  top: 50%;
  left: 50%;
  /* Pushes it down */
  transform: translate(-50%, 14px);
}

/* Position for Left handles (Appears to the left) */
.popover-left {
  top: 50%;
  left: 50%;
  transform: translate(calc(-100% - 14px), -50%);
}

/* Position for Right handles (Appears to the right) */
.popover-right {
  top: 50%;
  left: 50%;
  transform: translate(14px, -50%);
}

</style>

<style>
.content-fit-menu {
  width: max-content !important; 
  min-width: 0 !important; 
}
.vue-flow__node {
  background: transparent !important;
}
</style>
