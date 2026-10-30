<template>
  <!-- One root, so the class the workspace gives it (its place over the diagram) lands -->
  <div class="bio-flow-root">
    <VueFlow
      :id="FLOW_IDS.BIO"
      :nodes="bioNodes"
      :edges="[]"
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
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { ControlButton, Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import ContextMenu from 'primevue/contextmenu'
import BioCard from './BioCard.vue'
import BioCell from './BioCell.vue'
import BioProtein from './BioProtein.vue'
import BioRegion from './BioRegion.vue'
import { bioViewForMove, useBioNodes } from '../../composables/useBioNodes'
import { useNodeDataHistory } from '../../composables/useNodeDataHistory'
import { dropTargets, patchBioView, planRelayout, planSlotDrop, planUnplace } from '../../services/bioView/drop'
import { GLYPHS } from '../../services/bioView/glyphs'
import { FACET_PARTS, GLYPH_HEIGHT, GLYPH_WIDTH, nearestSlot, slotPositions } from '../../services/bioView/geometry'
import { GAP } from '../../services/bioView/layout'
import { useViewModeStore } from '../../stores/viewModeStore'
import { FLOW_IDS } from '../../utils/constants'

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
const { applyNodeChanges, findNode, fitView, setViewport, viewport, vueFlowRef } = useVueFlow(FLOW_IDS.BIO)
const viewMode = useViewModeStore()
const { bioNodes, layout, roles, loadSidecars } = useBioNodes(main.nodes)

onMounted(() => loadSidecars())
onBeforeUnmount(() => (viewMode.bioViewport = { ...viewport.value }))

function onNodesInitialized() {
  if (viewMode.bioViewport) setViewport(viewMode.bioViewport)
  else fitView({ padding: 0.15 })
}

// ── Dragging into a membrane ───────────────────────────────────────────
const draggingId = ref(null)
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
  if (!ids.length) return
  recordEdit({
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
  applyPlan(new Map([[id, patchBioView(main.findNode(id)?.data?.bioView, patch)]]), type)
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
  menuItems.value = [
    {
      label: 'Re-layout Physiology',
      icon: 'pi pi-th-large',
      command: () => applyPlan(planRelayout(bioViews()), 'bio-relayout'),
    },
  ]
  contextMenu.value.show(event)
}
</script>

<style scoped>
.bio-flow-root,
.bio-flow {
  width: 100%;
  height: 100%;
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
