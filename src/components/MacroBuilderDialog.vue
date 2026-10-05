<template>
  <Dialog
    v-model:visible="visible"
    class="macro-dialog"
    :modal="true"
    :draggable="false"
    :closable="true"
    :dismissableMask="isFlowReady"
    :appendTo="'body'"
    :style="{ width: '95vw', maxWidth: '95vw', height: '90vh' }"
    @show="onDialogShow"
    @hide="closeDialog"
  >
    <template #header>
      <div class="flex items-center gap-2">
        <i class="pi pi-hammer text-xl" />
        <span class="font-bold text-lg">Macro Builder</span>
      </div>
    </template>

    <div class="macro-dialog-body">
      <ResizableLibraryPanel
        title="Module Library"
        :initial-width="300"
        :min-width="150"
        :max-width="400"
        :overlay="false"
      >
        <LibraryArea />
      </ResizableLibraryPanel>
      <main class="workbench-macro">
        <Menubar :model="items">
          <template #item="{ item, props }">
            <a class="p-menubar-item-link" v-bind="props.action" v-tooltip.bottom="item.tooltip">
              <i v-if="typeof item.icon === 'string'" :class="item.icon" />
              <component :is="item.icon" v-else-if="item.icon" />
              <span v-if="item.label">{{ item.label }}</span>
            </a>
          </template>
        </Menubar>
        <div class="dnd-flow" @drop="onDrop" @dragover.prevent ref="canvasEl">
          <Transition name="fade">
            <div v-if="!isFlowReady" class="flow-loading-overlay">
              <i class="pi pi-spin pi-spinner loading-icon" />
              <span>Initialising macro builder...</span>
            </div>
          </Transition>
          <VueFlow
            v-if="isFlowReady"
            :id="FLOW_IDS.MACRO"
            @dragleave="onDragLeave"
            @nodes-change="onNodeChange"
            @edges-change="onEdgeChange"
            :default-edge-options="macroEdgeOptions"
            :connection-line-options="macroEdgeOptions"
            :nodes="nodes"
            :edges="edges"
            :delete-key-code="['Backspace', 'Delete']"
          >
            <template #node-instanceNode="props">
              <InstanceNode
                :id="props.id"
                :data="props.data"
                :selected="props.selected"
                :ref="(el) => (nodeRefs[props.id] = el)"
              />
            </template>
            <template #node-ghostNode="props">
              <GhostNode :id="props.id" :data="props.data" />
            </template>
            <WorkbenchArea />
          </VueFlow>
        </div>
      </main>
    </div>

    <template #footer>
      <div class="config-panel">
        <label class="repeat-count-control">
          <span>Repeat Count</span>
          <InputNumber v-model="multiplier" :min="1" :showButtons="true" />
        </label>
        <Button label="Cancel" severity="secondary" text @click="closeDialog" />
        <Button label="Generate Macro Node" severity="primary" @click="generateMacro" />
      </div>
    </template>
  </Dialog>

  <GhostSetupModal v-if="isGhostSetupOpen" @confirm="finalizeGhostNode" @cancel="cancelGhostNode" />

  <ConfirmDialog />
</template>

<script setup>
import { computed, ref, watch, nextTick, markRaw } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import InputNumber from 'primevue/inputnumber'
import ConfirmDialog from 'primevue/confirmdialog'
import Menubar from 'primevue/menubar'

import AddHandleBottom from './icons/AddHandles/AddHandleBottom.vue'
import AddHandleLeft from './icons/AddHandles/AddHandleLeft.vue'
import AddHandleRight from './icons/AddHandles/AddHandleRight.vue'
import AddHandleTop from './icons/AddHandles/AddHandleTop.vue'

import WorkbenchArea from './WorkbenchArea.vue'
import LibraryArea from './LibraryArea.vue'
import ResizableLibraryPanel from './ResizableLibraryPanel.vue'
import InstanceNode from './InstanceNode.vue'
import GhostNode from './GhostNode.vue'
import GhostSetupModal from './GhostSetupDialog.vue'
import { useLibraryStore } from '../stores/libraryStore'
import { useGtm } from '../composables/useGtm'
import useDragAndDrop from '../composables/useDnD'
import { useHandleManagement } from '../composables/useHandleManagement'
import { useConfirmDialog } from '../composables/useConfirmDialog'
import {
  edgeLineOptions,
  FLOW_IDS,
  GHOST_MATH_REF,
  GHOST_MODULE_DEFINITION,
  GHOST_MODULE_FILENAME,
  GHOST_MODULE_REF,
  GHOST_NODE_TYPE,
  MACRO_BUILDER_ARROW,
  markerEnd,
} from '../utils/constants'
import { detachReactivity } from '../utils/reactivity'
import { waitUntilStable } from '../utils/layout'
import { getHandleUidFromHandleId } from '../utils/handles'
import { useConfirm } from 'primevue'
import { useClearWorkspace } from '../composables/useClearWorkspace.js'

const { addEdges, removeEdges, edges,  onEdgeChange,
  findNode, nodes, onNodeChange, removeNodes,
  onConnect, onConnectEnd, 
  onDragLeave, updateNodeInternals, getSelectedNodes } =
  useVueFlow(FLOW_IDS.MACRO)

const confirm = useConfirmDialog()
const { clearWorkspace } = useClearWorkspace(FLOW_IDS.MACRO)

const previousNodes = new Set()
const { onDrop, isGhostSetupOpen, pendingGhostNodeId } = useDragAndDrop(previousNodes, FLOW_IDS.MACRO)
const { trackEvent } = useGtm()

const { revertPendingGhostIfUnused, confirmActivation, activateHandle, addHandle: addHandleToNode } = useHandleManagement()

const libraryStore = useLibraryStore()

const props = defineProps({
  modelValue: {
    type: Boolean,
    default: false,
  },
})

const emit = defineEmits(['update:modelValue', 'generate'])

const multiplier = ref(1)
const nodeRefs = ref({})
const isFlowReady = ref(false)
const canvasEl = ref(null)

const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const macroEdgeOptions = {
  ...edgeLineOptions,
  markerEnd: {
    type: markerEnd,
    id: MACRO_BUILDER_ARROW,
  },
}

const suppressedEdgeIds = new Set()

const isEmpty = computed(() => nodes.value.length === 0)
const isNodeSelected = computed(() => getSelectedNodes.value.length > 0)

const items = computed(() => [
  {
    label: '', 
    icon: 'pi pi-eraser',
    command: () => clearWorkspace(),
    tooltip: 'Clear Macro Builder',
    disabled: isEmpty.value,
  },
  { 
    label: '', 
    icon: markRaw(AddHandleLeft),
    command: () => addHandle('left'),
    tooltip: 'Add left handle',
    disabled: !isNodeSelected.value,
  },
  { 
    label: '', 
    icon: markRaw(AddHandleTop),
    command: () => addHandle('top'),
    tooltip: 'Add top handle',
    disabled: !isNodeSelected.value,
  },
  { 
    label: '', 
    icon: markRaw(AddHandleRight),
    command: () => addHandle('right'),
    tooltip: 'Add right handle',
    disabled: !isNodeSelected.value,
  },
  { 
    label: '', 
    icon: markRaw(AddHandleBottom),
    command: () => addHandle('bottom'),
    tooltip: 'Add bottom handle',
    disabled: !isNodeSelected.value,
  },
])

const addHandle = async (side) => {
  for (const node of getSelectedNodes.value) {
    await addHandleToNode(node.id, side)
  }
}

onConnect(async (connection) => {
  confirmActivation()
  if (connection.sourceHandle) {
    activateHandle(connection.source, getHandleUidFromHandleId(connection.sourceHandle))
  }

  if (connection.targetHandle) { 
    const targetNode = findNode(connection.target)
    if (targetNode.type === GHOST_NODE_TYPE) {
      activateHandle(targetNode.data.targetNodeId, getHandleUidFromHandleId(connection.targetHandle))
    } else {
      activateHandle(connection.target, getHandleUidFromHandleId(connection.targetHandle))
    }
  }

  const duplicate = edges.value.find(
    (e) => e.source === connection.source && e.target === connection.target
  )

  const duplicateSnapshot = duplicate ? detachReactivity(duplicate) : null

  const sourceHandleUid = connection.sourceHandle
    ? getHandleUidFromHandleId(connection.sourceHandle)
    : null
  const targetHandleUid = connection.targetHandle
    ? getHandleUidFromHandleId(connection.targetHandle)
    : null

  confirmActivation()

  if (sourceHandleUid) {
    activateHandle(connection.source, sourceHandleUid, { trackHistory: false })
  }
  if (targetHandleUid) {
    activateHandle(connection.target, targetHandleUid, { trackHistory: false })
  }

  if (duplicate) {
    const pendingEdge = {
      ...connection,
      id: `pending--${connection.source}--${connection.target}`,
      style: { strokeDasharray: '8 8', opacity: 0.4 }, 
    }

    // Prevents addition to history store.
    suppressedEdgeIds.add(pendingEdge.id)
    addEdges(pendingEdge)

    const shouldReplace = await confirm({
      header: 'Connection already exists',
      message:
        'A connection already exists between these instances. Do you wish to replace it?\n\n' +
        'If you select Cancel, the new connection will be discarded and the existing connection will remain.',
      severity: 'warning',
      acceptLabel: 'Replace',
      rejectLabel: 'Cancel',
    })

    removeEdges(pendingEdge.id)
    suppressedEdgeIds.delete(pendingEdge.id)

    if (!shouldReplace) {
      if (sourceHandleUid) revertHandleIfUnused(connection.source, sourceHandleUid, { trackHistory: false })
      if (targetHandleUid) revertHandleIfUnused(connection.target, targetHandleUid, { trackHistory: false })
      return
    }

    suppressedEdgeIds.add(duplicate.id)
    removeEdges(duplicate.id)
    revertHandlesForEdge(duplicateSnapshot)
  }

  // Match what we specify in connectionLineOptions.
  const newEdge = {
    ...connection,
    ...macroEdgeOptions,
    id: `macro-${connection.source}-${connection.target}`
  }

  addEdges(newEdge)
})

onConnectEnd(() => {
  revertPendingGhostIfUnused()
})

async function onDialogShow() {
  isFlowReady.value = false
  await nextTick()
  await waitUntilStable(canvasEl.value, 400)
  isFlowReady.value = true
  await nextTick()
  const nodeIds = nodes.value.map(n => n.id)
  updateNodeInternals(nodeIds)
}

watch(
  () => props.modelValue,
  (newVal) => {
    newVal
      ? libraryStore.addModule(GHOST_MODULE_DEFINITION)
      : libraryStore.removeModule(GHOST_MODULE_REF)
  }
)

function closeDialog() {
  isFlowReady.value = false
  visible.value = false
}

function generateMacro() {
  const serializedNodes = nodes.value.map((node) => {
    const dataSnapshot = detachReactivity(node.data)

    return {
      id: node.id,
      type: node.type,
      position: { ...node.position },
      data: dataSnapshot,
      width: node.dimensions?.width || node.width || 150, // Fallback safe
      height: node.dimensions?.height || node.height || 50,
    }
  })

  const serializedEdges = edges.value.map((e) => ({ ...e }))

  const macroData = {
    flow: { nodes: serializedNodes, edges: serializedEdges },
    repeatCount: multiplier.value,
  }

  trackEvent('macro_action', {
    category: 'MacroBuilder',
    action: 'generate_macro',
    label: `Nodes: ${nodes.value.length}`,
    file_type: 'json',
  })
  emit('generate', macroData)
  closeDialog()
}

const finalizeGhostNode = (selectedTargetNodeId) => {
  const ghostNode = findNode(pendingGhostNodeId.value)

  if (ghostNode) {
    ghostNode.data = {
      ...ghostNode.data,
      targetNodeId: selectedTargetNodeId,
    }
  }

  isGhostSetupOpen.value = false
  pendingGhostNodeId.value = null
}

// --- Handle Modal Cancellation ---
const cancelGhostNode = () => {
  if (pendingGhostNodeId.value) {
    removeNodes([pendingGhostNodeId.value])
  }

  isGhostSetupOpen.value = false
  pendingGhostNodeId.value = null
}
</script>

<style scoped>
.flow-loading-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  background: color-mix(in srgb, var(--p-content-background, #18181b) 85%, transparent);
  backdrop-filter: blur(4px);
  z-index: 20;
  color: var(--p-text-muted-color, #909399);
  font-size: 20px;
  font-weight: 500;
}

.loading-icon {
  font-size: 22px;
  color: var(--p-primary-color, #409eff);
}

/* ── Smooth Fade Transitions ── */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.25s ease-in-out;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}

.macro-dialog-body {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  height: 100%;
}

.workbench-macro {
  flex: 1 1 auto;
  min-width: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.dnd-flow {
  flex-grow: 1;
  height: 100%;
  width: 100%;
  position: relative;
}

.config-panel {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  justify-content: flex-end;
}

.repeat-count-control {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.95rem;
}
</style>

<style>
.macro-dialog .p-dialog-content {
  padding: 0;
  height: 100%;
  display: flex;
  flex-direction: column;
}

.macro-dialog .p-dialog-footer {
  padding: 1rem 1.25rem;
  border-top: 1px solid var(--p-surface-border);
}
</style>
