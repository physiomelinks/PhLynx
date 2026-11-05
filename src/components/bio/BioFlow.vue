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
      @node-drag-start="onNodeDragStart"
      @node-drag="onNodeDrag"
      @node-drag-stop="onNodeDragStop"
      @node-double-click="onNodeDoubleClick"
      @node-context-menu="onNodeContextMenu"
      @edge-context-menu="onEdgeContextMenu"
      @pane-context-menu="onPaneContextMenu"
      @nodes-initialized="onNodesInitialized"
      @pane-ready="onPaneReady"
      @pane-click="clearSpeciesFocus"
    >
      <Background v-bind="BACKGROUND_DOTS" />
      <MiniMap :pannable="true" :zoomable="true" class="mini-map" />
      <Controls :fit-view-params="fitViewParams">
        <ControlButton
          title="Export image of the physiological view"
          @click="emit('export-image', { root: vueFlowRef, viewport })"
        >
          <i class="pi pi-image"></i>
        </ControlButton>
        <ControlButton
          v-if="hasSpecies"
          :class="{ 'bio-species-toggle--on': isSpeciesOn }"
          :title="isSpeciesOn ? 'Hide species' : SPECIES_TOGGLE_TITLE"
          :aria-pressed="isSpeciesOn"
          data-testid="bio-species-toggle"
          @click="toggleSpecies"
        >
          <i class="pi pi-share-alt"></i>
        </ControlButton>
      </Controls>
      <template #zoom-pane>
        <!-- Species mode: each compartment's species, and the paths they take through proteins; only tokens are hit -->
        <svg
          v-if="drawnSpecies && !draggingId"
          :class="['bio-species', { 'bio-species--reordering': draggingChip }]"
          data-testid="bio-species"
        >
          <!-- Keyed by direction too, so a run that turns a path round runs its dashes again -->
          <g
            v-for="(path, index) in drawnSpecies.paths"
            :key="`${path.key}:${path.direction ?? ''}`"
            :class="[
              'bio-species-path',
              {
                'bio-species-path--moving': path.direction,
                'bio-species-path--focused': path.direction && viewMode.focusedSpecies?.species === path.species,
                'bio-species--dimmed': isDimmed(path.species),
              },
            ]"
            :style="{ '--species': colourOf(path.species) }"
            data-testid="bio-species-path"
            :data-protein="path.protein"
            :data-species="path.species"
            :data-direction="path.direction ?? ''"
          >
            <!-- Its own arrowhead, sized to its width: the leg stops at the head's base -->
            <marker
              v-if="path.head"
              :id="`bio-species-arrow-${index}`"
              viewBox="0 0 10 10"
              refX="0"
              refY="5"
              :markerWidth="path.head"
              :markerHeight="path.head"
              markerUnits="userSpaceOnUse"
              orient="auto"
            >
              <path d="M0,0 L10,5 L0,10 z" :style="{ fill: colourOf(path.species) }" />
            </marker>
            <path
              v-for="(d, side) in path.legs"
              :key="side"
              :d="d"
              :stroke-width="path.width"
              :marker-end="path.head ? `url(#bio-species-arrow-${index})` : undefined"
            />
          </g>
          <!-- What a protein reads only the amount of: a faint dashed line ending in an open circle (SBGN modulation) -->
          <g
            v-for="dependence in drawnSpecies.dependences"
            :key="dependence.key"
            :class="[
              'bio-species-dependence',
              {
                'bio-species-dependence--focused': viewMode.focusedSpecies?.species === dependence.species,
                'bio-species--dimmed': isDimmed(dependence.species),
              },
            ]"
            :style="{ '--species': colourOf(dependence.species) }"
            data-testid="bio-species-dependence"
            :data-protein="dependence.protein"
            :data-node="dependence.compartment"
            :data-species="dependence.species"
          >
            <path :d="dependence.d" />
            <circle :cx="dependence.end.x" :cy="dependence.end.y" :r="dependence.end.r" />
          </g>
          <g
            v-for="token in shownTokens"
            :key="token.key"
            :class="[
              'bio-species-token',
              'nopan',
              'nodrag',
              {
                'bio-species-token--focused': isFocused(token),
                'bio-species-token--dragging': draggingChip === token.key,
                'bio-species--dimmed': isDimmed(token.species),
              },
            ]"
            :style="{ '--species': colourOf(token.species), transform: offsetOf(token) }"
            role="button"
            data-testid="bio-species-token"
            :data-node="token.nodeId"
            :data-species="token.species"
            @click.stop="onTokenClick(token)"
            @pointerdown="onChipPointerDown($event, token)"
          >
            <title>
              {{ `${token.label} in ${nameOf(token.nodeId)}: click to plot it and the flows into it, drag to reorder` }}
            </title>
            <rect
              :x="token.x - token.width / 2"
              :y="token.y - token.height / 2"
              :width="token.width"
              :height="token.height"
              :rx="token.height / 2"
            />
            <text :x="token.x" :y="token.y" text-anchor="middle" dominant-baseline="central">{{ token.label }}</text>
          </g>
        </svg>
        <!-- While something is dragged: the slots and sites of the piece under the pointer, the drop's own marked -->
        <svg
          v-if="sitePrompts.slots.length || sitePrompts.areas.length"
          class="bio-slot-prompts"
          data-testid="bio-slot-prompts"
        >
          <!-- A compartment's outline stops where a cell lies over it -->
          <mask id="bio-site-prompt-cells" maskUnits="userSpaceOnUse" v-bind="EVERYWHERE">
            <rect v-bind="EVERYWHERE" fill="white" />
            <rect
              v-for="(cell, index) in sitePrompts.cells"
              :key="index"
              v-bind="cell"
              :rx="CELL_RADIUS"
              fill="black"
            />
          </mask>
          <g
            v-for="prompt in sitePrompts.areas"
            :key="prompt.key"
            :class="['bio-site-prompt', `bio-site-prompt--${prompt.area}`, { 'bio-site-prompt--active': prompt.active }]"
            data-testid="bio-site-prompt"
            :data-site="prompt.ref"
            :mask="prompt.area === 'compartment' ? 'url(#bio-site-prompt-cells)' : undefined"
          >
            <!-- A membrane is a band along its cell's outline; a cell's inside stops where that band starts -->
            <path
              v-if="prompt.path"
              :d="prompt.path"
              :style="prompt.area === 'membrane' ? { strokeWidth: 2 * MEMBRANE_BAND_HALF } : undefined"
            />
            <rect v-else v-bind="prompt.rect" rx="10" />
          </g>
          <!-- A slot's prompt sits on what is there now; the spare one, past the last, shows a plus -->
          <g
            v-for="prompt in sitePrompts.slots"
            :key="prompt.key"
            :class="[
              'bio-slot-prompt',
              { 'bio-slot-prompt--active': prompt.active, 'bio-slot-prompt--spare': prompt.spare },
            ]"
            data-testid="bio-slot-prompt"
            :data-site="prompt.ref"
          >
            <rect
              :x="prompt.x - prompt.width / 2"
              :y="prompt.y - prompt.height / 2"
              :width="prompt.width"
              :height="prompt.height"
              rx="14"
            />
            <path
              v-if="prompt.spare"
              class="bio-slot-prompt__plus"
              :d="`M ${prompt.x - 8} ${prompt.y} h 16 M ${prompt.x} ${prompt.y - 8} v 16`"
            />
          </g>
        </svg>
      </template>
      <template #edge-bioCoupling="props">
        <BioCouplingEdge v-bind="props" />
      </template>
      <template #node-bioCell="props">
        <BioCell :data="props.data" :selected="props.selected" :width="props.data.width" :height="props.data.height" />
      </template>
      <template #node-bioMembrane="props">
        <BioMembrane :data="props.data" :selected="props.selected" />
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
    <div
      v-if="pointerLabel"
      class="bio-drop-label"
      data-testid="bio-drop-label"
      :style="{ left: `${pointerLabel.left}px`, top: `${pointerLabel.top}px` }"
    >
      <div>{{ pointerLabel.text }}</div>
      <div v-if="pointerLabel.replace" class="bio-drop-label__replace">{{ pointerLabel.replace }}</div>
    </div>
    <ContextMenu
      ref="contextMenu"
      :model="menuItems"
      @show="isMenuOpen = true"
      @hide="isMenuOpen = false"
    >
      <template #item="{ item, props: menu, hasSubmenu, label }">
        <BioConnectionPanel v-if="item.connection" :connection="item.connection" />
        <a v-else v-bind="menu.action">
          <span v-if="item.icon" v-bind="menu.icon" />
          <span v-bind="menu.label">{{ label }}</span>
          <i v-if="hasSubmenu" v-bind="menu.submenuicon" class="pi pi-angle-right" />
        </a>
      </template>
    </ContextMenu>
    <input
      ref="templateFileInput"
      type="file"
      accept=".json,application/json"
      hidden
      data-testid="bio-template-file-input"
      @change="onTemplateFile"
    />
    <input
      ref="glyphFileInput"
      type="file"
      accept=".json,application/json"
      hidden
      data-testid="bio-glyph-file-input"
      @change="onGlyphFile"
    />
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
    <Dialog
      v-if="renamingNode"
      :visible="true"
      modal
      header="Rename Instance"
      :style="{ width: '360px' }"
      class="compact-dialog"
      data-testid="bio-node-rename"
      @update:visible="(visible) => !visible && (renamingNode = null)"
    >
      <form @submit.prevent="onRenameNodeConfirm">
        <SanitisedInput
          v-model="renamingNode.name"
          input-id="bio-node-rename-input"
          :sanitise="sanitiseName"
          :invalid="!!renameNodeError"
          autofocus
          data-testid="bio-node-rename-input"
        />
        <small v-if="renameNodeError" class="bio-rename-error">{{ renameNodeError }}</small>
      </form>
      <template #footer>
        <Button label="Cancel" severity="secondary" text @click="renamingNode = null" />
        <Button
          label="Rename"
          :disabled="!!renameNodeError"
          data-testid="bio-node-rename-confirm"
          @click="onRenameNodeConfirm"
        />
      </template>
    </Dialog>
    <Dialog
      v-if="naming"
      :visible="true"
      modal
      header="Add Compartment"
      :style="{ width: '360px' }"
      class="compact-dialog"
      data-testid="bio-template-name"
      @update:visible="(visible) => !visible && (naming = null)"
    >
      <InputText
        v-model="naming.label"
        class="w-full"
        autofocus
        placeholder="Compartment"
        data-testid="bio-template-name-input"
        @keydown.enter="onNamingConfirm"
      />
      <template #footer>
        <Button label="Cancel" severity="secondary" text @click="naming = null" />
        <Button label="Add" data-testid="bio-template-name-confirm" @click="onNamingConfirm" />
      </template>
    </Dialog>
    <BioPlaceDialog
      v-if="placing"
      :mode="placing.mode"
      :name="placing.name"
      :initial-role="placing.initialRole"
      :cells="cellChoices"
      @confirm="onPlaceConfirm"
      @cancel="onPlaceCancel"
    />
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
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
import BioConnectionPanel from './BioConnectionPanel.vue'
import BioCouplingEdge from './BioCouplingEdge.vue'
import BioMembrane from './BioMembrane.vue'
import BioProtein from './BioProtein.vue'
import BioRegion from './BioRegion.vue'
import BioTemplateTitle from './BioTemplateTitle.vue'
import SanitisedInput from '../SanitisedInput.vue'
import { bioViewForMove, useBioNodes } from '../../composables/useBioNodes'
import { useBioEdits } from '../../composables/useBioEdits'
import {
  STRUCTURE_TYPES,
  cellSites,
  dragCompanions,
  dropSites,
  dropTargets,
  nearestSite,
  neighbourNodes,
  ownedNeighbours,
  replacedOccupant,
  patchBioView,
  planCellArea,
  planCellMove,
  planRelayout,
  planSiteBind,
  planSlotDrop,
  planUnbind,
  planUnplace,
  whole,
} from '../../services/bioView/drop'
import { speciesFocus } from '../../services/bioView/species'
import { chipOrder, driftSpecies } from '../../services/bioView/speciesLayout'
import { deleteConnection, deleteInstances, deletionLabel, deletionScope } from '../../services/bioView/deletion'
import { connectionsMenu } from '../../services/bioView/connections'
import { primeMenuItems } from '../../services/bioView/menus'
import { BUILT_IN_GLYPHS, loadedGlyphs } from '../../services/bioView/glyphs'
import { glyphLibraryFile } from '../../services/bioView/glyphLibrary'
import {
  GLYPH_HEIGHT,
  GLYPH_WIDTH,
  MEMBRANE_BAND_HALF,
  MIN_CELL,
  partOf,
  roundedRectPath,
} from '../../services/bioView/geometry'
import { EPITHELIAL_SHAPE, annotationOfFacet } from '../../services/bioView/shape'
import { readTemplateFile, summariseProblems, templateFile } from '../../services/bioView/templateFiles'
import {
  EDGES,
  LIMITS,
  MEMBRANE,
  TONES,
  addToEdits,
  editedTemplate,
  freePieceId,
  instanceTemplate,
  isLocalTemplateId,
  normaliseEdits,
  parseSiteRef,
  removeFromEdits,
  siteNeighbours,
  siteRef,
} from '../../services/bioView/templates'
import { dropLabel, hasPorts, siteLabel, siteLinks, staleLinks } from '../../services/bioView/links'
import { CARD, GAP, REGION_HEIGHT } from '../../services/bioView/layout'
import { CELL_RADIUS } from '../../services/bioView/metrics'
import BioPlaceDialog from './BioPlaceDialog.vue'
import useDragAndDrop from '../../composables/useDnD'
import { useConfirmDialog } from '../../composables/useConfirmDialog'
import { useAppSettings } from '../../composables/useAppSettings'
import { useBioTemplateStore } from '../../stores/bioTemplateStore'
import { useGlyphLibraryStore } from '../../stores/glyphLibraryStore'
import { useFlowHistoryStore } from '../../stores/historyStore'
import { useLibraryStore } from '../../stores/libraryStore'
import { useViewModeStore } from '../../stores/viewModeStore'
import { BACKGROUND_DOTS, FLOW_IDS, NEW_INSTANCE_MODULE_REF } from '../../utils/constants'
import { notify } from '../../utils/notify'
import { legacyDownload } from '../../utils/save'
import { sanitiseName } from '../../utils/identifiers'

const props = defineProps({
  /** Adds an instance of a library module with this bioView, and gives its node id (see WorkspaceArea). */
  createInstance: { type: Function, default: null },
  /** Joins pairs of instances, [{ source, target }], with label-matched edges, in the current step. */
  connectInstances: { type: Function, default: null },
  /** Removes edges by id, in the current step, re-deriving the couplings left at their ends (see WorkspaceArea). */
  disconnectInstances: { type: Function, default: null },
  /** Gives an instance's "Apply Parameter Set" submenu as the diagram's node menu builds it (see WorkspaceArea). */
  parameterSetMenu: { type: Function, default: null },
  /** How the view is fitted, as the diagram's is: clear of the library panel over its left. */
  fitViewParams: { type: Object, default: () => ({ padding: 0.15 }) },
})

const emit = defineEmits(['open-instance-editor', 'open-edge-dialog', 'export-image'])

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
const glyphStore = useGlyphLibraryStore()
const { choose } = useConfirmDialog()
const {
  applyNodeChanges,
  findNode,
  fitView,
  onMoveStart,
  screenToFlowCoordinate,
  setViewport,
  updateNodeInternals,
  viewport,
  vueFlowRef,
} = useVueFlow(FLOW_IDS.BIO)
const viewMode = useViewModeStore()
const { settings } = useAppSettings()
/** Whether species mode is on: as the user last set it here, else as Settings opens the view. */
const isSpeciesOn = computed(() => viewMode.speciesOverlay ?? !!settings.speciesOverlay)
/** The focused token, kept by Species with Fluxes even where it has no path. */
const keptSpecies = computed(() => {
  const focus = viewMode.speciesScope === 'fluxes' ? viewMode.focusedSpecies : null
  return focus ? `${focus.nodeId}\n${focus.species}` : ''
})
const speciesMode = computed(() => {
  if (!isSpeciesOn.value) return null
  const [nodeId, curie] = keptSpecies.value.split('\n')
  return {
    all: viewMode.speciesScope === 'all',
    fluxes: viewMode.speciesScope === 'fluxes',
    keep: keptSpecies.value ? { nodeId, species: curie } : null,
  }
})
const { bioNodes, couplingEdges, layout, roles, sites, hasSpecies, species, speciesOrderPreview, loadSidecars } =
  useBioNodes(
  main.nodes,
  main.edges,
  { speciesMode }
)
const {
  applyPlan,
  templateMoves,
  placeTemplate,
  renameTemplate,
  nameError,
  renameInstance,
  editTemplate,
  strandedBy,
  relayoutTemplate,
  removeTemplate,
} = useBioEdits(roles)

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
/** Which instances a view was of: a remembered view is only put back over the same ones. */
const viewKey = () =>
  main.nodes.value
    .map((node) => `${node.id}=${node.data?.name ?? ''}`)
    .sort()
    .join(' ')
// An empty view is not remembered, so the next one with something in it is fitted.
onBeforeUnmount(() => {
  viewMode.bioViewport = bioNodes.value.length ? { ...viewport.value, key: viewKey() } : null
})

// vue-flow says nodes are initialised again whenever new ones are measured, as when a template is placed, so
// the view is set once, or it would jump away from what was just added. It is set when there is first something
// to show: an empty view, as before a workspace is opened, leaves it to be fitted when one is.
let isViewSet = false
// Until the user pans, zooms or drags, the view keeps fitting the layout as it settles: roles and places can arrive
// after the first nodes are measured, as when sidecars load or annotations are applied. An undo or redo never
// moves it, so the user sees what changed where they were looking.
let isViewChosen = false
onMoveStart(({ event }) => {
  if (event) isViewChosen = true
})
function setView() {
  if (isViewSet || !bioNodes.value.length) return
  isViewSet = true
  const saved = viewMode.bioViewport
  if (saved?.key === viewKey()) {
    setViewport(saved)
    isViewChosen = true
  } else fitLayout()
}
/** Fits the layout, at once, clear of what lies over the view. */
const fitLayout = () => fitView({ ...props.fitViewParams, duration: 0 })
/** Where the laid-out pieces reach, so a refit follows only a change in extent, not a selection. */
const extent = computed(() =>
  bioNodes.value
    .filter((node) => !node.parentNode)
    .map((node) => `${Math.round(node.position.x)},${Math.round(node.position.y)},${node.width ?? ''},${node.height ?? ''}`)
    .join(';')
)
watch(extent, async () => {
  if (!isViewSet || isViewChosen || history.isReplaying) return
  await nextTick()
  fitLayout()
})
const onNodesInitialized = () => setView()
const onPaneReady = () => setView()
// The workspace behind the view was replaced or cleared: fit what comes next.
watch(
  () => bioNodes.value.length === 0,
  (isEmpty) => {
    if (isEmpty) isViewSet = isViewChosen = false
  },
  { flush: 'sync' }
)

// ── Dragging into a membrane or onto a template site ───────────────────
const draggingId = ref(null)
// A selection's coupling lines end where things were laid out, so they wait for a drag to end.
const shownCouplings = computed(() => (draggingId.value ? [] : couplingEdges.value))
/**
 * Where the drag would go: { slot } in a node-owned cell's membrane, { area } of a node-owned cell (its membrane
 * or inside), or { site } of a template.
 */
const activeTarget = ref(null)
const targets = computed(() => dropTargets(layout.value, draggingId.value))
const ownedTargets = computed(() => cellSites(targets.value))
const siteTargets = computed(() => dropSites(sites.value, draggingId.value))

/**
 * Finds where a point drops: the nearer of a node-owned cell's slot and a template's slot, else a node-owned
 * cell's membrane or inside, found as on a template's cell, else the template area holding it.
 *
 * @param {{x: number, y: number}} point
 * @param {{ membrane?: boolean }} [options] - For nearestSite.
 * @returns {{slot: Object}|{area: Object}|{site: Object}|null}
 */
function targetAt(point, options) {
  const owned = nearestSite(ownedTargets.value, point, SNAP_DISTANCE, options)
  const site = nearestSite(siteTargets.value, point, SNAP_DISTANCE, options)
  const slotDistance = owned?.type === 'slot' ? owned.distance : Infinity
  if (site?.type === 'slot' && site.distance < slotDistance) return { site }
  if (owned?.type === 'slot') return { slot: owned.slot }
  // A hand-added cell lies over any template compartment under it.
  if (owned && (!site || site.area === 'compartment')) return { area: owned }
  return site ? { site } : null
}

/** Names a node for a prompt. */
const nameOf = (id) => main.findNode(id)?.data?.name ?? id

/** Where the drag is, in flow coordinates, for the label that follows it. */
const pointer = ref(null)

/** Says which drop target a target is, so the same one found again on the next frame is known as the same. */
function targetKey(target) {
  if (!target) return ''
  if (target.slot) return `slot ${target.slot.cellId} ${target.slot.part} ${target.slot.order}`
  if (target.area) return `area ${target.area.cellId} ${target.area.area}`
  const { ref, type, order, area } = target.site
  return `site ${ref} ${type} ${order ?? ''} ${area ?? ''}`
}

/**
 * Follows a drag: where the pointer is, and the target under it. The target is replaced only when it is another
 * one, so what is drawn for it isn't worked out again on every frame of a drag.
 *
 * @param {{x: number, y: number}} point
 * @param {Object|null} target - From targetAt.
 */
function trackDrag(point, target) {
  // A dragover repeats while the pointer rests.
  if (point.x !== pointer.value?.x || point.y !== pointer.value?.y) pointer.value = point
  if (targetKey(target) !== targetKey(activeTarget.value)) activeTarget.value = target
}

/** The node-owned cells near the pointer, as their ids: unchanged while the pointer moves within reach of them. */
const nearCells = computed(() => {
  const at = pointer.value
  if (!at) return ''
  return targets.value
    .filter((cell) => isNear(cell.rect, at, SNAP_DISTANCE))
    .map((cell) => cell.id)
    .join('\n')
})

/**
 * The template sites next to a site, which a module dropped there connects to.
 *
 * @param {Object} site - A drop target.
 * @returns {Array<{ref: string, relation: string}>}
 */
function neighbourSites(site) {
  const parsed = parseSiteRef(site.ref)
  const instance = parsed && templateStore.getInstance(parsed.instance)
  const template = instance && instanceTemplate(instance, templateStore.definitions)
  if (!template) return []
  return siteNeighbours(template, parsed.path).map(({ path, relation }) => ({
    ref: siteRef(parsed.instance, path),
    relation,
  }))
}

/** The nodes a node dropped on a site connects to: those on the sites next to it not joined to it yet. */
const neighboursAt = (site, id) =>
  neighbourNodes(siteTargets.value, neighbourSites(site), { id, edges: main.edges.value })

/**
 * Joins a node just bound to a template site to the nodes on the sites next to it, in the current step, by the
 * links the site's relationships make (see siteLinks).
 *
 * @param {string} id
 * @param {Object} site - The drop target it was bound to.
 * @returns {Promise<void>}
 */
async function connectToNeighbours(id, site) {
  if (!props.connectInstances) return
  const links = siteLinks(id, site.role, neighboursAt(site, id))
  if (links.length) await props.connectInstances(links)
}

/**
 * Joins a node just placed on a node-owned cell (not a template's) to its neighbours there, in the current step,
 * as connectToNeighbours does on a template: a membrane and the cell's proteins, a protein and its cell, membrane
 * and the compartments against it, in whichever order they came (see ownedNeighbours).
 *
 * @param {string} id
 * @returns {Promise<void>}
 */
async function connectToCellNeighbours(id) {
  if (!props.connectInstances || !id) return
  // The layout as the plan just applied leaves it.
  await nextTick()
  const { role, neighbours } = ownedNeighbours(layout.value, id, { edges: main.edges.value })
  const links = role ? siteLinks(id, role, neighbours) : []
  if (links.length) await props.connectInstances(links)
}

/**
 * Every node a node lies next to where it is placed now, joined to it or not: those on the sites next to its
 * template site, or its neighbours on a node-owned cell (see ownedNeighbours).
 *
 * @param {string} id
 * @returns {Array<string>}
 */
function placedNeighbours(id) {
  const place = layout.value.get(id)
  if (place?.instance) {
    if (!place.site) return []
    return neighbourNodes(siteTargets.value, neighbourSites({ ref: place.site }), { id }).map((n) => n.id)
  }
  return ownedNeighbours(layout.value, id).neighbours.map((n) => n.id)
}

/**
 * Where some nodes lie before they move: each one's neighbours (see placedNeighbours).
 *
 * @param {Array<string>} ids
 * @returns {Map<string, Array<string>>}
 */
const neighboursOf = (ids) => new Map(ids.map((id) => [id, placedNeighbours(id)]))

/**
 * Takes away, in the current step, the edges placement made between nodes just moved and the neighbours they
 * left, so a protein moved to another facet no longer joins the fluid it left. An edge to such a neighbour drawn
 * or edited by hand stays, and the user is told (see staleLinks). Run once the move is applied; a fresh drop's
 * links follow it.
 *
 * @param {Map<string, Array<string>>} before - From neighboursOf, taken before the move.
 * @returns {Promise<void>}
 */
async function dropStaleLinks(before) {
  if (!props.disconnectInstances || !before.size) return
  // The layout as the move leaves it.
  await nextTick()
  const remove = new Map()
  const keep = new Map()
  for (const [id, was] of before) {
    const stale = staleLinks(id, was, placedNeighbours(id), main.edges.value)
    stale.remove.forEach((edge) => remove.set(edge.id, edge))
    stale.keep.forEach((edge) => keep.set(edge.id, edge))
  }
  if (remove.size) await props.disconnectInstances([...remove.keys()])
  if (!keep.size) return
  const names = [...keep.values()].map((edge) => `${nameOf(edge.source)} → ${nameOf(edge.target)}`).join(', ')
  const many = keep.size > 1
  notify.info({
    title: many ? 'Connections kept' : 'Connection kept',
    message:
      `${names} ${many ? 'were' : 'was'} drawn or edited by hand, so ${many ? 'they stay' : 'it stays'} ` +
      'though its modules are no longer neighbours.',
  })
}

/** Whether a replace confirmation is open, so the workspace's shortcuts wait. */
const isConfirming = ref(false)

/**
 * Asks before a drop replaces what is on a one-module site; any other drop goes ahead.
 *
 * @param {Object} site - The drop target.
 * @param {string|null} id - The node dropped, or null for a new one.
 * @param {string} name - What is dropped.
 * @returns {Promise<boolean>} Whether to go ahead.
 */
async function confirmReplace(site, id, name) {
  const occupant = replacedOccupant(site, id)
  if (!occupant) return true
  isConfirming.value = true
  try {
    const answer = await choose({
      header: 'Replace module?',
      message:
        `${site.label} holds ${nameOf(occupant)}. Put ${name} there instead? ` +
        `${nameOf(occupant)} stays in the diagram, with its connections, as a card.`,
      severity: 'warning',
      acceptLabel: 'Replace',
      rejectLabel: 'Cancel',
    })
    return answer === 'accept'
  } finally {
    isConfirming.value = false
  }
}

/** The template piece a site belongs to, '<instance>/<cell or compartment>', so prompts show only its sites. */
function pieceOfRef(ref) {
  const parsed = parseSiteRef(ref)
  return parsed ? `${parsed.instance}/${parsed.path.split('.')[0]}` : null
}

const isNear = (rect, { x, y }, margin) =>
  x >= rect.x - margin &&
  x <= rect.x + rect.width + margin &&
  y >= rect.y - margin &&
  y <= rect.y + rect.height + margin

/**
 * The outline a cell's membrane or inside is prompted with: the membrane along the cell's outline, drawn as wide
 * as the band a drop takes, and the inside within that band. Other areas are their rects.
 *
 * @param {Object} target - An area drop target.
 * @returns {string|null} An SVG path, or null for a rect.
 */
function areaPath({ area, rect }) {
  if (area === 'membrane') return roundedRectPath(rect, CELL_RADIUS)
  if (area !== 'cell') return null
  const inset = MEMBRANE_BAND_HALF
  const inner = { x: rect.x + inset, y: rect.y + inset, width: rect.width - 2 * inset, height: rect.height - 2 * inset }
  return roundedRectPath(inner, CELL_RADIUS - inset)
}

/** A mask's rect over the whole view. */
const EVERYWHERE = { x: -1e5, y: -1e5, width: 2e5, height: 2e5 }

/**
 * While something is dragged: the slots and areas of the piece under the pointer, the one the drop would go to
 * marked, and the cells' rects, which compartment outlines leave out.
 */
const sitePrompts = computed(() => {
  const empty = { slots: [], areas: [], cells: [] }
  if (!draggingId.value) return empty
  const active = activeTarget.value
  const glyph = { width: GLYPH_WIDTH, height: GLYPH_HEIGHT }
  // A node-owned cell's slots, membrane and inside, while the pointer is over or near that cell.
  const near = new Set(nearCells.value ? nearCells.value.split('\n') : [])
  const activeCell = (active?.slot ?? active?.area)?.cellId
  if (activeCell !== undefined && targets.value.some((cell) => cell.id === activeCell)) near.add(activeCell)
  const slots = []
  const areas = []
  for (const target of ownedTargets.value) {
    if (!near.has(target.cellId)) continue
    if (target.type === 'slot') {
      const { cellId, part, order } = target.slot
      const isActive = active?.slot?.cellId === cellId && active.slot.part === part && active.slot.order === order
      const { x, y, spare } = target
      slots.push({ key: `${cellId}/${part}/${order}`, x, y, spare, ...glyph, active: isActive })
      continue
    }
    const { cellId, area, rect } = target
    const isActive = active?.area?.cellId === cellId && active.area.area === area
    areas.push({ key: `${cellId}#${area}`, ref: cellId, area, rect, path: areaPath(target), active: isActive })
  }
  const piece = active?.site ? pieceOfRef(active.site.ref) : null
  if (!piece) return { ...empty, slots, areas: sortAreas(areas) }
  const isActive = ({ ref, type, order }) =>
    active.site.ref === ref && active.site.type === type && active.site.order === order
  for (const target of siteTargets.value) {
    if (pieceOfRef(target.ref) !== piece) continue
    if (target.type === 'slot') {
      const size = target.role === 'cytosolic' ? CARD : glyph
      const { ref, x, y, order, spare } = target
      slots.push({ key: `${ref}#${order}`, ref, x, y, spare, ...size, active: isActive(target) })
      continue
    }
    areas.push({
      key: target.ref,
      ref: target.ref,
      area: target.area,
      rect: target.rect,
      path: areaPath(target),
      active: isActive(target),
    })
  }
  const cells = [...layout.value.values()].filter((place) => place.kind === 'cell').map((place) => place.rect)
  return { slots, areas: sortAreas(areas), cells }
})

/** Area prompts, the biggest underneath, so smaller areas inside them stay visible; the active one on top. */
const sortAreas = (areas) =>
  areas.sort((a, b) => a.active - b.active || b.rect.width * b.rect.height - a.rect.width * a.rect.height)

/**
 * The label that follows the pointer: where the drop goes and what it connects to, and what it would replace.
 */
const dropText = computed(() => {
  const owned = activeTarget.value?.area
  // A node-owned cell's area is said by the cell's name.
  const site = owned ? { ...owned, label: nameOf(owned.cellId) } : activeTarget.value?.site
  if (!draggingId.value || !site) return null
  const id = draggingId.value === 'library' ? null : draggingId.value
  const labels = new Map(siteTargets.value.map((target) => [target.ref, target.label]))
  const dragged = id ? main.findNode(id)?.data : libraryDrag.draggedType.value
  // A library module's annotated ports are only made when it is added.
  const isPorted = (data) => hasPorts(data) || (!id && !!libraryStore.getModuleAnnotations(data?.mathRef))
  const text = dropLabel(
    siteLabel(site, nameOf),
    { name: id ? nameOf(id) : (dragged?.moduleRef?.split(':')[0] ?? 'the module'), hasPorts: isPorted(dragged) },
    (owned ? [] : neighboursAt(site, id)).map(({ id: other, ref }) => ({
      label: labels.get(ref) ?? ref,
      name: nameOf(other),
      hasPorts: hasPorts(main.findNode(other)?.data),
    }))
  )
  const replaced = owned ? null : replacedOccupant(site, id)
  return { text, replace: replaced ? `Replaces ${nameOf(replaced)}` : null }
})
/** The label that follows the pointer, where it is: only its place changes as the pointer moves. */
const pointerLabel = computed(() => {
  if (!dropText.value || !pointer.value) return null
  const { x, y, zoom } = viewport.value
  return { left: pointer.value.x * zoom + x + 18, top: pointer.value.y * zoom + y + 18, ...dropText.value }
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
  // A protein moved along its membrane keeps finding slots, not the membrane between them.
  const target = targetAt(centre, { membrane: roles.value.get(change.id)?.role !== 'membraneProtein' })
  trackDrag(centre, target)
  const slot = target?.slot ?? (target?.site?.type === 'slot' ? target.site : null)
  if (slot)
    change.position = {
      x: slot.x - width / 2 - offset.x,
      y: slot.y - height / 2 - offset.y,
    }
}

function onNodesChange(changes) {
  // A membrane is dragged only to move its cell (see onNodeDrag), so it stays on the cell's outline, and a
  // structure grabbed on its own leaves whatever else was selected where it is.
  changes = changes.filter(
    (change) =>
      change.type !== 'position' ||
      (findNode(change.id)?.type !== 'bioMembrane' && (!structureDrag?.alone || structureDrag.alone.has(change.id)))
  )
  for (const change of changes) {
    if (change.type === 'select') {
      const node = main.findNode(change.id)
      if (node) node.selected = change.selected
    } else if (change.type === 'position' && change.position && change.dragging) {
      // Moving anything changes the layout's extent, but the view should stay where the user is working.
      isViewChosen = true
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

/** Where each dragged node started, so a drop the user cancels puts it back. */
const dragStarts = new Map()
/**
 * The structure being dragged, if any: the node that leads it (a membrane's cell), where the pointer started,
 * and where each of its top-level pieces started. Grabbed unselected, it moves `alone`: only these pieces.
 */
let structureDrag = null

/** Where a drag's pointer is, in flow coordinates. */
function pointerAt(event) {
  const point = event?.touches?.[0] ?? event?.changedTouches?.[0] ?? event
  return Number.isFinite(point?.clientX) ? screenToFlowCoordinate({ x: point.clientX, y: point.clientY }) : null
}

function onNodeDragStart({ event, node, nodes }) {
  dragStarts.clear()
  for (const moved of nodes) dragStarts.set(moved.id, { ...moved.position })
  structureDrag = null
  // A structure's handle takes its other pieces along; a part, such as a protein or card, moves alone.
  const lead = node.type === 'bioMembrane' ? findNode(node.parentNode) : node
  const companions = dragCompanions(layout.value, node)
  if (!lead || (lead === node && !companions.length)) return
  const pieces = [lead, ...companions.map((id) => findNode(id))].filter(Boolean)
  const starts = new Map(pieces.map((piece) => [piece.id, { ...piece.position }]))
  structureDrag = {
    lead: lead.id,
    from: pointerAt(event),
    starts,
    alone: node.selected ? null : new Set([node.id, ...starts.keys()]),
  }
}

/** Moves the rest of a dragged structure with it, as the drag goes, and the species drawn over what moved. */
function onNodeDrag({ event, node, nodes }) {
  moveStructure(event, node)
  driftWithDrag(nodes ?? [node])
}

/** Moves the rest of a dragged structure with the node dragged. */
function moveStructure(event, node) {
  if (!structureDrag) return
  const { lead, from, starts } = structureDrag
  let delta
  if (node.id === lead) {
    const start = starts.get(lead)
    delta = { x: node.position.x - start.x, y: node.position.y - start.y }
  } else {
    // A membrane's drag moves its cell by how far the pointer went.
    const at = pointerAt(event)
    if (!at || !from) return
    delta = { x: at.x - from.x, y: at.y - from.y }
  }
  applyNodeChanges(
    [...starts]
      .filter(([id]) => id !== node.id)
      .map(([id, start]) => ({ id, type: 'position', position: { x: start.x + delta.x, y: start.y + delta.y } }))
  )
}

/**
 * Shifts the species of the cells and regions a drag has moved by as far as each has gone, redrawing only the legs
 * to what moved, so they keep with their compartments and proteins without laying the species out again.
 */
function driftWithDrag(nodes) {
  if (!species.value) return
  const moved = new Map()
  for (const id of new Set([...(structureDrag?.starts.keys() ?? []), ...nodes.map((moving) => moving.id)])) {
    const place = layout.value.get(id)
    const position = findNode(id)?.position
    if ((place?.kind !== 'cell' && place?.kind !== 'region') || !position) continue
    const shift = { x: position.x - place.rect.x, y: position.y - place.rect.y }
    if (shift.x || shift.y) moved.set(id, shift)
  }
  speciesDrift.value = moved.size ? { moved } : null
}

/** Puts dragged nodes back where their drag started. */
function putBack(nodes) {
  const changes = nodes
    .filter((node) => dragStarts.has(node.id))
    .map((node) => ({ id: node.id, type: 'position', position: dragStarts.get(node.id), dragging: false }))
  applyNodeChanges(changes)
}

/**
 * Keeps dragged nodes where they were put: in a membrane slot or on a template site, out of one, or just
 * moved. A dragged template piece moves its whole instance, in the same step. A node bound to a template site
 * is joined to the nodes on the sites next to it in that step too, once the user agrees to any replace.
 */
async function onNodeDragStop(event) {
  try {
    await settleNodeDrag(event)
  } finally {
    // The species keep where the drag left them until the layout they follow has caught up, so they never jump.
    await nextTick()
    speciesDrift.value = null
  }
}

async function settleNodeDrag({ nodes: dragged }) {
  // A membrane dragged moved its cell; a structure grabbed on its own left the rest of the selection alone.
  const alone = structureDrag?.alone
  const nodes = dragged
    .filter((moved) => !alone || alone.has(moved.id))
    .map((moved) => (moved.type === 'bioMembrane' ? (findNode(moved.parentNode) ?? moved) : moved))
  structureDrag = null
  const target = activeTarget.value
  const dropped = draggingId.value
  draggingId.value = null
  activeTarget.value = null
  pointer.value = null

  const plan = new Map()
  const moves = new Map()
  // The nodes that leave their place, whose placement edges to the neighbours they leave go.
  const relocated = []
  const add = (entries) => entries.forEach((bioView, id) => plan.set(id, bioView))
  const positionOf = (moved) => {
    const node = findNode(moved.id) ?? moved
    return node.computedPosition ?? node.position
  }
  for (const moved of nodes) {
    const isTitle = moved.type === 'bioTemplateTitle'
    const instance = isTitle ? moved.data?.instance : pieceOf(moved.id)
    if (!instance || moves.has(instance)) continue
    const at = positionOf(moved)
    const from = isTitle ? dragStarts.get(moved.id) : layout.value.get(moved.id).rect
    if (from) moves.set(instance, { x: at.x - from.x, y: at.y - from.y })
  }
  const binds =
    !!target?.site &&
    nodes.some((moved) => moved.id === dropped && !moves.has(layout.value.get(moved.id)?.instance))
  if (binds && !(await confirmReplace(target.site, dropped, nameOf(dropped)))) return putBack(nodes)

  for (const moved of nodes) {
    const node = findNode(moved.id) ?? moved
    const at = positionOf(moved)
    const place = layout.value.get(moved.id)
    // A template's name and pieces, and nodes bound to a template dragged with them, go with the template's move.
    if (moved.type === 'bioTemplateTitle' || moves.has(place?.instance)) continue
    const isPlaced = moved.id === dropped && !!(target?.site || target?.slot || target?.area)
    if (isPlaced || place?.instance || place?.kind === 'protein') relocated.push(moved.id)
    if (moved.id === dropped && target?.site) {
      add(planSiteBind({ id: moved.id, site: target.site, ...planContext() }))
    } else if (moved.id === dropped && target?.slot) {
      add(planSlotDrop({ id: moved.id, slot: target.slot, ...planContext() }))
    } else if (moved.id === dropped && target?.area) {
      add(planCellArea({ id: moved.id, area: target.area, layout: layout.value, bioViews: bioViews() }))
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
      // A cell's cards and the regions against it that keep places of their own go with it.
      if (place?.kind === 'cell') {
        const delta = { x: at.x - place.rect.x, y: at.y - place.rect.y }
        add(planCellMove({ id: moved.id, delta, layout: layout.value, bioViews: bioViews() }))
      }
    }
  }
  const type = moves.size ? 'bio-template-move' : 'bio-layout'
  const owned = !binds && !!(target?.slot || target?.area) && nodes.some((moved) => moved.id === dropped)
  const before = neighboursOf(relocated)
  if (!binds && !owned && !before.size) return applyPlan(plan, type, templateMoves(moves))
  // Out of the places they left, and onto a template site or node-owned cell joined to the neighbours there, in
  // the same step.
  history.startBatch()
  try {
    if (await applyPlan(plan, type, templateMoves(moves))) {
      await dropStaleLinks(before)
      if (binds) await connectToNeighbours(dropped, target.site)
      else if (owned) await connectToCellNeighbours(dropped)
    }
  } finally {
    history.endBatch(moves.size ? type : binds ? 'bio-bind' : 'bio-layout')
  }
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

// ── Species mode ───────────────────────────────────────────────────────
/**
 * How the species drawn are moved while something is dragged (see driftSpecies): the cells and regions moved, and
 * the tokens put somewhere of their own.
 */
const speciesDrift = shallowRef(null)
/** The species as drawn: as laid out, moved with a drag under way. */
const drawnSpecies = computed(() => driftSpecies(species.value, layout.value, speciesDrift.value ?? undefined))
/** A moved token's translation from where it was laid out, as CSS. */
const offsetOf = (token) => (token.offset ? `translate(${token.offset.x}px, ${token.offset.y}px)` : undefined)
const SPECIES_TOGGLE_TITLE = 'Show species: each compartment’s, and the paths through its proteins'
/** One colour per species, the same in every compartment; paths take their species' colour. */
const SPECIES_COLOURS = [
  'var(--p-sky-600)',
  'var(--p-amber-600)',
  'var(--p-violet-600)',
  'var(--p-emerald-600)',
  'var(--p-rose-600)',
  'var(--p-orange-600)',
  'var(--p-lime-700)',
  'var(--p-indigo-600)',
]
const shownSpecies = computed(() => [...new Set((species.value?.tokens ?? []).map((token) => token.species))].sort())
const colourIndex = (curie) => Math.max(0, shownSpecies.value.indexOf(curie)) % SPECIES_COLOURS.length
const colourOf = (curie) => SPECIES_COLOURS[colourIndex(curie)]
const isFocused = (token) =>
  viewMode.focusedSpecies?.nodeId === token.nodeId && viewMode.focusedSpecies?.species === token.species
/** Whether a species is set back while another is focused. */
const isDimmed = (curie) => !!viewMode.focusedSpecies && viewMode.focusedSpecies.species !== curie

/** Forgets the species token clicked, so the selection plot follows the selection again. */
function clearSpeciesFocus() {
  viewMode.focusedSpecies = null
}

/** Turns species mode on or off, for as long as the app is open. */
function toggleSpecies() {
  viewMode.speciesOverlay = !isSpeciesOn.value
  if (!viewMode.speciesOverlay) clearSpeciesFocus()
}

/**
 * Shows only the species coupled to their compartments, only those with a path through a protein, or every one
 * annotated, turning species mode on. A focused token stays focused into Species with Fluxes, which keeps it.
 */
function setSpeciesScope(scope) {
  viewMode.speciesScope = scope
  viewMode.speciesOverlay = true
  if (scope !== 'fluxes') clearSpeciesFocus()
}

/** How far, in screen pixels, a species chip must be dragged before it moves: less is a click. */
const CHIP_DRAG_THRESHOLD = 4
/** The key of the species chip being dragged along its row, if any. */
const draggingChip = ref(null)
/**
 * A chip drag under way: the token, where the pointer started (on screen and in the flow), where its centre is along
 * its row, whether it has moved, the order of its compartment's species it started in and the one it would leave
 * now, and where the other chips go in that. It moves the species drawn only, never the view's nodes.
 */
let chipDrag = null
/** The species tokens, a dragged one last so it is drawn over the rest of its row. */
const shownTokens = computed(() => {
  const tokens = drawnSpecies.value?.tokens ?? []
  const dragged = tokens.find((token) => token.key === draggingChip.value)
  return dragged ? [...tokens.filter((token) => token !== dragged), dragged] : tokens
})
/** Whether the click that ends a chip drag is to be ignored. */
let isChipClickDropped = false

/** Starts a possible drag of a species chip along its compartment's row. */
function onChipPointerDown(event, token) {
  if (event.button !== 0 || !token.row) return
  const from = pointerAt(event)
  if (!from) return
  const order = chipOrder(species.value?.tokens ?? [], token.key)?.join('\n')
  chipDrag = {
    token,
    screen: { x: event.clientX, y: event.clientY },
    from,
    along: token[token.row.axis],
    moved: false,
    order,
    previewed: order,
    slots: null,
  }
  window.addEventListener('pointermove', onChipPointerMove)
  window.addEventListener('pointerup', onChipPointerUp)
  window.addEventListener('pointercancel', onChipPointerCancel)
  window.addEventListener('keydown', onChipKeyDown, true)
}

/**
 * Moves the dragged chip along its row, within its compartment, its paths with it, and slides the others into the
 * places they would take were it let go here. Their places are worked out again only when that order changes.
 */
function onChipPointerMove(event) {
  if (!chipDrag) return
  const { token, screen, from } = chipDrag
  if (!chipDrag.moved && Math.hypot(event.clientX - screen.x, event.clientY - screen.y) < CHIP_DRAG_THRESHOLD) return
  const at = pointerAt(event)
  if (!at) return
  if (!chipDrag.moved) {
    chipDrag.moved = true
    draggingChip.value = token.key
  }
  const { axis, low, high } = token.row
  const half = (axis === 'x' ? token.width : token.height) / 2
  const start = token[axis]
  chipDrag.along = Math.min(Math.max(start + at[axis] - from[axis], low + half), Math.max(low + half, high - half))
  const order = chipOrder(species.value?.tokens ?? [], token.key, chipDrag.along)
  const key = order?.join('\n')
  if (key !== chipDrag.previewed) {
    chipDrag.previewed = key
    chipDrag.slots =
      key === chipDrag.order
        ? null
        : new Map(speciesOrderPreview(token.nodeId, order).map((slot) => [slot.key, { x: slot.x, y: slot.y }]))
  }
  const placed = new Map(chipDrag.slots ?? [])
  placed.set(token.key, { ...token, [axis]: chipDrag.along })
  speciesDrift.value = { placed }
}

/** Ends a chip drag, giving it back. */
function endChipDrag() {
  window.removeEventListener('pointermove', onChipPointerMove)
  window.removeEventListener('pointerup', onChipPointerUp)
  window.removeEventListener('pointercancel', onChipPointerCancel)
  window.removeEventListener('keydown', onChipKeyDown, true)
  const drag = chipDrag
  chipDrag = null
  draggingChip.value = null
  return drag
}

/** Puts every chip back where it was, keeping the order. */
function onChipPointerCancel() {
  const drag = endChipDrag()
  speciesDrift.value = null
  // A drag let go after Escape is no click on the chip.
  if (drag?.moved) {
    isChipClickDropped = true
    setTimeout(() => (isChipClickDropped = false))
  }
}

/** Escape during a chip drag cancels it. */
function onChipKeyDown(event) {
  if (event.key !== 'Escape' || !chipDrag?.moved) return
  event.preventDefault()
  event.stopPropagation()
  onChipPointerCancel()
}

/** Keeps the order a chip was dragged into, for its compartment, as one undo step. */
async function onChipPointerUp() {
  const drag = endChipDrag()
  if (!drag?.moved) return
  // The click this release makes is no click on the chip.
  isChipClickDropped = true
  setTimeout(() => (isChipClickDropped = false))
  const { token, along } = drag
  const tokens = species.value?.tokens ?? []
  const order = chipOrder(tokens, token.key, along)
  try {
    if (order && order.join('\n') !== drag.order) {
      const stored = main.findNode(token.nodeId)?.data?.bioView?.speciesOrder ?? []
      // Species not shown now, as under another scope, keep their place after these.
      const speciesOrder = [...order, ...stored.filter((curie) => !order.includes(curie))]
      await setChoice(token.nodeId, { speciesOrder }, 'bio-species-order')
    }
  } finally {
    // The chips keep where the drag showed them until the order kept has laid them out there.
    await nextTick()
    speciesDrift.value = null
  }
}
onBeforeUnmount(() => endChipDrag())

/**
 * Plots a species token in place of the selection, which it clears: its compartment's amount of the species and
 * the flows into it (see useSelectionPlot). A Selection run covers the compartment and the proteins coupled to it.
 */
function onTokenClick({ nodeId, species: curie, label }) {
  if (isChipClickDropped) {
    isChipClickDropped = false
    return
  }
  for (const node of main.nodes.value) if (node.selected) node.selected = false
  const { scope } = speciesFocus(
    species.value.network,
    { nodeId, species: curie },
    {
      nameOf,
      sidecarOf: (id) => {
        const mathRef = main.findNode(id)?.data?.mathRef
        return mathRef ? libraryStore.getParsedModuleAnnotations(mathRef) : null
      },
    }
  )
  viewMode.focusedSpecies = { nodeId, species: curie, label: `${label} in ${nameOf(nodeId)}`, scope }
}

// Selecting an instance plots it instead; so does leaving the view.
watch(
  () => main.nodes.value.some((node) => node.selected),
  (isSelected) => isSelected && clearSpeciesFocus()
)
onBeforeUnmount(clearSpeciesFocus)

/** The pane menu's species mode items. */
function speciesMenu() {
  const scopeItem = (label, scope) => ({
    label,
    icon: viewMode.speciesScope === scope ? 'pi pi-check' : 'pi pi-fw',
    command: () => setSpeciesScope(scope),
  })
  return [
    { label: isSpeciesOn.value ? 'Hide Species' : 'Show Species', command: toggleSpecies },
    { separator: true },
    scopeItem('Coupled Species', 'coupled'),
    scopeItem('Species with Fluxes', 'fluxes'),
    scopeItem('All Annotated Species', 'all'),
  ]
}

// ── Menus ──────────────────────────────────────────────────────────────
const contextMenu = ref(null)
const menuItems = ref([])
/** Whether the view's menu is open, so Delete and Backspace leave the selection alone. */
const isMenuOpen = ref(false)

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

/**
 * Takes a node out of its place by a plan, without the placement edges to the neighbours it leaves, as one step.
 *
 * @param {string} id
 * @param {Map<string, Object>} plan - From planUnbind or planUnplace.
 * @param {string} type - The command type.
 * @returns {Promise<void>}
 */
async function takeOut(id, plan, type) {
  const before = neighboursOf([id])
  history.startBatch()
  try {
    if (await applyPlan(plan, type)) await dropStaleLinks(before)
  } finally {
    history.endBatch(type)
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

/** Renaming a diagram instance: { id, name }. */
const renamingNode = ref(null)
const renameNodeError = computed(() => renamingNode.value && nameError(renamingNode.value.id, renamingNode.value.name))

async function onRenameNodeConfirm() {
  const { id, name } = renamingNode.value
  // A clash keeps the dialog open, as the diagram keeps its name field.
  if (await renameInstance(id, name)) return
  renamingNode.value = null
}

// ── Adding to a placed template ────────────────────────────────────────
/** How the edges a protein site can be added along read in the menu. */
const EDGE_LABELS = { top: 'Top', bottom: 'Bottom', left: 'Left', right: 'Right' }

/** Naming a compartment added to a placed template: { instance, against, label }. */
const naming = ref(null)

/** The template a placed instance draws, with its own changes. */
const placedTemplate = (instanceId) => {
  const instance = templateStore.getInstance(instanceId)
  return instance ? instanceTemplate(instance, templateStore.definitions) : null
}

/**
 * Adds an empty piece to one placed template, as one step, or says why it doesn't fit.
 *
 * @param {string} instanceId
 * @param {'facets'|'processes'|'compartments'} kind
 * @param {Object} piece - As in a template file, with `cell` for a facet or process.
 * @returns {Promise<boolean>|undefined}
 */
function addPiece(instanceId, kind, piece) {
  const instance = templateStore.getInstance(instanceId)
  const template = instance && templateStore.definitions.get(instance.template)
  if (!template) return
  const { edits, errors } = addToEdits(template, instance.edits ?? null, kind, piece)
  if (!edits) return notify.error({ title: 'Could not add it to the template', message: summariseProblems(errors) })
  return editTemplate(instanceId, edits)
}

function onNamingConfirm() {
  const { instance, against, label } = naming.value
  naming.value = null
  const template = placedTemplate(instance)
  if (!template) return
  const used = new Set(template.compartments.map((compartment) => compartment.tone))
  addPiece(instance, 'compartments', {
    id: freePieceId(template, 'compartment', undefined, templateStore.getInstance(instance)?.edits?.removed),
    label: label.trim() || 'Compartment',
    against: [against],
    tone: TONES.find((tone) => !used.has(tone)) ?? TONES[0],
  })
}

/** What can be added to a placed template's cell: a protein site on a free edge, a compartment, a process zone. */
function addToCellMenu(instanceId, cellId) {
  const template = placedTemplate(instanceId)
  const cell = template?.cells.find((entry) => entry.id === cellId)
  if (!cell) return []
  const free = EDGES.filter((edge) => !cell.facets.some((facet) => facet.edge === edge))
  const removed = templateStore.getInstance(instanceId)?.edits?.removed ?? []
  const zone = freePieceId(template, 'zone', cellId, removed)
  return [
    {
      label: 'Add Protein Site',
      icon: 'pi pi-plus',
      disabled: !free.length,
      items: free.map((edge) => ({
        label: EDGE_LABELS[edge],
        command: () =>
          addPiece(instanceId, 'facets', {
            cell: cellId,
            id: freePieceId(template, 'site', cellId, removed),
            label: `Protein site (${edge})`,
            edge,
          }),
      })),
    },
    {
      label: 'Add Compartment…',
      icon: 'pi pi-stop',
      items: cell.facets.map((facet) => ({
        label: facet.label,
        command: () => (naming.value = { instance: instanceId, against: `${cellId}.${facet.id}`, label: '' }),
      })),
    },
    {
      label: 'Add Process Zone',
      icon: 'pi pi-box',
      disabled: cell.processes.length >= LIMITS.processes,
      command: () =>
        addPiece(instanceId, 'processes', { cell: cellId, id: zone, label: `Process zone ${zone.split('-')[1]}` }),
    },
  ]
}

// ── Removing from a placed template ────────────────────────────────────
/**
 * Removes a piece from one placed template, as one step, asking first when modules are bound to it or to what
 * goes with it. They stay in the diagram: proteins go to the tray, the rest where their roles put them.
 *
 * @param {string} instanceId
 * @param {string} path - The piece's path in the template.
 * @param {string} label - What the piece is called.
 * @returns {Promise<void>}
 */
async function removePiece(instanceId, path, label) {
  const instance = templateStore.getInstance(instanceId)
  const template = instance && templateStore.definitions.get(instance.template)
  if (!template) return
  const { edits, errors } = removeFromEdits(template, instance.edits ?? null, path)
  if (errors.length) {
    notify.error({ title: `Could not remove ${label}`, message: summariseProblems(errors) })
    return
  }
  const stranded = strandedBy(instanceId, edits)
  if (stranded.length) {
    const names = stranded.map((node) => nameOf(node.id)).join(', ')
    isConfirming.value = true
    try {
      const answer = await choose({
        header: 'Remove from template?',
        message:
          `Modules are placed on ${label}: ${names}. They stay in the diagram, without the connections ` +
          'their places there made; proteins go to the tray.',
        severity: 'warning',
        acceptLabel: 'Remove',
        rejectLabel: 'Cancel',
      })
      if (answer !== 'accept') return
    } finally {
      isConfirming.value = false
    }
  }
  // The modules it strands lose the placement edges to the neighbours they had there, in the same step.
  const before = neighboursOf(stranded.map((node) => node.id))
  history.startBatch()
  try {
    if (await editTemplate(instanceId, edits, 'bio-template-remove-piece')) await dropStaleLinks(before)
  } finally {
    history.endBatch('bio-template-remove-piece')
  }
}

/** Brings back what was removed from a placed template, keeping what was added, as one step. */
function restorePieces(instanceId) {
  const instance = templateStore.getInstance(instanceId)
  const template = instance && templateStore.definitions.get(instance.template)
  if (!template) return
  const edits = normaliseEdits({ added: instance.edits?.added })
  const { errors } = editedTemplate(template, edits)
  if (errors.length) {
    notify.error({ title: 'Could not restore the removed elements', message: summariseProblems(errors) })
    return
  }
  editTemplate(instanceId, edits, 'bio-template-restore')
}

/** What can be removed from a placed template's piece: a compartment, or a cell or any of its parts. */
function removeFromTemplateMenu(instanceId, place) {
  const template = placedTemplate(instanceId)
  const remove = (path, label) => ({ label, command: () => removePiece(instanceId, path, label) })
  const item = { label: 'Remove from This Template', icon: 'pi pi-minus-circle' }
  if (place.kind === 'region') {
    const compartment = template?.compartments.find((entry) => entry.id === place.path)
    return compartment ? [{ ...item, command: remove(place.path, compartment.label).command }] : []
  }
  const cell = template?.cells.find((entry) => entry.id === place.path)
  if (!cell) return []
  const part = (piece) => remove(`${cell.id}.${piece.id}`, piece.label)
  return [
    {
      ...item,
      items: [
        remove(cell.id, `${cell.label} (whole cell)`),
        ...(cell.membrane ? [remove(`${cell.id}.${MEMBRANE}`, cell.membrane.label)] : []),
        ...cell.facets.map(part),
        ...cell.processes.map(part),
      ],
    },
  ]
}

// ── Template files ─────────────────────────────────────────────────────
const templateFileInput = ref(null)
/** Where a template loaded from a file goes, in flow coordinates. */
let templateFileAt = null

function loadTemplateFile(at) {
  templateFileAt = at
  templateFileInput.value?.click()
}

/** Adds the chosen template file to the user's templates and places it, or says what is wrong with it. */
async function onTemplateFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  const at = templateFileAt ?? { x: 0, y: 0 }
  const { raw, errors: parseErrors } = await readTemplateFile(file)
  const { template, errors, warnings } = parseErrors.length
    ? { template: null, errors: parseErrors, warnings: [] }
    : templateStore.addLocalTemplate(raw)
  if (!template) {
    notify.error({ title: `Could not load ${file.name}`, message: summariseProblems(errors) })
    return
  }
  placeTemplate(template.id, at)
  if (warnings.length) notify.warning({ title: `Loaded ${template.name}`, message: summariseProblems(warnings) })
}

/** Downloads a template as a file anyone can load. */
function saveTemplateFile(template) {
  const { filename, text } = templateFile(template)
  legacyDownload(filename, new Blob([text], { type: 'application/json' }))
}

/** The Add Template submenu: built-ins, then the user's own, then loading and removing theirs. */
function addTemplateMenu(at) {
  const place = (template) => ({ label: template.name, command: () => placeTemplate(template.id, at) })
  const builtIn = templateStore.library.filter((template) => !isLocalTemplateId(template.id))
  const own = templateStore.localTemplates
  return [
    ...builtIn.map(place),
    { separator: true },
    ...own.map(place),
    { label: 'Load Template File…', icon: 'pi pi-upload', command: () => loadTemplateFile(at) },
    ...(own.length
      ? [
          {
            label: 'Remove from My Templates',
            icon: 'pi pi-trash',
            items: own.map((template) => ({
              label: template.name,
              command: () => templateStore.removeLocalTemplate(template.id),
            })),
          },
        ]
      : []),
  ]
}

// ── Glyph libraries ────────────────────────────────────────────────────
const glyphFileInput = ref(null)

/** Adds the chosen glyph library file to the user's own, or says what is wrong with it. */
async function onGlyphFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  const { raw, errors: parseErrors } = await readTemplateFile(file, { what: 'a glyph library' })
  const { library, errors, warnings } = parseErrors.length
    ? { library: null, errors: parseErrors, warnings: [] }
    : glyphStore.addLocalLibrary(raw)
  if (!library) {
    notify.error({ title: `Could not load ${file.name}`, message: summariseProblems(errors) })
    return
  }
  const count = `${library.glyphs.length} cartoon${library.glyphs.length === 1 ? '' : 's'}`
  if (warnings.length) notify.warning({ title: `Loaded ${library.name}`, message: summariseProblems(warnings) })
  else notify.success({ title: `Loaded ${library.name}`, message: `${count} added to the Cartoon menu.` })
}

/** Downloads a glyph library as a file anyone can load. */
function saveGlyphFile(library) {
  const { filename, text } = glyphLibraryFile(library)
  legacyDownload(filename, new Blob([text], { type: 'application/json' }))
}

/** Loading, saving and removing the user's own glyph libraries. */
function glyphLibraryMenu() {
  const own = glyphStore.localLibraries
  const each = (icon, label, act) => ({
    label,
    icon,
    items: own.map((library) => ({ label: library.name, command: () => act(library) })),
  })
  return [
    { label: 'Load Glyph Library…', icon: 'pi pi-upload', command: () => glyphFileInput.value?.click() },
    ...(own.length
      ? [
          each('pi pi-download', 'Save Glyph Library As File…', saveGlyphFile),
          each('pi pi-trash', 'Remove Glyph Library', (library) => glyphStore.removeLocalLibrary(library.id)),
        ]
      : []),
  ]
}

/** The Cartoon submenu for a protein: the built-ins, then the loaded glyphs, then the libraries. */
function cartoonMenu(nodeId, chosen) {
  const item = (glyph) => ({
    label: glyph.name,
    icon: chosen === glyph.id ? 'pi pi-check' : undefined,
    command: () => {
      glyphStore.adoptGlyph(glyph.id)
      setChoice(nodeId, { glyph: glyph.id }, 'bio-glyph')
    },
  })
  const loaded = loadedGlyphs()
  return [
    ...BUILT_IN_GLYPHS.map(item),
    { separator: true },
    ...loaded.map(item),
    ...(loaded.length ? [{ separator: true }] : []),
    ...glyphLibraryMenu(),
  ]
}

/**
 * The menu items for the template instance a piece belongs to.
 *
 * @param {string} instanceId
 * @param {Object} [place] - The piece's place, for what can be added to it.
 * @returns {Array<Object>}
 */
function templateMenu(instanceId, place = null) {
  const instance = templateStore.getInstance(instanceId)
  if (!instance) return []
  const definition = placedTemplate(instanceId)
  const name = definition?.name ?? instance.template
  const isPiece = place?.instance === instanceId && !!place.path
  return [
    { separator: true },
    ...(place?.kind === 'cell' && isPiece ? addToCellMenu(instanceId, place.path) : []),
    ...(isPiece ? removeFromTemplateMenu(instanceId, place) : []),
    ...(instance.edits?.removed?.length
      ? [{ label: 'Restore Removed Elements', icon: 'pi pi-undo', command: () => restorePieces(instanceId) }]
      : []),
    ...(isPiece || instance.edits?.removed?.length ? [{ separator: true }] : []),
    {
      label: 'Rename Template…',
      icon: 'pi pi-pencil',
      command: () => (renaming.value = { id: instanceId, label: instance.label ?? '', placeholder: name }),
    },
    { label: 'Re-layout Template', icon: 'pi pi-th-large', command: () => relayoutTemplate(instanceId) },
    {
      label: 'Save Template As File…',
      icon: 'pi pi-download',
      disabled: !definition,
      command: () => saveTemplateFile(definition),
    },
    { label: 'Delete Template', icon: 'pi pi-trash', command: () => removeTemplate(instanceId) },
  ]
}

function onNodeContextMenu({ event, node }) {
  event.preventDefault()
  const instance = pieceOf(node.id) ?? (node.type === 'bioTemplateTitle' ? node.data.instance : null)
  // An empty template piece, or a template's name, is no diagram node: only its template's menu.
  const place = layout.value.get(node.id)
  if (!main.findNode(node.id)) {
    if (!instance) return
    const here = newModuleItem(event)
    menuItems.value = [...here, ...templateMenu(instance, place).slice(here.length ? 0 : 1)]
    contextMenu.value.show(event)
    return
  }
  const role = roles.value.get(node.id)
  // On a structure, a slot or empty site under the pointer can take a new module.
  const here = STRUCTURE_TYPES.has(node.type) ? newModuleItem(event) : []
  const items = [
    ...(here.length ? [...here, { separator: true }] : []),
    {
      label: 'Rename…',
      icon: 'pi pi-pencil',
      command: () => (renamingNode.value = { id: node.id, name: nameOf(node.id) }),
    },
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
      items: cartoonMenu(node.id, role.glyph),
    })
  }
  items.push(connectionsMenu(node.id, main.nodes.value, main.edges.value, (edgeId) => emit('open-edge-dialog', edgeId)))
  items.push(...primeMenuItems(props.parameterSetMenu?.(node.id) ?? [], { 'Apply Parameter Set': 'pi pi-sliders-h' }))
  if (role?.role === 'region' && !role.site) items.push(liesAgainstMenu(node.id, role))
  // Bound to a template site that is there: unbinding goes where its role puts it, a protein to the tray.
  const site = role?.site && place?.instance ? sites.value.find((entry) => entry.ref === role.site) : null
  const unbind = (type) =>
    takeOut(node.id, planUnbind({ id: node.id, position: trayPosition(), ...planContext() }), type)
  if (place?.kind === 'protein') {
    items.push({
      label: 'Take Out of Membrane',
      icon: 'pi pi-sign-out',
      command: () =>
        site
          ? unbind('bio-unbind')
          : takeOut(node.id, planUnplace({ id: node.id, position: trayPosition(), ...planContext() }), 'bio-take-out'),
    })
  }
  if (site) {
    items.push({ label: `Unbind from "${site.label}"`, icon: 'pi pi-link', command: () => unbind('bio-unbind') })
  }
  if (main.findNode(node.id)?.data?.bioView?.speciesOrder) {
    items.push({
      label: 'Reset Species Order',
      icon: 'pi pi-sort-alt',
      command: () => setChoice(node.id, { speciesOrder: undefined }, 'bio-species-order'),
    })
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
  items.push(
    { separator: true },
    {
      label: deletionLabel(node.id, main.nodes.value),
      icon: 'pi pi-trash',
      command: () => deleteNodes(deletionScope(node.id, main.nodes.value)),
    }
  )
  if (instance) items.push(...templateMenu(instance, place))
  menuItems.value = items
  contextMenu.value.show(event)
}

/**
 * Deletes instances from the workspace, with their edges, as the diagram's Delete does: one undo step.
 *
 * @param {Array<string>} ids - Diagram node ids.
 * @returns {Promise<boolean>} Whether anything was asked to go.
 */
const deleteNodes = (ids) =>
  deleteInstances(
    ids.filter((id) => main.findNode(id)),
    { removeNodes: main.removeNodes, history }
  )

/** Deletes the selected instances, for the workspace's Delete and Backspace keys. */
const deleteSelection = () => deleteNodes(main.nodes.value.filter((node) => node.selected).map((node) => node.id))

/** A shown connection's menu: delete it, as the diagram would. */
function onEdgeContextMenu({ event, edge }) {
  event.preventDefault()
  if (!props.disconnectInstances || !main.findEdge(edge.id)) return
  menuItems.value = [
    {
      label: 'Delete Connection',
      icon: 'pi pi-trash',
      command: () => deleteConnection(edge.id, { disconnectInstances: props.disconnectInstances, history }),
    },
  ]
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
      items: addTemplateMenu(at),
    },
    { label: 'Glyph Libraries', icon: 'pi pi-palette', items: glyphLibraryMenu() },
    ...(hasSpecies.value ? [{ label: 'Species Mode', icon: 'pi pi-share-alt', items: speciesMenu() }] : []),
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
  trackDrag(point, targetAt(point))
}

function onModuleDragLeave(event) {
  if (event.currentTarget.contains(event.relatedTarget)) return
  if (draggingId.value === 'library') draggingId.value = activeTarget.value = pointer.value = null
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
  const target = targetAt(point)
  draggingId.value = activeTarget.value = pointer.value = null

  if (target) {
    const { site } = target
    if (site && !(await confirmReplace(site, null, module.moduleRef?.split(':')[0] ?? 'the new module'))) return
    return addModuleAt(module, target)
  }
  const position = whole({ x: point.x - CARD.width / 2, y: point.y - CARD.height / 2 })
  // Adding it and saying what it is make one step, which Cancel takes back (see endAssign).
  history.startBatch()
  let id
  try {
    id = props.createInstance(module, { position })
    // Its module's annotations say what it most likely is, once read.
    await libraryStore.ensureModuleAnnotations(module.mathRef)
    await nextTick()
  } catch (error) {
    await history.rollbackBatch()
    throw error
  }
  placing.value = {
    mode: 'assign',
    id,
    at: point,
    name: main.findNode(id)?.data?.name ?? id,
    initialRole: roles.value.get(id)?.role ?? 'none',
  }
}

/**
 * Adds an instance of a library module on a template site, or in a node-owned cell's slot, membrane or inside,
 * joined to its neighbours there, as one step.
 *
 * @param {Object} module - A library module.
 * @param {{site: Object}|{slot: Object}|{area: Object}} target - From targetAt.
 * @returns {Promise<void>}
 */
async function addModuleAt(module, { site, slot, area }) {
  history.startBatch()
  try {
    if (area) {
      // A node-owned cell's membrane, or a process in it.
      const id = props.createInstance(module, { role: area.role, cell: area.cellId })
      await connectToCellNeighbours(id)
    } else if (site) {
      // An instance of the module, bound to the site; planned against the sites as they were drawn.
      const id = props.createInstance(module, { role: site.role, facet: null })
      await applyPlan(planSiteBind({ id, site, ...planContext() }), 'bio-add')
      await connectToNeighbours(id, site)
    } else {
      // Made outside any membrane first, so the slot is planned against the membranes as they were drawn.
      const id = props.createInstance(module, { role: 'membraneProtein', facet: null })
      await applyPlan(slotPlan(id, slot), 'bio-add')
      await connectToCellNeighbours(id)
    }
  } finally {
    history.endBatch('bio-add')
  }
}

/**
 * The "New Module Here" item, where the menu opened on an empty template site or a slot: it adds a new module
 * there, as a drop of one would. The first save of its maths makes it a module of its own.
 *
 * @param {MouseEvent} event - The menu's.
 * @returns {Array<Object>} The item, or none.
 */
function newModuleItem(event) {
  const module = libraryStore.availableModules.get(NEW_INSTANCE_MODULE_REF)
  if (!module || !props.createInstance) return []
  const target = targetAt(screenToFlowCoordinate({ x: event.clientX, y: event.clientY }))
  if (!target || (target.site && replacedOccupant(target.site, null))) return []
  return [{ label: 'New Module Here', icon: 'pi pi-file-plus', command: () => addModuleAt(module, target) }]
}

/**
 * Ends the step a dropped instance's dialog holds open: its choice applied, or, cancelled, the instance taken
 * away again so the drop leaves nothing.
 *
 * @param {Function|null} choose - Applies the choice; null cancels.
 * @returns {Promise<void>}
 */
async function endAssign(choose) {
  if (!choose) return history.rollbackBatch()
  try {
    await choose()
  } finally {
    history.endBatch('bio-add')
  }
}

/** Closes the placing dialog with nothing chosen. */
function onPlaceCancel() {
  const { mode } = placing.value ?? {}
  placing.value = null
  if (mode === 'assign') endAssign(null)
}

// A drop's dialog left open as the view goes leaves no half-made step.
onBeforeUnmount(() => {
  if (placing.value?.mode === 'assign') onPlaceCancel()
})

/** Whether one of the view's dialogs is open, so the workspace's shortcuts wait. */
const isDialogOpen = computed(
  () => !!placing.value || !!renaming.value || !!renamingNode.value || !!naming.value || isConfirming.value
)
defineExpose({ isDialogOpen, isMenuOpen, deleteSelection })

/** A new cell's rect, centred where it was put. */
const cellRectAt = (at) => ({ x: at.x - MIN_CELL.width / 2, y: at.y - MIN_CELL.height / 2, ...MIN_CELL })
/** A new compartment's rect, centred where it was put. */
const regionRectAt = (at) => ({ x: at.x - 160, y: at.y - REGION_HEIGHT / 2, width: 320, height: REGION_HEIGHT })

/** Applies the placing dialog: what a dropped instance is, or a new cell or compartment. */
async function onPlaceConfirm(choice) {
  const { mode } = placing.value
  if (mode === 'assign') {
    const { id, at } = placing.value
    placing.value = null
    return endAssign(async () => {
      await assignRole(id, at, choice)
      // Put on a node-owned cell, it joins its neighbours there in the same step.
      if (choice.cell || choice.placement) await connectToCellNeighbours(id)
    })
  }
  const { moduleRef, membraneRef, placement } = choice
  const { at } = placing.value
  placing.value = null
  if (mode === 'cell') {
    history.startBatch()
    try {
      const cellId = props.createInstance(libraryStore.availableModules.get(moduleRef), {
        role: 'cytosol',
        rect: cellRectAt(at),
        added: true,
      })
      if (membraneRef) {
        const membraneId = props.createInstance(libraryStore.availableModules.get(membraneRef), {
          role: 'membrane',
          cell: cellId,
        })
        await connectToCellNeighbours(membraneId)
      }
    } finally {
      history.endBatch()
    }
    return
  }
  if (mode === 'compartment') {
    props.createInstance(
      libraryStore.availableModules.get(moduleRef),
      placement ? { role: 'region', adjacent: [placement] } : { role: 'region', rect: regionRectAt(at) }
    )
  }
}

/**
 * Applies what a dropped instance is, as chosen in the placing dialog.
 *
 * @param {string} id
 * @param {{x: number, y: number}} at - Where it was dropped.
 * @param {Object} choice - From the dialog: role, cell and placement.
 * @returns {Promise<boolean>}
 */
function assignRole(id, at, { role, cell, placement }) {
  const cellRect = cellRectAt(at)
  const regionRect = regionRectAt(at)
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

/* Each piece draws its own selection: no dark-theme ring round its box, which for a membrane is the whole cell's */
.bio-flow :deep(.vue-flow__node.selected) {
  box-shadow: none;
}

/* Species mode: over the cells and regions (-10, -20), under the proteins and their names; only its tokens are hit */
.bio-species {
  position: absolute;
  z-index: -5;
  overflow: visible;
  pointer-events: none;
}

.bio-species-path > path {
  fill: none;
  stroke: var(--species);
  stroke-linecap: round;
  stroke-dasharray: 2 6;
  opacity: 0.55;
}

/* A path whose flow is known after a run: solid, with its dashes running the way the species goes; square ends, so
   none pokes past the base of its arrowhead. The dashes run a few times when the flow is shown, then rest on the
   arrowheads: an endless dash animation repaints the view every frame (Firefox can't run it off the main thread).
   A focused species' paths keep running. */
.bio-species-path--moving > path {
  stroke-linecap: butt;
  stroke-dasharray: 10 6;
  opacity: 0.9;
  animation: bio-species-flow 1.2s linear 4;
}

.bio-species-path--focused > path {
  animation-iteration-count: infinite;
}

/* No dashes run while the view is panned (paths hide while a node is dragged). */
.vue-flow__pane.dragging .bio-species-path--moving > path {
  animation-play-state: paused;
}

@keyframes bio-species-flow {
  to {
    stroke-dashoffset: -16;
  }
}

@media (prefers-reduced-motion: reduce) {
  .bio-species-path--moving > path {
    animation: none;
  }
}

/* A dependence: fainter than a path, its circle open; it firms up while its species is focused */
.bio-species-dependence path,
.bio-species-dependence circle {
  stroke: var(--species);
  stroke-width: 1.25;
  opacity: 0.45;
}

.bio-species-dependence path {
  fill: none;
  stroke-dasharray: 3 3;
}

.bio-species-dependence circle {
  fill: var(--p-content-background);
}

.bio-species-dependence--focused path,
.bio-species-dependence--focused circle {
  stroke-width: 2;
  opacity: 0.95;
}

.bio-species-token {
  pointer-events: auto;
  cursor: pointer;
}

.bio-species-token rect {
  fill: color-mix(in srgb, var(--species) 16%, var(--p-content-background));
  stroke: var(--species);
  stroke-width: 1.5;
}

.bio-species-token text {
  fill: var(--p-text-color);
  font-size: 12px;
  font-weight: 600;
  user-select: none;
}

.bio-species-token--dragging {
  cursor: grabbing;
  opacity: 0.85;
}

/* While a chip is dragged, the others slide to where its drop would put them */
.bio-species--reordering .bio-species-token:not(.bio-species-token--dragging) {
  transition: transform 0.15s ease-out;
}

@media (prefers-reduced-motion: reduce) {
  .bio-species--reordering .bio-species-token:not(.bio-species-token--dragging) {
    transition: none;
  }
}

.bio-species-token:hover rect,
.bio-species-token--focused rect {
  stroke-width: 3;
}

.bio-species-token--focused rect {
  fill: color-mix(in srgb, var(--species) 32%, var(--p-content-background));
}

/* While a species is focused, the others step back */
.bio-species--dimmed {
  opacity: 0.2;
}

.bio-species-toggle--on {
  color: var(--p-primary-color);
  background: color-mix(in srgb, var(--p-primary-color) 14%, transparent);
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

.bio-slot-prompt rect {
  fill: color-mix(in srgb, var(--p-primary-color) 8%, transparent);
  stroke: var(--p-primary-color);
  stroke-width: 1.5;
  stroke-dasharray: 6 4;
  opacity: 0.55;
}

.bio-slot-prompt__plus {
  fill: none;
  stroke: var(--p-primary-color);
  stroke-width: 2.5;
  stroke-linecap: round;
}

.bio-slot-prompt--active .bio-slot-prompt__plus {
  stroke: var(--bio-drop-active);
}

.bio-site-prompt rect,
.bio-site-prompt path {
  fill: none;
  stroke: var(--p-primary-color);
  stroke-width: 1.5;
  stroke-dasharray: 8 5;
  opacity: 0.45;
}

/* A cell's membrane is a striped band along its outline, as wide as a drop on it reaches (set inline) */
.bio-site-prompt--membrane path {
  stroke-dasharray: 3 3;
  opacity: 0.35;
}

/* A cell's inside is a tint within the membrane's band */
.bio-site-prompt--cell path {
  fill: color-mix(in srgb, var(--p-primary-color) 6%, transparent);
  stroke-width: 1;
  stroke-dasharray: 4 4;
}

/* The one the drop goes to: solid, in a colour of its own */
.bio-slot-prompt--active rect,
.bio-site-prompt--active rect,
.bio-site-prompt--active path {
  fill: color-mix(in srgb, var(--bio-drop-active) 14%, transparent);
  stroke: var(--bio-drop-active);
  stroke-width: 3;
  stroke-dasharray: none;
  opacity: 1;
}

.bio-site-prompt--membrane.bio-site-prompt--active path {
  fill: none;
  opacity: 0.6;
}

.bio-site-prompt--cell.bio-site-prompt--active path {
  stroke-width: 2;
  stroke-dasharray: 6 4;
}

/* The drop's own target, in green: adding goes here. The workspace places the root absolutely, so the drop label
   is placed in it. */
.bio-flow-root {
  --bio-drop-active: var(--p-green-600);
}

.bio-drop-label {
  position: absolute;
  z-index: 10;
  max-width: 360px;
  padding: 4px 8px;
  border: 1px solid var(--bio-drop-active);
  border-radius: 6px;
  background: var(--p-content-background);
  color: var(--p-text-color);
  font-size: 12px;
  line-height: 1.4;
  pointer-events: none;
  box-shadow: 0 2px 6px rgb(0 0 0 / 15%);
}

.bio-rename-error {
  color: var(--p-red-500);
}

.bio-drop-label__replace {
  font-style: italic;
  color: var(--p-text-muted-color);
}
</style>

<style>
.p-dark .bio-flow-root {
  --bio-drop-active: var(--p-green-400);
}
</style>
