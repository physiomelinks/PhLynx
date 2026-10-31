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
      @pane-ready="onPaneReady"
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
      <!-- While something is dragged: the membrane slots and template sites it can go to -->
      <template #zoom-pane>
        <svg
          v-if="sitePrompts.slots.length || sitePrompts.areas.length"
          class="bio-slot-prompts"
          data-testid="bio-slot-prompts"
        >
          <g
            v-for="prompt in sitePrompts.areas"
            :key="prompt.key"
            :class="['bio-site-prompt', `bio-site-prompt--${prompt.area}`, { 'bio-site-prompt--active': prompt.active }]"
            data-testid="bio-site-prompt"
            :data-site="prompt.ref"
          >
            <rect v-bind="prompt.rect" :rx="prompt.area === 'membrane' ? 14 : 10" />
            <text :x="prompt.text.x" :y="prompt.text.y" :text-anchor="prompt.text.anchor">
              {{ prompt.label }}
              <tspan v-if="prompt.replace" :x="prompt.text.x" dy="15" class="bio-site-prompt__replace">
                Replace {{ prompt.replace }}
              </tspan>
            </text>
          </g>
          <rect
            v-for="prompt in sitePrompts.slots"
            :key="prompt.key"
            :class="['bio-slot-prompt', { 'bio-slot-prompt--active': prompt.active }]"
            :data-site="prompt.ref"
            :x="prompt.x - prompt.width / 2"
            :y="prompt.y - prompt.height / 2"
            :width="prompt.width"
            :height="prompt.height"
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
      <template #node-bioTemplateTitle="props">
        <BioTemplateTitle :data="props.data" />
      </template>
    </VueFlow>
    <ContextMenu ref="contextMenu" :model="menuItems" />
    <Dialog
      v-if="renaming"
      :visible="true"
      modal
      header="Rename Template"
      :style="{ width: '360px' }"
      class="compact-dialog"
      data-testid="bio-template-rename"
      @update:visible="(visible) => !visible && (renaming = null)"
    >
      <InputText
        v-model="renaming.label"
        class="w-full"
        autofocus
        :placeholder="renaming.placeholder"
        data-testid="bio-template-rename-input"
        @keydown.enter="onRenameConfirm"
      />
      <template #footer>
        <Button label="Cancel" severity="secondary" text @click="renaming = null" />
        <Button label="Rename" data-testid="bio-template-rename-confirm" @click="onRenameConfirm" />
      </template>
    </Dialog>
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
import Button from 'primevue/button'
import ContextMenu from 'primevue/contextmenu'
import Dialog from 'primevue/dialog'
import InputText from 'primevue/inputtext'
import BioCard from './BioCard.vue'
import BioCell from './BioCell.vue'
import BioCouplingEdge from './BioCouplingEdge.vue'
import BioProtein from './BioProtein.vue'
import BioRegion from './BioRegion.vue'
import BioTemplateTitle from './BioTemplateTitle.vue'
import { bioViewForMove, useBioNodes } from '../../composables/useBioNodes'
import { useBioEdits } from '../../composables/useBioEdits'
import {
  dropSites,
  dropTargets,
  nearestSite,
  patchBioView,
  planRelayout,
  planSiteBind,
  planSlotDrop,
  planUnbind,
  planUnplace,
} from '../../services/bioView/drop'
import { GLYPHS } from '../../services/bioView/glyphs'
import {
  GLYPH_HEIGHT,
  GLYPH_WIDTH,
  MIN_CELL,
  nearestSlot,
  partOf,
  slotPositions,
} from '../../services/bioView/geometry'
import { EPITHELIAL_SHAPE, annotationOfFacet } from '../../services/bioView/shape'
import { CARD, GAP, REGION_HEIGHT } from '../../services/bioView/layout'
import BioPlaceDialog from './BioPlaceDialog.vue'
import useDragAndDrop from '../../composables/useDnD'
import { useBioTemplateStore } from '../../stores/bioTemplateStore'
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
// The library's drag state; called before the bio flow's store, as it reaches for the main one.
const libraryDrag = useDragAndDrop()
const history = useFlowHistoryStore()
const libraryStore = useLibraryStore()
const templateStore = useBioTemplateStore()
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
const { bioNodes, couplingEdges, layout, roles, sites, loadSidecars } = useBioNodes(main.nodes, main.edges)
const { applyPlan, templateMoves, placeTemplate, renameTemplate, relayoutTemplate, removeTemplate } =
  useBioEdits(roles)

onMounted(() => loadSidecars())

// vue-flow measures a node's handles when they mount, so a node whose handles change (a selection's
// couplings come and go) is measured again, or its lines would keep to the old points. So is one whose
// parent changes, as a template piece's id does when a module binds to it or leaves it.
const handlesOf = computed(
  () =>
    new Map(
      bioNodes.value.map((node) => [node.id, `${node.parentNode ?? ''} ${JSON.stringify(node.data.handles ?? [])}`])
    )
)
watch(handlesOf, async (now, before) => {
  const changed = [...now].filter(([id, handles]) => before?.get(id) !== handles).map(([id]) => id)
  if (!changed.length) return
  await nextTick()
  updateNodeInternals(changed)
})
onBeforeUnmount(() => (viewMode.bioViewport = { ...viewport.value }))

// vue-flow says nodes are initialised again whenever new ones are measured, as when a template is placed, so
// the view is set once, or it would jump away from what was just added. An empty view never says so, and is
// set when its pane is ready.
let isViewSet = false
function setView(fit) {
  if (isViewSet) return
  isViewSet = true
  if (viewMode.bioViewport) setViewport(viewMode.bioViewport)
  else if (fit) fitView({ padding: 0.15 })
}
const onNodesInitialized = () => setView(true)
const onPaneReady = () => !bioNodes.value.length && setView(false)

// ── Dragging into a membrane or onto a template site ───────────────────
const draggingId = ref(null)
// A selection's coupling lines end where things were laid out, so they wait for a drag to end.
const shownCouplings = computed(() => (draggingId.value ? [] : couplingEdges.value))
/** Where the drag would go: { slot } in a node-owned cell's membrane, or { site } of a template. */
const activeTarget = ref(null)
const targets = computed(() => dropTargets(layout.value))
const siteTargets = computed(() => dropSites(sites.value))

/**
 * Finds where a point drops: the nearer of a node-owned cell's slot and a template's slot, else the template
 * area holding it.
 *
 * @param {{x: number, y: number}} point
 * @returns {{slot: Object}|{site: Object}|null}
 */
function targetAt(point) {
  const slot = nearestSlot(targets.value, point, SNAP_DISTANCE)
  const site = nearestSite(siteTargets.value, point, SNAP_DISTANCE)
  const slotDistance = slot ? Math.hypot(slot.x - point.x, slot.y - point.y) : Infinity
  if (site?.type === 'slot' && site.distance < slotDistance) return { site }
  if (slot) return { slot }
  return site ? { site } : null
}

/** Names a node for a prompt. */
const nameOf = (id) => main.findNode(id)?.data?.name ?? id

/**
 * Where an area's name goes, clear of the cells and of the names drawn on them: a cell's at its bottom right,
 * a compartment's on its side away from the cells it lies against.
 */
function promptText({ area, rect, key }) {
  if (area === 'membrane') return { x: rect.x + rect.width / 2, y: rect.y + 18, anchor: 'middle' }
  if (area === 'cell') return { x: rect.x + rect.width - 16, y: rect.y + rect.height - 36, anchor: 'end' }
  if (area === 'process') return { x: rect.x + rect.width - 8, y: rect.y + 14, anchor: 'end' }
  const { edge, form } = layout.value.get(key) ?? {}
  if (form === 'gap') return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 + 4, anchor: 'middle' }
  if (edge === 'bottom') return { x: rect.x + 10, y: rect.y + rect.height - 26, anchor: 'start' }
  if (edge === 'right') return { x: rect.x + rect.width - 6, y: rect.y + 18, anchor: 'end' }
  return { x: rect.x + 10, y: rect.y + 18, anchor: 'start' }
}

/** While something is dragged: every membrane slot, and every template area, named and outlined. */
const sitePrompts = computed(() => {
  if (!draggingId.value) return { slots: [], areas: [] }
  const active = activeTarget.value
  const glyph = { width: GLYPH_WIDTH, height: GLYPH_HEIGHT }
  const slots = targets.value.flatMap((cell) =>
    (cell.shape ?? EPITHELIAL_SHAPE).facets.flatMap(({ id: part }) =>
      slotPositions(cell.rect, part, (cell.counts[part] ?? 0) + 1, cell.shape).map((slot, order) => ({
        key: `${cell.id}/${part}/${order}`,
        ...slot,
        ...glyph,
        active: active?.slot?.cellId === cell.id && active.slot.part === part && active.slot.order === order,
      }))
    )
  )
  const isActive = ({ ref, type, order }) =>
    !!active?.site && active.site.ref === ref && active.site.type === type && active.site.order === order
  const areas = []
  for (const target of siteTargets.value) {
    if (target.type === 'slot') {
      const size = target.role === 'cytosolic' ? CARD : glyph
      const { ref, x, y, order } = target
      slots.push({ key: `${ref}#${order}`, ref, x, y, ...size, active: isActive(target) })
      continue
    }
    areas.push({
      key: target.ref,
      ref: target.ref,
      area: target.area,
      rect: target.rect,
      label: `${target.label} · ${target.area}`,
      replace: target.kind === 'single' && target.occupant ? nameOf(target.occupant) : null,
      text: promptText(target),
      active: isActive(target),
    })
  }
  // The biggest underneath, so smaller areas inside them stay visible.
  areas.sort((a, b) => b.rect.width * b.rect.height - a.rect.width * a.rect.height)
  return { slots, areas }
})

/** Where a node's parent sits, so a child's position can be made absolute and back. */
function parentOffset(node) {
  const parent = node?.parentNode ? findNode(node.parentNode) : null
  return parent ? parent.computedPosition : { x: 0, y: 0 }
}

/**
 * Snaps a dragged node's position to the nearest slot, and remembers where it would go for the drop: a slot,
 * or a template area, which it doesn't snap to.
 */
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
  const target = targetAt(centre)
  activeTarget.value = target
  const slot = target?.slot ?? (target?.site?.type === 'slot' ? target.site : null)
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

/** The template instance a cell or region of the view is a piece of, if any. */
function pieceOf(id) {
  const place = layout.value.get(id)
  return place?.instance && (place.kind === 'cell' || place.kind === 'region') ? place.instance : null
}

/** The context every plan reads: the layout as drawn, the roles and the bioViews. */
const planContext = () => ({ layout: layout.value, roles: roles.value, bioViews: bioViews() })

/**
 * Keeps dragged nodes where they were put: in a membrane slot or on a template site, out of one, or just
 * moved. A dragged template piece moves its whole instance, in the same step.
 */
function onNodeDragStop({ nodes }) {
  const target = activeTarget.value
  const dropped = draggingId.value
  draggingId.value = null
  activeTarget.value = null

  const plan = new Map()
  const moves = new Map()
  const add = (entries) => entries.forEach((bioView, id) => plan.set(id, bioView))
  const positionOf = (moved) => {
    const node = findNode(moved.id) ?? moved
    return node.computedPosition ?? node.position
  }
  for (const moved of nodes) {
    const instance = pieceOf(moved.id)
    if (!instance || moves.has(instance)) continue
    const at = positionOf(moved)
    const { x, y } = layout.value.get(moved.id).rect
    moves.set(instance, { x: at.x - x, y: at.y - y })
  }
  for (const moved of nodes) {
    const node = findNode(moved.id) ?? moved
    const at = positionOf(moved)
    const place = layout.value.get(moved.id)
    // A template's pieces, and nodes bound to a template dragged with them, go with the template's move.
    if (moves.has(place?.instance)) continue
    if (moved.id === dropped && target?.site) {
      add(planSiteBind({ id: moved.id, site: target.site, ...planContext() }))
    } else if (moved.id === dropped && target?.slot) {
      add(planSlotDrop({ id: moved.id, slot: target.slot, ...planContext() }))
    } else if (place?.instance) {
      // Out of its template site, to where it was dropped.
      add(planUnbind({ id: moved.id, position: { x: at.x, y: at.y }, ...planContext() }))
    } else if (place?.kind === 'protein') {
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
  applyPlan(plan, moves.size ? 'bio-template-move' : 'bio-layout', templateMoves(moves))
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
  const cells = [...layout.value.values()].filter((place) => place.kind === 'cell').map((place) => place.rect)
  const left = cells.length ? Math.min(...cells.map((rect) => rect.x)) : 0
  const top = cells.length ? Math.min(...cells.map((rect) => rect.y)) : 0
  const loose = [...layout.value.values()].filter((place) => place.kind === 'tray').length
  return {
    x: left - 2 * GAP - GLYPH_WIDTH,
    y: top + loose * (GLYPH_HEIGHT + 32),
  }
}

/** Menu wording for the epithelial cell's facets; any other facet uses its own label. */
const AGAINST_LABELS = {
  apical: 'Apical side',
  basolateral: 'Basolateral side',
  'lateral-left': 'Left side (paracellular)',
  'lateral-right': 'Right side (paracellular)',
}

/** Where a region can lie: against each annotated facet of a cell, such as its top, bottom or either side. */
const AGAINST = EPITHELIAL_SHAPE.facets
  .filter((facet) => facet.annotation)
  .map((facet) => ({
    ...annotationOfFacet(EPITHELIAL_SHAPE, facet.id),
    label: AGAINST_LABELS[facet.id] ?? facet.label,
  }))

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

/** Renaming a template instance: { id, label, placeholder }. */
const renaming = ref(null)

function onRenameConfirm() {
  const { id, label } = renaming.value
  renaming.value = null
  renameTemplate(id, label)
}

/** The menu items for the template instance a piece belongs to. */
function templateMenu(instanceId) {
  const instance = templateStore.getInstance(instanceId)
  if (!instance) return []
  const name = templateStore.getDefinition(instance.template)?.name ?? instance.template
  return [
    { separator: true },
    {
      label: 'Rename Template…',
      icon: 'pi pi-pencil',
      command: () => (renaming.value = { id: instanceId, label: instance.label ?? '', placeholder: name }),
    },
    { label: 'Re-layout Template', icon: 'pi pi-th-large', command: () => relayoutTemplate(instanceId) },
    { label: 'Remove Template', icon: 'pi pi-trash', command: () => removeTemplate(instanceId) },
  ]
}

function onNodeContextMenu({ event, node }) {
  event.preventDefault()
  const instance = pieceOf(node.id) ?? (node.type === 'bioTemplateTitle' ? node.data.instance : null)
  // An empty template piece, or a template's name, is no diagram node: only its template's menu.
  if (!main.findNode(node.id)) {
    if (!instance) return
    menuItems.value = templateMenu(instance).slice(1)
    contextMenu.value.show(event)
    return
  }
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
  if (role?.role === 'region' && !role.site) items.push(liesAgainstMenu(node.id, role))
  const place = layout.value.get(node.id)
  // Bound to a template site that is there: unbinding goes where its role puts it, a protein to the tray.
  const site = role?.site && place?.instance ? sites.value.find((entry) => entry.ref === role.site) : null
  const unbind = (type) =>
    applyPlan(planUnbind({ id: node.id, position: trayPosition(), ...planContext() }), type)
  if (place?.kind === 'protein') {
    items.push({
      label: 'Take Out of Membrane',
      icon: 'pi pi-sign-out',
      command: () =>
        site
          ? unbind('bio-unbind')
          : applyPlan(planUnplace({ id: node.id, position: trayPosition(), ...planContext() })),
    })
  }
  if (site) {
    items.push({ label: `Unbind from "${site.label}"`, icon: 'pi pi-link', command: () => unbind('bio-unbind') })
  }
  if (main.findNode(node.id)?.data?.bioView && !role?.site) {
    items.push(
      { separator: true },
      {
        label: 'Reset to Annotations',
        icon: 'pi pi-replay',
        command: () => applyPlan(new Map([[node.id, undefined]]), 'bio-reset'),
      }
    )
  }
  if (instance) items.push(...templateMenu(instance))
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
      label: 'Add Template',
      icon: 'pi pi-objects-column',
      items: templateStore.library.map((template) => ({
        label: template.name,
        command: () => placeTemplate(template.id, at),
      })),
    },
    { separator: true },
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
  // Only a facet with a side keeps one; a lateral protein given no side stays sideless.
  const sided = annotationOfFacet(EPITHELIAL_SHAPE, part)?.at !== undefined
  return { cellId: cell, part, facet, at: sided ? at : undefined, order: count }
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
  activeTarget.value = targetAt(point)
}

function onModuleDragLeave(event) {
  if (event.currentTarget.contains(event.relatedTarget)) return
  if (draggingId.value === 'library') draggingId.value = activeTarget.value = null
}

/**
 * Adds a library module dropped here: into the membrane slot or onto the template site it was dropped on, as
 * one step, or where it was dropped, asking what it is. Files dropped here go on to the workspace.
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
  const { slot, site } = targetAt(point) ?? {}
  draggingId.value = activeTarget.value = null

  if (site) {
    history.startBatch()
    try {
      // An instance of the module, bound to the site; planned against the sites as they were drawn.
      const id = props.createInstance(module, { role: site.role, facet: null })
      await applyPlan(planSiteBind({ id, site, ...planContext() }), 'bio-add')
    } finally {
      history.endBatch()
    }
    return
  }
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

.bio-site-prompt rect {
  fill: none;
  stroke: var(--p-primary-color);
  stroke-width: 1.5;
  stroke-dasharray: 8 5;
  opacity: 0.45;
}

.bio-site-prompt text {
  font-size: 12px;
  fill: var(--p-primary-color);
  opacity: 0.7;
}

.bio-site-prompt--membrane rect {
  fill: var(--p-content-background);
  opacity: 0.8;
}

.bio-site-prompt--membrane text {
  font-size: 11px;
}

.bio-site-prompt--active rect {
  fill: color-mix(in srgb, var(--p-primary-color) 14%, transparent);
  stroke-width: 2.5;
  opacity: 1;
}

.bio-site-prompt--active text {
  font-weight: 600;
  opacity: 1;
}

.bio-site-prompt__replace {
  font-style: italic;
}
</style>
