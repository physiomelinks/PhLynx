<template>
  <!-- One root, so the class the workspace gives it (its place over the diagram) lands -->
  <div
    :class="['bio-flow-root', { 'bio-flow-root--dragging': draggingId }]"
    @dragover="onModuleDragOver"
    @dragleave="onModuleDragLeave"
    @drop="onModuleDrop"
  >
    <VueFlow
      :id="FLOW_IDS.BIO"
      :nodes="bioNodes"
      :edges="shownCouplings"
      class="bio-flow"
      :max-zoom="1.5"
      :min-zoom="0.1"
      :delete-key-code="null"
      :elevate-nodes-on-select="false"
      :nodes-connectable="false"
      :apply-default="false"
      @nodes-change="onNodesChange"
      @node-drag-stop="onNodeDragStop"
      @node-double-click="onNodeDoubleClick"
      @node-context-menu="onNodeContextMenu"
      @pane-context-menu="onPaneContextMenu"
      @nodes-initialized="onNodesInitialized"
    >
      <Background :size="2" :gap="20" />
      <MiniMap :pannable="true" :zoomable="true" class="mini-map" />
      <Controls>
        <ControlButton
          title="Export image of the physiological view"
          @click="emit('export-image', { root: vueFlowRef, viewport })"
        >
          <i class="pi pi-image"></i>
        </ControlButton>
      </Controls>
      <!-- While a protein is dragged: where it can go in each membrane -->
      <template #zoom-pane>
        <svg v-if="slotPrompts.length" class="bio-slot-prompts" data-testid="bio-slot-prompts">
          <rect
            v-for="prompt in slotPrompts"
            :key="prompt.key"
            :class="['bio-slot-prompt', { 'bio-slot-prompt--active': prompt.active }]"
            :x="prompt.x - GLYPH_WIDTH / 2"
            :y="prompt.y - GLYPH_HEIGHT / 2"
            :width="GLYPH_WIDTH"
            :height="GLYPH_HEIGHT"
            rx="14"
          />
        </svg>
      </template>
      <template #edge-bioCoupling="props">
        <BioCouplingEdge v-bind="props" />
      </template>
      <template #node-bioCell="props">
        <BioCell :data="props.data" :selected="props.selected" :width="props.data.width" :height="props.data.height" />
      </template>
      <template #node-bioRegion="props">
        <BioRegion :data="props.data" :selected="props.selected" />
      </template>
      <template #node-bioProtein="props">
        <BioProtein :data="props.data" :selected="props.selected" />
      </template>
      <template #node-bioCard="props">
        <BioCard :data="props.data" :selected="props.selected" />
      </template>
    </VueFlow>
    <ContextMenu ref="contextMenu" :model="menuItems" />
    <BioPlaceDialog
      v-if="placing"
      :mode="placing.mode"
      :name="placing.name"
      :initial-role="placing.initialRole"
      :cells="cellChoices"
      @confirm="onPlaceConfirm"
      @cancel="placing = null"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { ControlButton, Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import ContextMenu from 'primevue/contextmenu'
import BioCard from './BioCard.vue'
import BioCell from './BioCell.vue'
import BioCouplingEdge from './BioCouplingEdge.vue'
import BioProtein from './BioProtein.vue'
import BioRegion from './BioRegion.vue'
import { bioViewForMove, useBioNodes } from '../../composables/useBioNodes'
import { useNodeDataHistory } from '../../composables/useNodeDataHistory'
import { dropTargets, patchBioView, planRelayout, planSlotDrop, planUnplace } from '../../services/bioView/drop'
import { GLYPHS } from '../../services/bioView/glyphs'
import {
  FACET_PARTS,
  GLYPH_HEIGHT,
  GLYPH_WIDTH,
  MIN_CELL,
  nearestSlot,
  partOf,
  slotPositions,
} from '../../services/bioView/geometry'
import { CARD, GAP, REGION_HEIGHT } from '../../services/bioView/layout'
import BioPlaceDialog from './BioPlaceDialog.vue'
import useDragAndDrop from '../../composables/useDnD'
import { useFlowHistoryStore } from '../../stores/historyStore'
import { useLibraryStore } from '../../stores/libraryStore'
import { useViewModeStore } from '../../stores/viewModeStore'
import { FLOW_IDS } from '../../utils/constants'

const props = defineProps({
  /** Adds an instance of a library module with this bioView, and gives its node id (see WorkspaceArea). */
  createInstance: { type: Function, default: null },
})

const emit = defineEmits(['open-instance-editor', 'export-image'])

/** How the role choices read in the menu. */
const ROLE_LABELS = {
  membraneProtein: 'Membrane protein',
  membrane: 'Membrane',
  cytosol: 'Cell',
  cytosolic: 'Process in a cell',
  region: 'Region outside cells',
  none: 'Card',
}

/** How near, in flow units, a dragged protein's centre must come to a slot to snap to it. */
const SNAP_DISTANCE = 60

// The diagram's flow is the one source of truth: selection and edits go there, and this view follows.
// Only this component, outside the bio <VueFlow>, reaches the main flow, so its nodes' handles never do.
const main = useVueFlow(FLOW_IDS.MAIN)
const { recordEdit } = useNodeDataHistory(FLOW_IDS.MAIN)
// The library's drag state; called before the bio flow's store, as it reaches for the main one.
const libraryDrag = useDragAndDrop()
const history = useFlowHistoryStore()
const libraryStore = useLibraryStore()
const {
  applyNodeChanges,
  findNode,
  fitView,
  screenToFlowCoordinate,
  setViewport,
  updateNodeInternals,
  viewport,
  vueFlowRef,
} = useVueFlow(FLOW_IDS.BIO)
const viewMode = useViewModeStore()
const { bioNodes, couplingEdges, layout, roles, loadSidecars } = useBioNodes(main.nodes, main.edges)

onMounted(() => loadSidecars())

// vue-flow measures a node's handles when they mount, so a node whose handles change (a selection's
// couplings come and go) is measured again, or its lines would keep to the old points.
const handlesOf = computed(
  () => new Map(bioNodes.value.map((node) => [node.id, JSON.stringify(node.data.handles ?? [])]))
)
watch(handlesOf, async (now, before) => {
  const changed = [...now].filter(([id, handles]) => before?.get(id) !== handles).map(([id]) => id)
  if (!changed.length) return
  await nextTick()
  updateNodeInternals(changed)
})
onBeforeUnmount(() => (viewMode.bioViewport = { ...viewport.value }))

function onNodesInitialized() {
  if (viewMode.bioViewport) setViewport(viewMode.bioViewport)
  else fitView({ padding: 0.15 })
}

// ── Dragging into a membrane ───────────────────────────────────────────
const draggingId = ref(null)
// A selection's coupling lines end where things were laid out, so they wait for a drag to end.
const shownCouplings = computed(() => (draggingId.value ? [] : couplingEdges.value))
const activeSlot = ref(null)
const targets = computed(() => dropTargets(layout.value))

const slotPrompts = computed(() => {
  if (!draggingId.value) return []
  return targets.value.flatMap((cell) =>
    FACET_PARTS.flatMap((part) =>
      slotPositions(cell.rect, part, cell.counts[part] + 1).map((slot, order) => ({
        key: `${cell.id}/${part}/${order}`,
        x: slot.x,
        y: slot.y,
        active:
          activeSlot.value?.cellId === cell.id && activeSlot.value.part === part && activeSlot.value.order === order,
      }))
    )
  )
})

/** Where a node's parent sits, so a child's position can be made absolute and back. */
function parentOffset(node) {
  const parent = node?.parentNode ? findNode(node.parentNode) : null
  return parent ? parent.computedPosition : { x: 0, y: 0 }
}

/** Snaps a dragged protein's position to the nearest slot, and remembers the slot for the drop. */
function snapToSlot(change) {
  const node = findNode(change.id)
  if (!node?.data?.droppable) return
  draggingId.value = change.id
  const offset = parentOffset(node)
  const { width, height } = node.dimensions
  const centre = {
    x: offset.x + change.position.x + width / 2,
    y: offset.y + change.position.y + height / 2,
  }
  const slot = nearestSlot(targets.value, centre, SNAP_DISTANCE)
  activeSlot.value = slot
  if (slot)
    change.position = {
      x: slot.x - width / 2 - offset.x,
      y: slot.y - height / 2 - offset.y,
    }
}

function onNodesChange(changes) {
  for (const change of changes) {
    if (change.type === 'select') {
      const node = main.findNode(change.id)
      if (node) node.selected = change.selected
    } else if (change.type === 'position' && change.position && change.dragging) {
      snapToSlot(change)
    }
  }
  applyNodeChanges(changes)
}

const bioViews = () => new Map(main.nodes.value.map((node) => [node.id, node.data?.bioView]))

/** Writes new bioViews as one undo step in the diagram's history; undefined removes one. */
function applyPlan(plan, type = 'bio-layout') {
  const ids = [...plan.keys()].filter((id) => main.findNode(id))
  if (!ids.length) return Promise.resolve(false)
  return recordEdit({
    type,
    nodeIds: ids,
    keys: ['bioView'],
    apply: () =>
      ids.forEach((id) => {
        const node = main.findNode(id)
        const { bioView, ...rest } = node.data
        const next = plan.get(id)
        main.updateNodeData(id, next === undefined ? rest : { ...rest, bioView: next }, { replace: true })
      }),
  })
}

/** Keeps dragged nodes where they were put: in a membrane slot, out of one, or just moved. */
function onNodeDragStop({ nodes }) {
  const slot = activeSlot.value
  const dropped = draggingId.value
  draggingId.value = null
  activeSlot.value = null

  const plan = new Map()
  const add = (entries) => entries.forEach((bioView, id) => plan.set(id, bioView))
  for (const moved of nodes) {
    const node = findNode(moved.id) ?? moved
    const at = node.computedPosition ?? node.position
    if (moved.id === dropped && slot) {
      add(
        planSlotDrop({
          id: moved.id,
          slot,
          layout: layout.value,
          roles: roles.value,
          bioViews: bioViews(),
        })
      )
    } else if (layout.value.get(moved.id)?.kind === 'protein') {
      add(
        planUnplace({
          id: moved.id,
          position: { x: at.x, y: at.y },
          layout: layout.value,
          bioViews: bioViews(),
        })
      )
    } else {
      plan.set(moved.id, {
        ...main.findNode(moved.id)?.data?.bioView,
        ...bioViewForMove(node, at),
      })
    }
  }
  applyPlan(plan)
}

function onNodeDoubleClick({ node }) {
  const instance = main.findNode(node.id)
  if (!instance) return
  const { name, mathRef, variables, ports, handles } = instance.data
  emit('open-instance-editor', {
    id: instance.id,
    name,
    mathRef,
    variables,
    ports,
    handles,
    defaultTab: 'parameters',
  })
}

// ── Menus ──────────────────────────────────────────────────────────────
const contextMenu = ref(null)
const menuItems = ref([])

/** Sets some of a node's bioView fields, as one undo step. */
function setChoice(id, patch, type) {
  return applyPlan(new Map([[id, patchBioView(main.findNode(id)?.data?.bioView, patch)]]), type)
}

/** Somewhere left of the cells, below any proteins already there, for one taken out of its membrane. */
function trayPosition() {
  const cells = targets.value.map((cell) => cell.rect)
  const left = cells.length ? Math.min(...cells.map((rect) => rect.x)) : 0
  const top = cells.length ? Math.min(...cells.map((rect) => rect.y)) : 0
  const loose = [...layout.value.values()].filter((place) => place.kind === 'tray').length
  return {
    x: left - 2 * GAP - GLYPH_WIDTH,
    y: top + loose * (GLYPH_HEIGHT + 32),
  }
}

/** Where a region can lie: against each cell's top or bottom, or down either of its sides. */
const AGAINST = [
  { facet: 'apical', label: 'Apical side' },
  { facet: 'basolateral', label: 'Basolateral side' },
  { facet: 'lateral', at: 'left', label: 'Left side (paracellular)' },
  { facet: 'lateral', at: 'right', label: 'Right side (paracellular)' },
]

/** The menu choosing what a region lies against, one part of one cell at a time. */
function liesAgainstMenu(id, role) {
  const current = role.adjacent?.[0]
  const cells = targets.value.map((cell) => cell.id)
  const name = (cellId) => main.findNode(cellId)?.data?.name ?? cellId
  const isCurrent = (cellId, choice) =>
    current?.cell === cellId && current.facet === choice.facet && (current.at ?? undefined) === choice.at
  return {
    label: 'Lies Against',
    icon: 'pi pi-arrows-h',
    disabled: !cells.length,
    items: cells.flatMap((cellId) =>
      AGAINST.map(({ label, ...against }) => ({
        label: cells.length > 1 ? `${name(cellId)}: ${label}` : label,
        icon: isCurrent(cellId, against) ? 'pi pi-check' : undefined,
        // A new place for the region clears where it was dragged to.
        command: () => setChoice(id, { adjacent: [{ cell: cellId, ...against }], rect: undefined }, 'bio-adjacent'),
      }))
    ),
  }
}

function onNodeContextMenu({ event, node }) {
  event.preventDefault()
  const role = roles.value.get(node.id)
  const items = [
    {
      label: 'Show As',
      icon: 'pi pi-sitemap',
      items: Object.entries(ROLE_LABELS).map(([value, label]) => ({
        label,
        icon: role?.role === value ? 'pi pi-check' : undefined,
        command: () => setChoice(node.id, { role: value }, 'bio-role'),
      })),
    },
  ]
  if (role?.role === 'membraneProtein') {
    items.push({
      label: 'Cartoon',
      icon: 'pi pi-palette',
      items: GLYPHS.map((glyph) => ({
        label: glyph[0].toUpperCase() + glyph.slice(1),
        icon: role.glyph === glyph ? 'pi pi-check' : undefined,
        command: () => setChoice(node.id, { glyph }, 'bio-glyph'),
      })),
    })
  }
  if (role?.role === 'region') items.push(liesAgainstMenu(node.id, role))
  if (layout.value.get(node.id)?.kind === 'protein') {
    items.push({
      label: 'Take Out of Membrane',
      icon: 'pi pi-sign-out',
      command: () =>
        applyPlan(
          planUnplace({
            id: node.id,
            position: trayPosition(),
            layout: layout.value,
            bioViews: bioViews(),
          })
        ),
    })
  }
  if (main.findNode(node.id)?.data?.bioView) {
    items.push(
      { separator: true },
      {
        label: 'Reset to Annotations',
        icon: 'pi pi-replay',
        command: () => applyPlan(new Map([[node.id, undefined]]), 'bio-reset'),
      }
    )
  }
  menuItems.value = items
  contextMenu.value.show(event)
}

function onPaneContextMenu(event) {
  event.preventDefault()
  const at = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
  menuItems.value = [
    ...(props.createInstance
      ? [
          { label: 'Add Cell…', icon: 'pi pi-circle', command: () => (placing.value = { mode: 'cell', at }) },
          {
            label: 'Add Compartment…',
            icon: 'pi pi-stop',
            command: () => (placing.value = { mode: 'compartment', at }),
          },
          { separator: true },
        ]
      : []),
    {
      label: 'Re-layout Physiology',
      icon: 'pi pi-th-large',
      command: () => applyPlan(planRelayout(bioViews()), 'bio-relayout'),
    },
  ]
  contextMenu.value.show(event)
}

// ── Adding instances ───────────────────────────────────────────────────
/** The open placing dialog: { mode, at, id?, name?, initialRole? }. */
const placing = ref(null)
const cellChoices = computed(() =>
  targets.value.map((cell) => ({ id: cell.id, name: main.findNode(cell.id)?.data?.name ?? cell.id }))
)

/** Puts a new protein in a slot, moving the proteins after it along, as part of the current step. */
function slotPlan(id, slot) {
  return planSlotDrop({ id, slot, layout: layout.value, roles: roles.value, bioViews: bioViews() })
}

/** The slot at the end of a part of a cell's membrane. */
function endSlot({ cell, facet, at }) {
  const part = partOf(facet, at)
  const count = targets.value.find((target) => target.id === cell)?.counts[part] ?? 0
  return { cellId: cell, part, facet, at: facet === 'lateral' ? at : undefined, order: count }
}

/**
 * Whether a drag is a module from the library: its data says so and it carries no files. The library's
 * drag state alone can be left over from a drag that was cancelled.
 */
function isLibraryDrag(event) {
  const types = [...(event.dataTransfer?.types ?? [])]
  return !!libraryDrag.draggedType.value && types.includes('application/vueflow') && !types.includes('Files')
}

function onModuleDragOver(event) {
  if (!isLibraryDrag(event)) return
  event.preventDefault()
  const point = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
  draggingId.value = 'library'
  activeSlot.value = nearestSlot(targets.value, point, SNAP_DISTANCE)
}

function onModuleDragLeave(event) {
  if (event.currentTarget.contains(event.relatedTarget)) return
  if (draggingId.value === 'library') draggingId.value = activeSlot.value = null
}

/**
 * Adds a library module dropped here: into the membrane slot it was dropped on, as one step, or where
 * it was dropped, asking what it is. Files dropped here go on to the workspace.
 */
async function onModuleDrop(event) {
  const module = libraryDrag.draggedType.value
  if (!isLibraryDrag(event) || !props.createInstance) return
  event.preventDefault()
  event.stopPropagation()
  // The library's own end-of-drag listener is on the document, which this drop doesn't reach.
  libraryDrag.draggedType.value = null
  libraryDrag.isDragging.value = false
  libraryDrag.isDragOver.value = false
  const point = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
  const slot = nearestSlot(targets.value, point, SNAP_DISTANCE)
  draggingId.value = activeSlot.value = null

  if (slot) {
    history.startBatch()
    try {
      // Made outside any membrane first, so the slot is planned against the membranes as they were drawn.
      const id = props.createInstance(module, { role: 'membraneProtein', facet: null })
      await applyPlan(slotPlan(id, slot), 'bio-add')
    } finally {
      history.endBatch()
    }
    return
  }
  const position = { x: point.x - CARD.width / 2, y: point.y - CARD.height / 2 }
  const id = props.createInstance(module, { position })
  // Its module's annotations say what it most likely is, once read.
  await libraryStore.ensureModuleAnnotations(module.mathRef)
  await nextTick()
  placing.value = {
    mode: 'assign',
    id,
    at: point,
    name: main.findNode(id)?.data?.name ?? id,
    initialRole: roles.value.get(id)?.role ?? 'none',
  }
}

/** Applies the placing dialog: what a dropped instance is, or a new cell or compartment. */
async function onPlaceConfirm({ role, moduleRef, membraneRef, cell, placement }) {
  const { mode, id, at } = placing.value
  placing.value = null
  const cellRect = { x: at.x - MIN_CELL.width / 2, y: at.y - MIN_CELL.height / 2, ...MIN_CELL }
  const regionRect = { x: at.x - 160, y: at.y - REGION_HEIGHT / 2, width: 320, height: REGION_HEIGHT }

  if (mode === 'cell') {
    history.startBatch()
    try {
      const cellId = props.createInstance(libraryStore.availableModules.get(moduleRef), {
        role: 'cytosol',
        rect: cellRect,
        added: true,
      })
      if (membraneRef)
        props.createInstance(libraryStore.availableModules.get(membraneRef), { role: 'membrane', cell: cellId })
    } finally {
      history.endBatch()
    }
    return
  }
  if (mode === 'compartment') {
    props.createInstance(
      libraryStore.availableModules.get(moduleRef),
      placement ? { role: 'region', adjacent: [placement] } : { role: 'region', rect: regionRect }
    )
    return
  }

  // What a dropped instance is.
  if (role === 'membraneProtein' && placement) return applyPlan(slotPlan(id, endSlot(placement)), 'bio-role')
  const patches = {
    membraneProtein: { role, facet: null },
    cytosol: { role, rect: cellRect, position: undefined, added: true },
    membrane: { role, cell },
    cytosolic: { role, cell, position: undefined },
    region: placement
      ? { role, adjacent: [placement], position: undefined }
      : { role, rect: regionRect, position: undefined },
    none: { role },
  }
  return setChoice(id, patches[role], 'bio-role')
}
</script>

<style scoped>
.bio-flow-root,
.bio-flow {
  width: 100%;
  height: 100%;
}

/* The selection's coupling lines are hidden while dragging, and so are their ends. */
.bio-flow-root--dragging :deep(.bio-handle) {
  visibility: hidden;
}

.bio-slot-prompts {
  position: absolute;
  overflow: visible;
  pointer-events: none;
}

.bio-slot-prompt {
  fill: color-mix(in srgb, var(--p-primary-color) 8%, transparent);
  stroke: var(--p-primary-color);
  stroke-width: 2;
  stroke-dasharray: 6 4;
  opacity: 0.6;
}

.bio-slot-prompt--active {
  fill: color-mix(in srgb, var(--p-primary-color) 25%, transparent);
  opacity: 1;
}
</style>
