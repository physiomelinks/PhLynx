<template>
  <Dialog
    v-model:visible="visible"
    :style="{ width: '1200px', maxHeight: '92vh' }"
    :draggable="false"
    :closable="false"
    modal
    :appendTo="'body'"
    :dismissableMask="isFlowReady"
    @show="onDialogShow"
    @hide="onClosed"
    @wheel.stop
  >
    <!-- Custom header -->
    <template #header>
      <div class="dialog-header">
        <div class="dialog-title">
          <span class="title-icon">⇌</span>
          <span>Connections</span>
        </div>

        <div class="node-names" v-if="sourceNode && targetNode">
          <Chip
            :label="sourceNode.data.name"
            style="background: color-mix(in srgb, var(--p-primary-color, #409eff) 15%, transparent); color: var(--p-primary-color, #409eff); border: 1px solid color-mix(in srgb, var(--p-primary-color, #409eff) 30%, transparent);"
          />
          <span class="arrow-sep">→</span>
          <Chip
            :label="targetNode.data.name"
            style="background: color-mix(in srgb, var(--p-secondary-color, #409eff) 15%, transparent); color: var(--p-secondary-color, #409eff); border: 1px solid color-mix(in srgb, var(--p-secondary-color, #409eff) 30%, transparent);"
          />
        </div>
      </div>
    </template>

    <div v-if="sourceNode && targetNode" class="root">
      <div class="connections-layout">
        <!-- Column headers -->
        <div class="col-headers">
          <div class="col-header-label source-side">
            <span class="side-label">SOURCE: {{ sourceNode.data.name }}</span>
            <div class="col-subheaders">
              <span class="col-header">Type</span>
              <span class="col-header">Label</span>
              <span class="col-header">Mode</span>
              <span class="col-header">Variables</span>
              <span aria-hidden="true"></span>
              <span aria-hidden="true"></span>
            </div>
          </div>

          <!-- Middle gap spacer -->
          <div class="mid-spacer"></div>

          <div class="col-header-label target-side">
            <span class="side-label">TARGET: {{ targetNode.data.name }}</span>
            <div class="col-subheaders">
              <span aria-hidden="true"></span>
              <span aria-hidden="true"></span>
              <span class="col-header">Type</span>
              <span class="col-header">Label</span>
              <span class="col-header">Mode</span>
              <span class="col-header">Variables</span>
            </div>
          </div>
        </div>

        <!-- VueFlow canvas -->
        <div ref="canvasEl" class="flow-canvas" @wheel.stop.prevent="onCanvasWheel">
          <div :style="{ height: canvasHeight + 'px', position: 'relative' }">
            <!-- Loading Overlay -->
            <Transition name="fade">
              <div v-if="!isFlowReady" class="flow-loading-overlay">
                <i class="pi pi-spin pi-spinner loading-icon" />
                <span>Initializing connections...</span>
              </div>
            </Transition>
            <Transition name="fade">
              <VueFlow
                v-if="isFlowReady"
                :id="FLOW_IDS.EDGE"
                :nodes="flowNodes"
                :edges="flowEdges"
                :nodes-draggable="false"
                :nodes-connectable="true"
                :elements-selectable="false"
                :pan-on-drag="false"
                :pan-on-scroll="false"
                :auto-pan-on-node-drag="false"
                :auto-pan-on-connect="false"
                :zoom-on-scroll="false"
                :zoom-on-pinch="false"
                :zoom-on-double-click="false"
                :edges-updatable="true"
                :auto-connect="false"
                :is-valid-connection="isValidConnection"
                @connect="onConnect"
                @edge-update="onEdgeUpdate"
                @connect-start="onConnectStart"
                @connect-end="onConnectEnd"
                @edge-update-start="onEdgeUpdateStart"
                @edge-update-end="onEdgeUpdateEnd"
                @node-click="onNodeClick"
              >
                <!-- Source port row -->
                <template #node-sourcePort="{ data }">
                  <PortRow
                    side="source"
                    :port="data.port"
                    :variables="sourceNode.data.variables"
                    :owner="sourceOwners.get(data.port.exposedPortId) ?? null"
                    :index="sourceIndices.get(data.port.exposedPortId) ?? null"
                    :is-connected="data.isConnected"
                    :is-taken-elsewhere="data.isTakenElsewhere"
                    :is-valid-target="validConnectUids.has(data.port._uid)"
                    :problems="problemsByUid.get(data.port._uid) ?? []"
                    :style="rowStyle(data.port._uid, 'source')"
                    @change="onPortConfigChange"
                    @start-drag="startDrag($event, data.port._uid, 'source')"
                    @delete="deletePort(data.port._uid, 'source')"
                  />
                </template>

                <!-- Target port row -->
                <template #node-targetPort="{ data }">
                  <PortRow
                    side="target"
                    :port="data.port"
                    :variables="targetNode.data.variables"
                    :owner="targetOwners.get(data.port.exposedPortId) ?? null"
                    :index="targetIndices.get(data.port.exposedPortId) ?? null"
                    :is-connected="data.isConnected"
                    :is-taken-elsewhere="data.isTakenElsewhere"
                    :is-valid-target="validConnectUids.has(data.port._uid)"
                    :problems="problemsByUid.get(data.port._uid) ?? []"
                    :style="rowStyle(data.port._uid, 'target')"
                    @change="onPortConfigChange"
                    @start-drag="startDrag($event, data.port._uid, 'target')"
                    @delete="deletePort(data.port._uid, 'target')"
                  />
                </template>

                <!-- Ghost port row -->
                <template #node-ghostPort="{ data }">
                  <div class="ghost-node">
                    <Handle
                      v-if="data.side === 'target'"
                      type="target"
                      id="in"
                      :position="Position.Left"
                      :class="[
                        'port-handle',
                        'handle--left',
                        draggingFrom?.side === 'source' && draggingFrom?.uid !== 'ghost-src'
                          ? 'handle--valid-target'
                          : 'handle--free',
                      ]"
                    />
                    <div class="ghost-label">
                      <i class="pi pi-plus"></i>
                      <span>Add Port</span>
                    </div>
                    <Handle
                      v-if="data.side === 'source'"
                      type="source"
                      id="out"
                      :position="Position.Right"
                      :class="[
                        'port-handle',
                        'handle--right',
                        draggingFrom?.side === 'target' && draggingFrom?.uid !== 'ghost-tgt'
                          ? 'handle--valid-target'
                          : 'handle--free',
                      ]"
                    />
                  </div>
                </template>
              </VueFlow>
            </Transition>
          </div>
        </div>
      </div>

      <!-- Legend -->
      <div class="bottom-bar">
        <div class="legend">
          <span class="legend-item"><span class="legend-dot dot-connected"></span>Connected</span>
          <span class="legend-item"><span class="legend-dot dot-taken"></span>Taken</span>
          <span class="legend-item"><span class="legend-dot dot-free"></span>Available</span>
          <MultiportKey />
        </div>
      </div>

      <!-- A pairing refused as it was dragged, until the next one -->
      <Message v-if="refusal" severity="warn" size="small" closable class="pairing-refusal" @close="refusal = null">
        {{ refusal }}
      </Message>

      <!-- What CA would pair otherwise with these couplings: none may be left to confirm them -->
      <div v-if="problems.length" class="coupling-problems" data-testid="coupling-problems">
        <Message v-for="(problem, i) in problems" :key="i" severity="error" size="small" class="coupling-problem">
          {{ problem.message }}
        </Message>
      </div>
    </div>

    <!-- Swap confirmation dialog -->
    <Dialog
      v-model:visible="swapDialog.visible"
      header="Port already connected"
      :style="{ width: '380px' }"
      :closable="false"
      :dismissableMask="false"
      :closeOnEscape="false"
      :modal="true"
      :appendTo="'self'"
    >
      <span>This port is already connected. What would you like to do?</span>
      <template #footer>
        <Button label="Cancel" severity="secondary" text @click="resolveSwap('cancel')" />
        <Button label="Replace" severity="secondary" @click="resolveSwap('overwrite')" />
        <Button v-if="swapDialog.canSwap" label="Swap" @click="resolveSwap('swap')" />
      </template>
    </Dialog>

    <template #footer>
      <div class="dialog-footer">
        <Button label="Cancel" severity="secondary" text @click="handleCancel" />
        <!-- A span carries the tooltip, as a disabled button shows none. -->
        <span v-tooltip.top="confirmBlocker ?? ''" class="confirm-wrap">
          <Button label="Done" :disabled="!!confirmBlocker" @click="handleConfirm" />
        </span>
      </div>
    </template>
  </Dialog>
</template>

<script setup>
import { ref, computed, watch, nextTick } from 'vue'
import { VueFlow, Position, Handle, useVueFlow } from '@vue-flow/core'
import Button from 'primevue/button'
import Dialog from 'primevue/dialog'
import Chip from 'primevue/chip'
import Message from 'primevue/message'
import { FLOW_IDS, ROW_H, NODE_W, PAD } from '../utils/constants'
import { isSingleConnection } from '../utils/edges'
import { isSuperInstance } from '../utils/hierarchy'
import { detachReactivity } from '../utils/reactivity'
import { waitUntilStable } from '../utils/layout'

import MultiportKey from './MultiportKey.vue'
import PortRow from './PortRow.vue'
import { useEdgeCouplings } from '../composables/useEdgeCouplings'
import { duplicateIndex, useExposedPortOwners } from '../composables/useExposure'
import { usePortDrag } from '../composables/usePortDrag'
import { useConnectionAutoscroll } from '../composables/useConnectionAutoscroll'

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  sourceNode: { type: Object, required: true },
  targetNode: { type: Object, required: true },
  activeEdge: { type: Object, required: true },
  subgraph: { type: Map, required: true },
})

const CANVAS_PAD_X = 14
const MID_GAP_PX = 60

const SIDE_CONFIG = {
  source: { prefix: 'src', x: CANVAS_PAD_X, nodeType: 'sourcePort' },
  target: { prefix: 'tgt', x: CANVAS_PAD_X + NODE_W + MID_GAP_PX, nodeType: 'targetPort' },
}

const emit = defineEmits(['update:modelValue', 'confirm'])
const canvasEl = ref(null)
const visible = computed({
  get: () => props.modelValue,
  set: (value) => emit('update:modelValue', value),
})

const isFlowReady = ref(false)

const { getViewport, setViewport, updateNodeInternals } = useVueFlow(FLOW_IDS.EDGE)

// The children a super instance's exposed ports are on, so two of the same name read apart; empty for a module.
const portOwnersOf = useExposedPortOwners(FLOW_IDS.MAIN)
const ownersOf = (node) => (isSuperInstance(node) ? portOwnersOf(node.data.smId) : new Map())
// A super instance's ports are what its super-module exposes, so no port is added on its side here.
const canAddPort = (side) => !isSuperInstance(side === 'source' ? props.sourceNode : props.targetNode)
const sourceOwners = computed(() => ownersOf(props.sourceNode))
const targetOwners = computed(() => ownersOf(props.targetNode))
// A super instance's exposed ports' indices among those sharing their label (see duplicateIndex).
const indicesOf = (node) => {
  const ports = isSuperInstance(node) ? (node.data.ports ?? []) : []
  const indices = duplicateIndex(ports)
  return new Map(ports.map((port, i) => [port.exposedPortId, indices[i]]))
}
const sourceIndices = computed(() => indicesOf(props.sourceNode))
const targetIndices = computed(() => indicesOf(props.targetNode))

const swapDialog = ref({ visible: false, resolve: null })

function askSwapIntent(canSwap = false) {
  return new Promise((resolve) => {
    swapDialog.value = { visible: true, resolve, canSwap }
  })
}

function resolveSwap(intent) {
  swapDialog.value.visible = false
  swapDialog.value.resolve?.(intent)
}

function onNodeClick({ node }) {
  if (node.type === 'ghostPort') {
    activateGhost(node.data.side)
  }
}

async function refreshNodeInternals() {
  await nextTick()
  const nodeIds = flowNodes.value.map((n) => n.id)
  if (nodeIds.length > 0) {
    updateNodeInternals(nodeIds)
  }
}

async function onDialogShow() {
  isFlowReady.value = false
  initLocalState()
  await waitUntilStable(canvasEl.value, 400)
  isFlowReady.value = true
  await nextTick()
  refreshNodeInternals()
}

const {
  localSrcPorts,
  localTgtPorts,
  localCouplings,
  localSubgraph,
  takenElsewhereUids,
  problems,
  refusal,
  portLookup,
  srcByUid,
  tgtByUid,
  connectedSrcUids,
  connectedTgtUids,
  initLocalState,
  evictHandle,
  swapConnections,
  connectPorts,
  connectRefusal,
  pendingCouplings,
  evaluateProblems,
  deletePort,
  activateGhost,
  onPortConfigChange,
} = useEdgeCouplings(props, askSwapIntent)

// Each local port's problems, shown on its row.
const problemsByUid = computed(() => {
  const byUid = new Map()
  for (const problem of problems.value) {
    for (const uid of problem.uids) byUid.set(uid, [...(byUid.get(uid) ?? []), problem.message])
  }
  return byUid
})
// The couplings a problem concerns, drawn as such.
const problemPairs = computed(() => new Set(problems.value.flatMap(({ pair }) => (pair ? [`${pair.srcUid}>${pair.tgtUid}`] : []))))
// Why Done is off: CA would pair these couplings otherwise.
const confirmBlocker = computed(() => {
  const count = problems.value.length
  if (!count) return null
  return count === 1
    ? `CA can't reproduce these couplings: ${problems.value[0].message}`
    : `CA can't reproduce these couplings: ${count} problems, listed above.`
})

const { dragState, dragOffsetY, startDrag, rowStyle } = usePortDrag(localSrcPorts, localTgtPorts, canvasEl)

const { draggingFrom, onConnectStart, onConnectEnd, onEdgeUpdateEnd, onEdgeUpdateStart } = useConnectionAutoscroll(
  canvasEl,
  getViewport,
  setViewport
)

const canvasHeight = computed(
  () => (Math.max(localSrcPorts.value.length, localTgtPorts.value.length, 4) + 1) * ROW_H + PAD * 2
)

const flowNodes = computed(() => {
  const srcNodes = buildPortNodes(localSrcPorts.value, connectedSrcUids.value, 'source')
  const tgtNodes = buildPortNodes(localTgtPorts.value, connectedTgtUids.value, 'target')

  const nodes = [...srcNodes, ...tgtNodes]

  ;['source', 'target'].filter(canAddPort).forEach((side) => {
    const config = SIDE_CONFIG[side]
    const ports = side === 'source' ? localSrcPorts.value : localTgtPorts.value
    nodes.push({
      id: `ghost-${config.prefix}`,
      type: 'ghostPort',
      position: { x: config.x, y: PAD + ports.length * ROW_H },
      data: { side },
    })
  })
  return nodes
})

const flowEdges = computed(() => {
  const edges = []

  for (const { srcUid, tgtUid } of localCouplings.value) {
    const sp = srcByUid(srcUid)
    const tp = tgtByUid(tgtUid)
    if (!sp || !tp) continue

    if (sp.label === tp.label) {
      const wrong = problemPairs.value.has(`${srcUid}>${tgtUid}`)
      edges.push({
        id: `ce-${srcUid}-${tgtUid}`,
        source: `src-${srcUid}`,
        target: `tgt-${tgtUid}`,
        sourceHandle: 'out',
        targetHandle: 'in',
        updatable: true,
        ...(wrong && { class: 'coupling--problem' }),
        style: {
          stroke: wrong ? 'var(--p-red-500, #ef4444)' : 'var(--p-primary-color, #409eff)',
          strokeWidth: 2.5,
          ...(wrong && { strokeDasharray: '6 4' }),
        },
      })
    }
  }
  return edges
})

function buildPortNodes(ports, connectedUids, side) {
  const config = SIDE_CONFIG[side]
  return ports.map((p, i) => ({
    id: `${config.prefix}-${p._uid}`,
    type: config.nodeType,
    position: { x: config.x, y: PAD + i * ROW_H },
    data: {
      port: p,
      isConnected: connectedUids.has(p._uid),
      isTakenElsewhere: takenElsewhereUids.value.has(p._uid),
    },
  }))
}

function isValidConnection(connection) {
  if (connection.source === 'ghost-src' && connection.target === 'ghost-tgt') return false
  if ((connection.source === 'ghost-src' && !canAddPort('source')) || (connection.target === 'ghost-tgt' && !canAddPort('target'))) return false
  if (connection.source === 'ghost-src' || connection.target === 'ghost-tgt') return true
  const sUid = (connection.source || '').replace('src-', '')
  const tUid = (connection.target || '').replace('tgt-', '')
  const sp = srcByUid(sUid)
  const tp = tgtByUid(tUid)
  if (!sp || !tp || !sp.label || !tp.label) return false
  // Any other rule refuses on the drop (see onConnect), so it can say why.
  return sp.label === tp.label
}

async function onConnect(connection) {
  const isGhostSrc = connection.source === 'ghost-src'
  const isGhostTgt = connection.target === 'ghost-tgt'

  if (isGhostSrc || isGhostTgt) {
    if (isGhostSrc) {
      const tUid = connection.target.replace('tgt-', '')
      const tp = tgtByUid(tUid)
      if (isSingleConnection(tp)) {
        let next = [...localCouplings.value]
        next = await evictHandle(tp, tUid, 'target', next)
        if (next === null) return
        localCouplings.value = next
      }
      activateGhost('source', tp)
      connection = { ...connection, source: `src-${localSrcPorts.value.at(-1)._uid}` }
    }
    if (isGhostTgt) {
      const sUid = connection.source.replace('src-', '')
      const sp = srcByUid(sUid)
      if (isSingleConnection(sp)) {
        let next = [...localCouplings.value]
        next = await evictHandle(sp, sUid, 'source', next)
        if (next === null) return
        localCouplings.value = next
      }
      activateGhost('target', sp)
      connection = { ...connection, target: `tgt-${localTgtPorts.value.at(-1)._uid}` }
    }
  }

  if (!isValidConnection(connection)) return

  const srcUid = (connection.source || '').replace('src-', '')
  const tgtUid = (connection.target || '').replace('tgt-', '')

  if (localCouplings.value.some((c) => c.srcUid === srcUid && c.tgtUid === tgtUid)) return

  // Refused before any port is evicted for it, with why.
  refusal.value = connectRefusal(srcUid, tgtUid)
  if (refusal.value) return

  const sp = srcByUid(srcUid)
  const tp = tgtByUid(tgtUid)

  let nextCouplings = [...localCouplings.value]

  nextCouplings = await evictHandle(tp, tgtUid, 'target', nextCouplings)
  if (nextCouplings === null) return
  nextCouplings = await evictHandle(sp, srcUid, 'source', nextCouplings)
  if (nextCouplings === null) return

  localCouplings.value = connectPorts(srcUid, tgtUid, nextCouplings)
}

async function onEdgeUpdate({ edge, connection }) {
  if (!connection?.source || !connection?.target) return
  if (!isValidConnection(connection)) return

  if (connection.source === 'ghost-src' || connection.target === 'ghost-tgt') {
    if (connection.source === 'ghost-src') {
      const tUid = connection.target.replace('tgt-', '')
      const tp = tgtByUid(tUid)
      if (isSingleConnection(tp)) {
        let next = localCouplings.value.filter(
          (c) => !(c.srcUid === edge.source.replace('src-', '') && c.tgtUid === edge.target.replace('tgt-', ''))
        )
        next = await evictHandle(tp, tUid, 'target', next)
        if (next === null) return
        localCouplings.value = next
      }
      activateGhost('source', tp)
      connection = { ...connection, source: `src-${localSrcPorts.value.at(-1)._uid}` }
    }
    if (connection.target === 'ghost-tgt') {
      const sUid = connection.source.replace('src-', '')
      const sp = srcByUid(sUid)
      if (isSingleConnection(sp)) {
        let next = localCouplings.value.filter(
          (c) => !(c.srcUid === edge.source.replace('src-', '') && c.tgtUid === edge.target.replace('tgt-', ''))
        )
        next = await evictHandle(sp, sUid, 'source', next)
        if (next === null) return
        localCouplings.value = next
      }
      activateGhost('target', sp)
      connection = { ...connection, target: `tgt-${localTgtPorts.value.at(-1)._uid}` }
    }
  }

  const newSrcUid = connection.source.replace('src-', '')
  const newTgtUid = connection.target.replace('tgt-', '')
  const oldSrcUid = edge.source.replace('src-', '')
  const oldTgtUid = edge.target.replace('tgt-', '')

  if (newSrcUid === oldSrcUid && newTgtUid === oldTgtUid) return

  const sp = srcByUid(newSrcUid)
  const tp = tgtByUid(newTgtUid)
  if (!sp || !tp) return

  let nextCouplings = localCouplings.value.filter((c) => !(c.srcUid === oldSrcUid && c.tgtUid === oldTgtUid))

  const isDuplicate = nextCouplings.some((c) => c.srcUid === newSrcUid && c.tgtUid === newTgtUid)

  if (isDuplicate && !isSingleConnection(tp) && !isSingleConnection(sp)) {
    return
  }

  refusal.value = connectRefusal(newSrcUid, newTgtUid, { srcUid: oldSrcUid, tgtUid: oldTgtUid })
  if (refusal.value) return

  nextCouplings = await swapConnections(tp, oldTgtUid, newTgtUid, 'target', nextCouplings)
  if (nextCouplings === null) return
  nextCouplings = await swapConnections(sp, oldSrcUid, newSrcUid, 'source', nextCouplings)
  if (nextCouplings === null) return

  nextCouplings = connectPorts(newSrcUid, newTgtUid, nextCouplings)
  localCouplings.value = nextCouplings
}

const validConnectUids = computed(() => {
  if (!draggingFrom.value) return new Set()
  const { uid, side } = draggingFrom.value
  const isGhost = uid === 'ghost-src' || uid === 'ghost-tgt'
  const candidates = side === 'source' ? localTgtPorts.value : localSrcPorts.value
  if (isGhost) return new Set(candidates.map((p) => p._uid))
  const port = portLookup.value.get(uid)?.port
  if (!port) return new Set()
  return new Set(
    candidates
      .filter((p) => {
        if (!p.label || !port.label || p.label !== port.label) return false
        const [srcUid, tgtUid] = side === 'source' ? [uid, p._uid] : [p._uid, uid]
        return !connectRefusal(srcUid, tgtUid)
      })
      .map((p) => p._uid)
  )
})

function onCanvasWheel(event) {
  if (draggingFrom.value) return
  canvasEl.value.scrollTop += event.deltaY
}

function buildPayload() {
  const foreignCouplings = {}
  const activeEdgeId = props.activeEdge?.id

  for (const [edgeId, localEdge] of localSubgraph.value) {
    if (edgeId === activeEdgeId) continue
    const originalCouplings = props.subgraph?.get(edgeId)?.data?.couplings || []
    const localCouplingsArr = localEdge?.data?.couplings || []
    if (JSON.stringify(originalCouplings) !== JSON.stringify(localCouplingsArr)) {
      foreignCouplings[edgeId] = localCouplingsArr
    }
  }

  return {
    sourceNodeId: props.sourceNode.id,
    targetNodeId: props.targetNode.id,
    sourcePorts: detachReactivity(localSrcPorts.value),
    targetPorts: detachReactivity(localTgtPorts.value),
    couplings: pendingCouplings(),
    foreignCouplings,
  }
}

function handleConfirm() {
  // Checked now, as an edit's check may be waiting.
  evaluateProblems()
  if (problems.value.length) return
  emit('confirm', buildPayload())
  emit('update:modelValue', false)
}

function handleCancel() {
  isFlowReady.value = false
  emit('update:modelValue', false)
}

function onClosed() {
isFlowReady.value = false
  emit('update:modelValue', false)
}

watch(dragOffsetY, () => {
  if (dragState.value.active) {
    refreshNodeInternals()
  }
})

watch(
  () => dragState.value.active,
  async (active) => {
    if (!active) {
      await nextTick()
      refreshNodeInternals()
    }
  }
)

watch(
  () => props.modelValue,
  (v) => {
    if (v) {
      initLocalState()
    }
  }
)

watch(
  flowNodes,
  () => {
    refreshNodeInternals()
  },
  { deep: true, flush: 'post' }
)
</script>

<style scoped>

/* ── Loading Overlay ── */
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
  font-size: 13px;
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

/* ── Dialog header ── */
.dialog-header {
  width: 100%;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 4px;
}
.dialog-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 17px;
  font-weight: 700;
  color: var(--p-text-color, #ffffff);
  letter-spacing: -0.3px;
}
.title-icon {
  font-size: 20px;
  color: var(--p-warn-color, #e6a23c);
}
.node-names {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  margin-left: auto;
}
.arrow-sep {
  color: var(--p-text-muted-color, #909399);
  font-size: 16px;
}

/* ── Root layout ── */
.root {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.connections-layout {
  width: 1148px;
  margin: 0 auto;
}

/* ── Column headers ── */
.col-headers {
  display: flex;
  align-items: flex-start;
  width: 100%;
  padding: 0 14px;
  box-sizing: border-box;
}

.col-header-label {
  display: flex;
  flex-direction: column;
  gap: 4px;
  width: 520px;
}

.mid-spacer {
  width: 60px;
  min-width: 60px;
}

.side-label {
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 1.5px;
  color: var(--p-text-muted-color, #909399);
  padding-left: 2px;
  text-transform: uppercase;
}

.target-side .side-label {
  padding-left: 22px; /* Offsets "TARGET" label to match the 20px subheader shift */
}

.col-subheaders {
  display: grid;
  gap: 6px;
  padding: 6px 8px;
  background: color-mix(in srgb, var(--p-text-color, #fff) 4%, var(--p-content-background, #18181b));
  border: 1px solid var(--p-content-border-color, #27272a);
  border-radius: 4px 4px 0 0;
  font-size: 11px;
  font-weight: 700;
  color: var(--p-text-muted-color, #909399);
  letter-spacing: 0.3px;
  box-sizing: border-box;
  align-items: center;
}

/* Source side header grid */
.source-side .col-subheaders {
  grid-template-columns: 60px minmax(0, 1fr) 56px minmax(0, 1.6fr) 16px 28px;
}

/* Target side header grid + 20px offset */
.target-side .col-subheaders {
  grid-template-columns: 16px 28px 60px minmax(0, 1fr) 56px minmax(0, 1.6fr);
  transform: translateX(20px); 
}

/* ── Canvas ── */
.flow-canvas {
  width: 1148px;
  border: 1px solid var(--p-content-border-color, #27272a);
  border-radius: 0 0 4px 4px;
  background: color-mix(in srgb, var(--p-text-color, #fff) 2%, var(--p-content-background, #18181b));
  max-height: 65vh;
  overflow-y: auto;
  overflow-x: hidden !important;
  box-sizing: border-box;
}

/* ── Ghost Node Styling ── */
.ghost-node {
  width: 520px !important;
  height: 44px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1.5px dashed var(--p-content-border-color, #3f3f46);
  border-radius: 4px;
  background: transparent;
  cursor: pointer;
  position: relative;
  box-sizing: border-box !important;
  transition: border-color 0.15s, background 0.15s;
}

.ghost-node:hover {
  border-color: var(--p-primary-color, #409eff);
  background: color-mix(in srgb, var(--p-primary-color, #409eff) 12%, transparent);
}

.ghost-label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--p-text-muted-color, #a1a1aa);
  user-select: none;
}

.ghost-node:hover .ghost-label {
  color: var(--p-primary-color, #409eff);
}

/* ── Vue Flow Node Wrapper Lock ── */
:deep(.vue-flow__node) {
  width: 520px !important;
  box-sizing: border-box !important;
}

/* ── Global Handle Styles ── */
:deep(.port-handle) {
  width: 11px;
  height: 11px;
  border-radius: 50%;
  border: 2px solid var(--p-content-background, #18181b);
  position: absolute !important;
  top: 50% !important;
  z-index: 10;
}

:deep(.handle--left),
:deep(.vue-flow__handle-left) {
  left: 0 !important;
  transform: translate(-50%, -50%) !important;
}

:deep(.handle--right),
:deep(.vue-flow__handle-right) {
  right: 0 !important;
  transform: translate(50%, -50%) !important;
}

:deep(.handle--valid-target) {
  background: var(--p-green-500, #67c23a) !important;
  box-shadow: 0 0 0 3px rgba(103, 194, 58, 0.35);
}

:deep(.handle--free) {
  background: var(--p-text-muted-color, #71717a);
}

/* ── Bottom bar ── */
.bottom-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 4px 0;
}
.legend {
  display: flex;
  gap: 16px;
  align-items: center;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--p-text-muted-color, #a1a1aa);
}
.legend-dot {
  width: 9px;
  height: 9px;
  border-radius: 50%;
  display: inline-block;
}
.dot-connected {
  background: var(--p-primary-color, #409eff);
}
.dot-taken {
  background: var(--p-warn-color, #e6a23c);
  border: 1px dashed var(--p-warn-color, #e6a23c);
}
.dot-free {
  background: var(--p-text-muted-color, #71717a);
}

/* ── Problems ── */
.coupling-problems {
  display: flex;
  flex-direction: column;
  gap: 4px;
  max-height: 120px;
  overflow-y: auto;
}

/* ── Footer ── */
.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
.confirm-wrap {
  display: inline-flex;
}
</style>
