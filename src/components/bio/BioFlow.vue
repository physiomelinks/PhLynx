<template>
  <!-- One root, so the class the workspace gives it (its place over the diagram) lands -->
  <div
    :class="['bio-flow-root', { 'bio-flow-root--dragging': draggingId, 'bio-flow-root--placing': armedTile }]"
    @click.capture="onArmedClick"
    @pointermove="onArmedMove"
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
      <FlowMiniMap :pannable="true" :zoomable="true" class="mini-map" />
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
        <!-- Beside the species button, which is the last of the column -->
        <ControlButton
          v-if="hasSpecies && isSpeciesOn"
          class="bio-species-menu-button"
          title="Choose which species are shown"
          aria-haspopup="dialog"
          data-testid="bio-species-menu-button"
          @click="speciesMenuRef?.toggle($event)"
        >
          <i class="pi pi-angle-right"></i>
        </ControlButton>
      </Controls>
      <SpeciesMenu
        ref="speciesMenuRef"
        :species="menuSpecies"
        :hidden="viewMode.hiddenSpecies"
        :scope="viewMode.speciesScope"
        @update:hidden="setHiddenSpecies"
        @update:scope="setSpeciesScope"
      />
      <template #zoom-pane>
        <!-- Species mode: each compartment's species, and the paths they take through proteins; only tokens are hit -->
        <svg
          v-if="drawnSpecies && !draggingId"
          :class="[
            'bio-species',
            { 'bio-species--reordering': draggingChip, 'bio-species--continuous': settings.speciesFlowContinuous },
          ]"
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
            <path
              v-for="(d, side) in path.legs"
              :key="side"
              class="bio-species-leg"
              :d="d"
              :stroke-width="path.width"
            />
            <!-- Arrowheads, sized to its width, running with the dashes but spaced further apart -->
            <template v-if="path.head">
              <template v-for="(d, side) in path.legs" :key="`arrows-${side}`">
                <path
                  v-for="arrow in arrowsAlong(d, path.head)"
                  :key="arrow"
                  class="bio-species-arrow"
                  :d="arrowShape(path.head)"
                  :style="arrowStyle(d, path.head, arrow)"
                />
              </template>
            </template>
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
              {{
                `${token.label} in ${nameOf(token.nodeId)}${concentrationText(
                  token
                )}: click to plot it and the flows into it, drag to reorder`
              }}
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
            :class="[
              'bio-site-prompt',
              `bio-site-prompt--${prompt.area}`,
              { 'bio-site-prompt--active': prompt.active },
            ]"
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
        <!-- While a piece is carried: what it would go on, and where it would be drawn -->
        <svg v-if="piecePreview" class="bio-piece-preview" data-testid="bio-piece-preview">
          <template v-for="(mark, index) in piecePreview.highlights" :key="`target-${index}`">
            <line
              v-if="mark.type === 'line'"
              class="bio-piece-preview__target bio-piece-preview__target--line"
              :x1="mark.from.x"
              :y1="mark.from.y"
              :x2="mark.to.x"
              :y2="mark.to.y"
            />
            <rect v-else class="bio-piece-preview__target" v-bind="mark.rect" rx="12" />
          </template>
          <template v-for="(ghost, index) in piecePreview.ghosts" :key="`ghost-${index}`">
            <polyline
              v-if="ghost.type === 'path'"
              class="bio-piece-preview__way"
              :points="ghost.points.map((point) => `${point.x},${point.y}`).join(' ')"
            />
            <!-- A compartment or cell already there, grown to fit what is added: the room it gains, its new outline -->
            <g v-else-if="ghost.type === 'grows'" data-testid="bio-piece-ghost-grown" :data-kind="ghost.kind">
              <mask :id="`bio-ghost-grown-${index}`" maskUnits="userSpaceOnUse" v-bind="EVERYWHERE">
                <path :d="roundedRectPath(ghost.rect, cornerOf(ghost))" fill="white" />
                <path :d="roundedRectPath(ghost.was, cornerOf(ghost))" fill="black" />
              </mask>
              <rect class="bio-piece-preview__grows" v-bind="ghost.rect" :mask="`url(#bio-ghost-grown-${index})`" />
              <path class="bio-piece-preview__outline" :d="roundedRectPath(ghost.rect, cornerOf(ghost))" />
            </g>
            <!-- A compartment or cell pushed out of the way of one that grows: where it goes -->
            <path
              v-else-if="ghost.type === 'moves'"
              class="bio-piece-preview__moved"
              :d="roundedRectPath(ghost.rect, cornerOf(ghost))"
              data-testid="bio-piece-ghost-moved"
              :data-kind="ghost.kind"
            />
            <!-- A membrane round what is there: the room the cell adds, the corners it rounds off, and its band -->
            <g v-else-if="ghost.was" data-testid="bio-piece-ghost" :data-kind="ghost.kind" :data-grows="ghost.grows">
              <mask :id="`bio-ghost-grows-${index}`" maskUnits="userSpaceOnUse" v-bind="EVERYWHERE">
                <path :d="roundedRectPath(ghost.rect, CELL_RADIUS)" fill="white" />
                <rect v-bind="ghost.was" rx="12" fill="black" />
              </mask>
              <mask :id="`bio-ghost-trims-${index}`" maskUnits="userSpaceOnUse" v-bind="EVERYWHERE">
                <rect v-bind="ghost.was" rx="12" fill="white" />
                <path :d="roundedRectPath(ghost.rect, CELL_RADIUS)" fill="black" />
              </mask>
              <rect
                class="bio-piece-preview__grows"
                v-bind="ghost.rect"
                :mask="`url(#bio-ghost-grows-${index})`"
                data-testid="bio-piece-ghost-grows"
              />
              <rect
                class="bio-piece-preview__trims"
                v-bind="ghost.was"
                rx="12"
                :mask="`url(#bio-ghost-trims-${index})`"
                data-testid="bio-piece-ghost-trims"
              />
              <path
                class="bio-piece-preview__band"
                :d="roundedRectPath(ghost.rect, CELL_RADIUS)"
                :style="{ strokeWidth: 2 * MEMBRANE_BAND_HALF }"
              />
              <path class="bio-piece-preview__outline" :d="roundedRectPath(ghost.rect, CELL_RADIUS)" />
            </g>
            <rect
              v-else
              :class="['bio-piece-preview__ghost', `bio-piece-preview__ghost--${ghost.kind}`]"
              v-bind="ghost.rect"
              :rx="ghost.kind === 'cell' ? CELL_RADIUS : 10"
              data-testid="bio-piece-ghost"
              :data-kind="ghost.kind"
            />
          </template>
        </svg>
      </template>
      <template #edge-bioCoupling="props">
        <BioCouplingEdge v-bind="props" />
      </template>
      <template #node-bioCell="props">
        <BioCell
          :id="props.id"
          :data="props.data"
          :selected="props.selected"
          :width="props.data.width"
          :height="props.data.height"
        />
      </template>
      <template #node-bioMembrane="props">
        <BioMembrane :data="props.data" :selected="props.selected" />
      </template>
      <template #node-bioRegion="props">
        <BioRegion :id="props.id" :data="props.data" :selected="props.selected" />
      </template>
      <template #node-bioLink="props">
        <BioLink :data="props.data" :selected="props.selected" />
      </template>
      <template #node-bioJoint="props">
        <BioJoint :id="props.id" :data="props.data" :selected="props.selected" />
      </template>
      <template #node-bioProtein="props">
        <BioProtein :data="props.data" :selected="props.selected" />
      </template>
      <template #node-bioCard="props">
        <BioCard :data="props.data" :selected="props.selected" />
      </template>
      <template #node-bioZone="props">
        <BioZone :id="props.id" :data="props.data" :selected="props.selected" />
      </template>
      <template #node-bioGrip="props">
        <BioGrip :data="props.data" />
      </template>
    </VueFlow>
    <!-- Species mode after a run: play its flows through the run, or scrub to a point of it -->
    <SpeciesPlaybackBar v-if="isSpeciesOn && species" />
    <div
      v-if="pointerLabel"
      class="bio-drop-label"
      data-testid="bio-drop-label"
      :style="{ left: `${pointerLabel.left}px`, top: `${pointerLabel.top}px` }"
    >
      <div>{{ pointerLabel.text }}</div>
      <div v-if="pointerLabel.replace" class="bio-drop-label__replace">{{ pointerLabel.replace }}</div>
    </div>
    <div
      v-if="pieceLabel"
      :class="['bio-drop-label', { 'bio-drop-label--invalid': pieceLabel.invalid }]"
      data-testid="bio-piece-drop-label"
      :style="{ left: `${pieceLabel.left}px`, top: `${pieceLabel.top}px` }"
    >
      <div>{{ pieceLabel.text }}</div>
      <div v-if="pieceLabel.note" class="bio-drop-label__replace" data-testid="bio-piece-drop-note">
        {{ pieceLabel.note }}
      </div>
    </div>
    <ContextMenu ref="contextMenu" :model="menuItems" @show="isMenuOpen = true" @hide="isMenuOpen = false">
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
      ref="skinFileInput"
      type="file"
      accept=".svg,image/svg+xml"
      hidden
      data-testid="bio-skin-file-input"
      @change="onSkinFile"
    />
    <input
      ref="skinLibraryInput"
      type="file"
      accept=".json,application/json"
      hidden
      data-testid="bio-skin-library-input"
      @change="onSkinLibraryFile"
    />
    <Dialog
      v-if="renaming"
      :visible="true"
      modal
      header="Rename Piece"
      :style="{ width: '360px' }"
      class="compact-dialog"
      data-testid="bio-piece-rename"
      @update:visible="(visible) => !visible && (renaming = null)"
    >
      <InputText
        v-model="renaming.label"
        class="w-full"
        autofocus
        :placeholder="renaming.placeholder"
        data-testid="bio-piece-rename-input"
        @keydown.enter="onRenameConfirm"
      />
      <template #footer>
        <Button label="Cancel" severity="secondary" text @click="renaming = null" />
        <Button label="Rename" data-testid="bio-piece-rename-confirm" @click="onRenameConfirm" />
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
  </div>
</template>

<script setup>
import { storeToRefs } from 'pinia'
import { computed, nextTick, onBeforeUnmount, onMounted, provide, ref, shallowRef, watch } from 'vue'
import { VueFlow, useVueFlow } from '@vue-flow/core'
import { Background } from '@vue-flow/background'
import { ControlButton, Controls } from '@vue-flow/controls'
import FlowMiniMap from '../FlowMiniMap.vue'
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
import BioLink from './BioLink.vue'
import BioJoint from './BioJoint.vue'
import BioZone from './BioZone.vue'
import BioGrip from './BioGrip.vue'
import SpeciesMenu from './SpeciesMenu.vue'
import SpeciesPlaybackBar from './SpeciesPlaybackBar.vue'
import SanitisedInput from '../SanitisedInput.vue'
import { useBioNodes } from '../../composables/useBioNodes'
import { useBioEdits } from '../../composables/useBioEdits'
import {
  STRUCTURE_TYPES,
  dropSites,
  nearestSite,
  neighbourNodes,
  replacedOccupant,
  patchBioView,
  planRelayout,
  planSiteBind,
  planUnbind,
  whole,
} from '../../services/bioView/drop'
import { speciesFocus } from '../../services/bioView/species'
import { chipOrder, driftSpecies, legArrows } from '../../services/bioView/speciesLayout'
import { deleteConnection, deleteInstances, deletionLabel, deletionScope } from '../../services/bioView/deletion'
import { connectionsMenu } from '../../services/bioView/connections'
import { primeMenuItems } from '../../services/bioView/menus'
import { SKIN_ASPECT, SKIN_LIMITS, SKIN_MODES, skinHref } from '../../services/bioView/skins'
import { PIECES_INSTANCE, layoutPieces, pieceSiteRef } from '../../services/bioView/pieces/layout'
import { topologyOf } from '../../services/bioView/pieces/topology'
import { stampTemplate } from '../../services/bioView/pieces/stamp'
import {
  compartmentAtPoint,
  dropScene,
  previewDrop,
  resolveDrop,
  resolveExtraDock,
  resolveTubeEnd,
} from '../../services/bioView/pieces/drops'
import { relabelPiece, removeDock, removePieces, skinPiece } from '../../services/bioView/pieces/edits'
import {
  bendTube,
  fitToContents,
  moveFold,
  moveFrame,
  resizeFrame,
  reachTo,
  slideDock,
} from '../../services/bioView/pieces/moves'
import { PIECES_SCHEMA_VERSION } from '../../services/bioView/pieces/constants'
import { validatePieces } from '../../services/bioView/pieces/model'
import { useBioPiecesStore } from '../../stores/bioPiecesStore'
import { TILE_DRAG_TYPE } from '../../services/bioView/palette'
import { isLocalTemplateId } from '../../services/bioView/localIds'
import { parseSiteRef } from '../../services/bioView/siteRefs'
import { contextOfPiece } from '../../services/bioView/skinContext'
import { NO_SKIN, allSkins, allowsNoSkin, resolveSkin, skinsFor } from '../../services/bioView/skinRegistry'
import { skinLibraryFile } from '../../services/bioView/skinLibrary'
import { SYMBOL_HEIGHT, SYMBOL_WIDTH, MEMBRANE_BAND_HALF, roundedRectPath } from '../../services/bioView/geometry'
import { readTemplateFile, summariseProblems, templateFile } from '../../services/bioView/templateFiles'
import { dropLabel, hasPorts, siteLabel, siteLinks, staleLinks } from '../../services/bioView/links'
import { isPlaceholder, placeholderName, takesPlaceholder } from '../../services/bioView/placeholders'
import { CARD, GAP, processSize } from '../../services/bioView/layout'
import { CELL_RADIUS } from '../../services/bioView/metrics'
import useDragAndDrop from '../../composables/useDnD'
import { useConfirmDialog } from '../../composables/useConfirmDialog'
import { useAppSettings } from '../../composables/useAppSettings'
import { useBioTemplateLibraryStore } from '../../stores/bioTemplateLibraryStore'
import { useSkinLibraryStore } from '../../stores/skinLibraryStore'
import { useFlowHistoryStore } from '../../stores/historyStore'
import { useLibraryStore } from '../../stores/libraryStore'
import { useViewModeStore } from '../../stores/viewModeStore'
import { useVoiCursorStore } from '../../stores/voiCursorStore'
import { BACKGROUND_DOTS, FLOW_IDS, NEW_INSTANCE_MODULE_REF } from '../../utils/constants'
import { notify } from '../../utils/notify'
import { legacyDownload } from '../../utils/save'
import { sanitiseName } from '../../utils/identifiers'

const props = defineProps({
  /** Adds an instance of a library module with this bioView, and gives its node id (see WorkspaceView). */
  createInstance: { type: Function, default: null },
  /** Joins pairs of instances, [{ source, target }], with label-matched edges, in the current step. */
  connectInstances: { type: Function, default: null },
  /** Removes edges by id, in the current step, re-deriving the couplings left at their ends (see WorkspaceView). */
  disconnectInstances: { type: Function, default: null },
  /** Gives an instance's "Apply Parameter Set" submenu as the diagram's node menu builds it (see WorkspaceView). */
  parameterSetMenu: { type: Function, default: null },
  /** How the view is fitted, as the diagram's is: clear of the library panel over its left. */
  fitViewParams: { type: Object, default: () => ({ padding: 0.15 }) },
})

const emit = defineEmits(['open-instance-editor', 'open-edge-dialog', 'export-image'])

/** How near, in flow units, a dragged protein's centre must come to a slot to snap to it. */
const SNAP_DISTANCE = 60

// The diagram's flow is the one source of truth: selection and edits go there, and this view follows.
// Only this component, outside the bio <VueFlow>, reaches the main flow, so its nodes' handles never do.
const main = useVueFlow(FLOW_IDS.MAIN)
// The library's drag state; called before the bio flow's store, as it reaches for the main one.
const libraryDrag = useDragAndDrop()
const history = useFlowHistoryStore()
const libraryStore = useLibraryStore()
const templateLibrary = useBioTemplateLibraryStore()
const piecesStore = useBioPiecesStore()
const skinStore = useSkinLibraryStore()
const { choose } = useConfirmDialog()
const {
  applyNodeChanges,
  findNode,
  fitView,
  getSelectedNodes,
  onMoveStart,
  screenToFlowCoordinate,
  setViewport,
  updateNodeInternals,
  viewport,
  vueFlowRef,
} = useVueFlow(FLOW_IDS.BIO)
const viewMode = useViewModeStore()
const { settings, saveAppSettings } = useAppSettings()
/** Whether species mode is on: an app setting, remembered as it was last left here. */
const isSpeciesOn = computed(() => settings.speciesOverlay)
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
    hidden: viewMode.hiddenSpecies,
    keep: keptSpecies.value ? { nodeId, species: curie } : null,
  }
})
const cursor = useVoiCursorStore()
/** The point of the latest run species mode shows, once its cursor has been moved off the run's end. */
const voiCursor = computed(() => (cursor.isActive ? { index: cursor.index, range: cursor.range } : null))
const {
  bioNodes,
  concentrationTint,
  couplingEdges,
  layout,
  roles,
  sites,
  pieceLayoutOptions,
  hasSpecies,
  species,
  speciesOrderPreview,
  loadSidecars,
} = useBioNodes(main.nodes, main.edges, {
  speciesMode,
  voiCursor,
  flowScale: computed(() => cursor.flowScale),
  focusedSpecies: computed(() => viewMode.focusedSpecies),
  tintMode: computed(() => cursor.concentrationScale),
})
const { applyPlan, placePiecesTemplate, editPieces, strandedBy, nameError, renameInstance } = useBioEdits()

onMounted(() => loadSidecars())

// vue-flow measures a node's handles when they mount, so a node whose handles change (a selection's
// couplings come and go) is measured again, or its lines would keep to the old points. So is one whose
// parent changes, as a piece's key does when a module binds to it or leaves it.
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
    .map(
      (node) => `${Math.round(node.position.x)},${Math.round(node.position.y)},${node.width ?? ''},${node.height ?? ''}`
    )
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

// ── Dragging into a membrane or onto a site of the pieces ──────────────
const draggingId = ref(null)
// A selection's coupling lines end where things were laid out, so they wait for a drag to end.
const shownCouplings = computed(() => (draggingId.value ? [] : couplingEdges.value))
/** Where the drag would go: { site } of the pieces. */
const activeTarget = ref(null)
const siteTargets = computed(() => dropSites(sites.value, draggingId.value))

/**
 * Finds where a point drops on the pieces: a slot, else the area holding it (see nearestSite).
 *
 * @param {{x: number, y: number}} point
 * @param {{ membrane?: boolean }} [options] - For nearestSite.
 * @returns {{site: Object}|null}
 */
function targetAt(point, options) {
  const site = nearestSite(siteTargets.value, point, SNAP_DISTANCE, options)
  return site ? { site } : null
}

/** Names a node for a prompt. */
const nameOf = (id) => main.findNode(id)?.data?.name ?? id

/** Where the drag is, in flow coordinates, for the label that follows it. */
const pointer = ref(null)

/** Says which drop target a target is, so the same one found again on the next frame is known as the same. */
function targetKey(target) {
  if (!target) return ''
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

/**
 * The sites of the pieces next to a site, which a module dropped there connects to: the topology's neighbours.
 *
 * @param {Object} site - A drop target.
 * @returns {Array<{ref: string, relation: string}>}
 */
function neighbourSites(site) {
  const parsed = parseSiteRef(site.ref)
  if (parsed?.instance !== PIECES_INSTANCE || !piecesStore.pieces.length) return []
  return topologyOf(piecesStore.pieces)
    .neighbours(parsed.path)
    .map(({ path, relation }) => ({ ref: pieceSiteRef(path), relation }))
}

/** The nodes a node dropped on a site connects to: those on the sites next to it not joined to it yet. */
const neighboursAt = (site, id) =>
  neighbourNodes(siteTargets.value, neighbourSites(site), { id, edges: main.edges.value })

/**
 * Joins a node just bound to a site of the pieces to the nodes on the sites next to it, in the current step, by the
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
 * Every node a node lies next to where it is placed now, joined to it or not: those on the sites next to its
 * site of the pieces.
 *
 * @param {string} id
 * @returns {Array<string>}
 */
function placedNeighbours(id) {
  const place = layout.value.get(id)
  if (!place?.instance || !place.site) return []
  return neighbourNodes(siteTargets.value, neighbourSites({ ref: place.site }), { id }).map((n) => n.id)
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
  // A placeholder is there to be replaced, so it goes without asking (see addModuleAt and settleNodeDrag).
  if (!occupant || isPlaceholder(main.findNode(occupant), main.edges.value)) return true
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

/** The piece a site belongs to, 'pieces/<piece>', so prompts show only its sites. */
function pieceOfRef(ref) {
  const parsed = parseSiteRef(ref)
  return parsed ? `${parsed.instance}/${parsed.path.split('.')[0]}` : null
}

/** The piece a drop target's site is drawn on: a site of the pieces names its group, the place drawing it. */
const groupOf = (target) => (target.group ? `group ${target.group}` : pieceOfRef(target.ref))

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
  const symbol = { width: SYMBOL_WIDTH, height: SYMBOL_HEIGHT }
  const piece = active?.site ? groupOf(active.site) : null
  if (!piece) return empty
  const slots = []
  const areas = []
  // A process area's row is prompted by its slots alone: a drop on the row goes last, so its spare slot is marked.
  const toRow = active.site.type === 'area' && active.site.area === 'process'
  const isActive = ({ ref, type, order, spare }) =>
    active.site.ref === ref &&
    (toRow ? type === 'slot' && spare : active.site.type === type && active.site.order === order)
  for (const target of siteTargets.value) {
    if (groupOf(target) !== piece) continue
    if (target.type === 'slot') {
      const size = target.role === 'cytosolic' ? processSize(target) : symbol
      const { ref, x, y, order, spare } = target
      slots.push({ key: `${ref}#${order}`, ref, x, y, spare, ...size, active: isActive(target) })
      continue
    }
    if (target.area === 'process') continue
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
  const site = activeTarget.value?.site
  if (!draggingId.value || !site) return null
  const id = draggingId.value === 'library' ? null : draggingId.value
  const labels = new Map(siteTargets.value.map((target) => [target.ref, target.label]))
  // A library module, or the new one the Module tile adds.
  const dragged = id ? main.findNode(id)?.data : libraryDrag.draggedType.value
  // A library module's annotated ports are only made when it is added.
  const isPorted = (data) => hasPorts(data) || (!id && !!libraryStore.getModuleAnnotations(data?.mathRef))
  const text = dropLabel(
    siteLabel(site, nameOf),
    { name: id ? nameOf(id) : dragged?.moduleRef?.split(':')[0] ?? 'the module', hasPorts: isPorted(dragged) },
    neighboursAt(site, id).map(({ id: other, ref }) => ({
      label: labels.get(ref) ?? ref,
      name: nameOf(other),
      hasPorts: hasPorts(main.findNode(other)?.data),
    }))
  )
  const replaced = replacedOccupant(site, id)
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
 * Snaps a dragged node's position to the nearest slot of the pieces, and remembers where it would go for the drop:
 * a slot, or an area, which it doesn't snap to.
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
  const slot = target?.site?.type === 'slot' ? target.site : null
  if (slot)
    change.position = {
      x: slot.x - width / 2 - offset.x,
      y: slot.y - height / 2 - offset.y,
    }
}

function onNodesChange(changes) {
  // A piece being moved or resized is laid out from its draft, not where the drag or resizer would put its node.
  changes = changes.filter((change) => !takesPieceChange(change))
  // A membrane is drawn on its cell's outline and never dragged.
  changes = changes.filter((change) => change.type !== 'position' || findNode(change.id)?.type !== 'bioMembrane')
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

/** The context every plan reads: the layout as drawn, the roles and the bioViews. */
const planContext = () => ({ layout: layout.value, roles: roles.value, bioViews: bioViews() })

/** Where each dragged node started, so a drop the user cancels puts it back. */
const dragStarts = new Map()

/** Where a drag's pointer is, in flow coordinates. */
function pointerAt(event) {
  const point = event?.touches?.[0] ?? event?.changedTouches?.[0] ?? event
  return Number.isFinite(point?.clientX) ? screenToFlowCoordinate({ x: point.clientX, y: point.clientY }) : null
}

function onNodeDragStart({ event, node, nodes }) {
  dragStarts.clear()
  for (const moved of nodes) dragStarts.set(moved.id, { ...moved.position })
  // A piece, or a grip on one, moves as its own drag says; a module moves alone.
  startPieceMove(node, event)
}

/** Follows a piece's drag as it goes. */
function onNodeDrag({ event }) {
  if (!pieceMove) return
  const pointer = pointerAt(event)
  if (pointer) followPiece(pointer)
}

/** Puts dragged nodes back where their drag started. */
function putBack(nodes) {
  const changes = nodes
    .filter((node) => dragStarts.has(node.id))
    .map((node) => ({ id: node.id, type: 'position', position: dragStarts.get(node.id), dragging: false }))
  applyNodeChanges(changes)
}

/**
 * Keeps dragged nodes where they were put: on a site of the pieces, out of one, or just moved. A node bound to a site is joined to the nodes on the sites next to it in that step too, once the user
 * agrees to any replace. The pieces themselves move through their own drags (see startPieceMove).
 */
async function onNodeDragStop(event) {
  if (pieceMove) return endPieceMove(event)
  try {
    await settleNodeDrag(event)
  } finally {
    // The species keep where the drag left them until the layout they follow has caught up, so they never jump.
    await nextTick()
    speciesDrift.value = null
  }
}

async function settleNodeDrag({ nodes }) {
  const target = activeTarget.value
  const dropped = draggingId.value
  draggingId.value = null
  activeTarget.value = null
  pointer.value = null

  const plan = new Map()
  // The nodes that leave their place, whose placement edges to the neighbours they leave go.
  const relocated = []
  const add = (entries) => entries.forEach((bioView, id) => plan.set(id, bioView))
  const positionOf = (moved) => {
    const node = findNode(moved.id) ?? moved
    return node.computedPosition ?? node.position
  }
  const binds = !!target?.site && nodes.some((moved) => moved.id === dropped)
  if (binds && !(await confirmReplace(target.site, dropped, nameOf(dropped)))) return putBack(nodes)
  // A placeholder on the site goes, for the node dropped there to take its place.
  const replaced = binds ? replacedOccupant(target.site, dropped) : null
  const placeholder = replaced && isPlaceholder(main.findNode(replaced), main.edges.value) ? replaced : null

  for (const moved of nodes) {
    const at = positionOf(moved)
    const place = layout.value.get(moved.id)
    if ((moved.id === dropped && target?.site) || place?.instance) relocated.push(moved.id)
    if (moved.id === dropped && target?.site) {
      add(planSiteBind({ id: moved.id, site: target.site, ...planContext() }))
    } else if (place?.instance) {
      // Out of its site, to where it was dropped.
      add(planUnbind({ id: moved.id, position: { x: at.x, y: at.y }, ...planContext() }))
    } else if (!place?.piece) {
      // A loose module stays where it was put; a piece moves only by its own drag (see startPieceMove).
      plan.set(moved.id, patchBioView(main.findNode(moved.id)?.data?.bioView, { position: whole(at) }))
    }
  }
  const before = neighboursOf(relocated)
  if (!binds && !before.size) return applyPlan(plan, 'bio-layout')
  // Out of the places they left, and onto a site of the pieces joined to the neighbours there, in the same step.
  history.startBatch()
  try {
    if (placeholder) main.removeNodes([placeholder], true)
    if (await applyPlan(plan, 'bio-layout')) {
      await dropStaleLinks(before)
      if (binds) await connectToNeighbours(dropped, target.site)
    }
  } finally {
    history.endBatch(binds ? 'bio-bind' : 'bio-layout')
  }
}

function onNodeDoubleClick({ node }) {
  openEditor(node.id)
}

/**
 * Opens an instance in the instance editor, as a double-click on it does.
 *
 * @param {string} id
 */
function openEditor(id) {
  const instance = id && main.findNode(id)
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

/** How fast a moving path's dashes run, in px a second: a dash period (16) each 1.2s, as bio-species-flow runs them. */
const DASH_SPEED = 16 / 1.2
/** How long the dashes run when they don't run on: 4 times round bio-species-flow. */
const DASH_RUN = 4 * 1.2

/** Each leg's arrowheads, by its path and their size; a drag redraws only some legs, so the rest keep theirs. */
const legArrowsCache = new Map()
const arrowsOfLeg = (d, head) => {
  const key = `${head}:${d}`
  let arrows = legArrowsCache.get(key)
  if (!arrows) {
    if (legArrowsCache.size > 2000) legArrowsCache.clear()
    arrows = legArrows(d, head)
    legArrowsCache.set(key, arrows)
  }
  return arrows
}

/**
 * The arrowheads along a leg, by index.
 *
 * @param {string} d - The leg's SVG path.
 * @param {number} head - The arrowheads' length.
 * @returns {number[]}
 */
const arrowsAlong = (d, head) => [...Array(arrowsOfLeg(d, head).count).keys()]

/**
 * An arrowhead with its tip at the origin, pointing along x, so it rides its leg's path tip first.
 *
 * @param {number} head - Its length and width.
 * @returns {string} An SVG path.
 */
const arrowShape = (head) => `M${-head},${-head / 2} L0,0 L${-head},${head / 2} z`

/**
 * Where an arrowhead rides on its leg's track (the leg carried on under its end): each runs one gap along, at the
 * dashes' speed, to where the next one started, so they loop without a jump; at rest they sit at the ends of their
 * runs, the last wholly under the leg's end.
 *
 * @param {string} d - The leg's SVG path.
 * @param {number} head - The arrowheads' length.
 * @param {number} index - Which arrowhead along it.
 * @returns {Object} Its style.
 */
const arrowStyle = (d, head, index) => {
  const { track, gap } = arrowsOfLeg(d, head)
  const period = gap / DASH_SPEED
  return {
    offsetPath: `path('${track}')`,
    '--arrow-from': `${index * gap}px`,
    '--arrow-to': `${(index + 1) * gap}px`,
    '--arrow-runs': Math.max(1, Math.round(DASH_RUN / period)),
    animationDuration: `${period}s`,
  }
}
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
/** Every species in scope, hidden ones too, so hiding one leaves the others their colours. */
const scopedSpecies = computed(() => species.value?.network.species ?? [])
const colourIndex = (curie) =>
  Math.max(
    0,
    scopedSpecies.value.findIndex((entry) => entry.species === curie)
  ) % SPECIES_COLOURS.length
const colourOf = (curie) => SPECIES_COLOURS[colourIndex(curie)]
/** What colour the focused species' concentration tints its compartments (see BioCell and BioRegion). */
provide(
  'bioTintColour',
  computed(() => (concentrationTint.value ? colourOf(concentrationTint.value.species) : null))
)
/** A tinted compartment's concentration of the focused species at the cursor, for its token's tooltip. */
function concentrationText(token) {
  const tinted = concentrationTint.value
  if (tinted?.species !== token.species) return ''
  const value = tinted.tints.find((tint) => tint.nodeId === token.nodeId)?.value
  return Number.isFinite(value) ? ` (${Number(value.toPrecision(4))}${tinted.unit ? ` ${tinted.unit}` : ''})` : ''
}
/** The species menu's rows. */
const menuSpecies = computed(() => scopedSpecies.value.map((entry) => ({ ...entry, colour: colourOf(entry.species) })))
const speciesMenuRef = ref(null)
const isFocused = (token) =>
  viewMode.focusedSpecies?.nodeId === token.nodeId && viewMode.focusedSpecies?.species === token.species
/** Whether a species is set back while another is focused. */
const isDimmed = (curie) => !!viewMode.focusedSpecies && viewMode.focusedSpecies.species !== curie

/** Forgets the species token clicked, so the selection plot follows the selection again. */
function clearSpeciesFocus() {
  viewMode.focusedSpecies = null
}

/** Turns species mode on or off, remembered with the app's settings. */
function toggleSpecies() {
  saveAppSettings({ speciesOverlay: !isSpeciesOn.value })
  if (!isSpeciesOn.value) clearSpeciesFocus()
}

/**
 * Shows only the species coupled to their compartments, only those with a path through a protein, or every one
 * annotated, turning species mode on. A focused token stays focused into Species with Fluxes, which keeps it.
 */
function setSpeciesScope(scope) {
  viewMode.speciesScope = scope
  saveAppSettings({ speciesOverlay: true })
  if (scope !== 'fluxes') clearSpeciesFocus()
}

/** Hides these species in every compartment, with their paths; a focused one hidden is no longer focused. */
function setHiddenSpecies(hidden) {
  viewMode.hiddenSpecies = hidden
  if (hidden.includes(viewMode.focusedSpecies?.species)) clearSpeciesFocus()
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
  return setChoices([id], patch, type)
}

/** Makes the same choice for several nodes, as one step. */
function setChoices(ids, patch, type) {
  return applyPlan(new Map(ids.map((id) => [id, patchBioView(main.findNode(id)?.data?.bioView, patch)])), type)
}

/**
 * Draws nodes with a skin, NO_SKIN for none, as one step: a protein or process by its own choice, any other node by
 * its piece's (see skinnedPieceOfNode). A skin from a loaded library joins the workspace.
 *
 * @param {string[]} ids - Nodes of the view; all one thing, as the properties panel and menus choose for.
 * @param {string} skin - A skin's id, or NO_SKIN.
 */
function chooseSkin(ids, skin) {
  const modules = ids.filter((id) => main.findNode(id) && !isJointNode(id) && roles.value.get(id)?.skinContext)
  if (!modules.length) {
    let pieces = piecesStore.pieces
    for (const id of new Set(ids.map(skinnedPieceOfNode).filter(Boolean))) {
      const piece = pieces?.find((each) => each.id === id)
      pieces = piece ? skinPiece(pieces, id, pieceSkinFor(piece, skin)) : pieces
    }
    return keepEdit(pieces === piecesStore.pieces ? null : pieces, 'bio-pieces-skin', 'Could not change its skin')
  }
  skinStore.adoptSkin(skin)
  return setChoices(modules, { skin }, 'bio-skin')
}

/** Somewhere left of the cells, below any proteins already there, for a module taken off its site. */
function trayPosition() {
  const cells = [...layout.value.values()].filter((place) => place.kind === 'cell').map((place) => place.rect)
  const left = cells.length ? Math.min(...cells.map((rect) => rect.x)) : 0
  const top = cells.length ? Math.min(...cells.map((rect) => rect.y)) : 0
  const loose = [...layout.value.values()].filter((place) => place.kind === 'tray').length
  return {
    x: left - 2 * GAP - SYMBOL_WIDTH,
    y: top + loose * (SYMBOL_HEIGHT + 32),
  }
}

/**
 * Takes a node out of its place by a plan, without the placement edges to the neighbours it leaves, as one step.
 *
 * @param {string} id
 * @param {Map<string, Object>} plan - From planUnbind.
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

// ── Editing the pieces ─────────────────────────────────────────────────
/**
 * Keeps an edit to the pieces as one step, or says why it can't be made.
 *
 * @param {Array<Object>|null} raw - What an edit gives (see pieces/edits.js), or null when it can't be made.
 * @param {string} type - The step's type.
 * @param {string} [failed] - The title of what went wrong.
 * @returns {Promise<boolean>}
 */
async function keepEdit(raw, type, failed = 'Could not change it') {
  if (!raw) return false
  const { pieces, errors } = validatePieces(raw)
  if (!pieces) {
    notify.error({ title: failed, message: summariseProblems(errors) })
    return false
  }
  return editPieces(pieces, type)
}

/** The piece a cell's or region's name is: a cell's inside, else its membrane; a region's compartment. */
const namedPieceOf = (place) => (place.kind === 'cell' ? place.bulk ?? place.piece : place.piece)

/**
 * The compartment a cell's or region's area skin is on: a cell's inside, a region's compartment. A cell with no
 * inside of its own (all of it docked compartments) has none.
 */
const skinnedPieceOf = (place) => (place.kind === 'cell' ? place.bulk : place.piece)

/**
 * Names a cell or compartment from the field its name becomes on a click: the module on it, as the diagram renames
 * an instance, or else the piece itself.
 *
 * @param {string} id - The piece's node id.
 * @param {string} name
 */
async function renamePiece(id, name) {
  if (main.findNode(id)) {
    const error = await renameInstance(id, name)
    if (error) notify.error({ title: 'Could not rename it', message: error })
    return
  }
  const place = layout.value.get(id)
  if (!place?.piece) return
  keepEdit(relabelPiece(piecesStore.pieces, namedPieceOf(place), name), 'bio-pieces-rename', 'Could not rename it')
}
provide('bioRenamePiece', renamePiece)

// ── Skins ──────────────────────────────────────────────────────────────
/** The artwork a piece's skin names, as its node draws it: nothing where the workspace has no such skin. */
const skinArt = computed(
  () => new Map(allSkins().filter((skin) => skin.renderer === 'area').map((skin) => [skin.id, skinHref(skin.svg)]))
)
provide('bioSkinOf', (skin) => {
  const href = skin && skinArt.value.get(skin.ref)
  if (!href) return null
  return { href, aspect: SKIN_ASPECT[skin.mode] ?? SKIN_ASPECT.contain, opacity: skin.opacity ?? 1 }
})

/**
 * Sets, or with null takes away, the skin a membrane or compartment is drawn with, as one step.
 *
 * @param {string} id - The piece's.
 * @param {{ref: string, mode?: string, opacity?: number}|null} skin
 */
function setSkin(id, skin) {
  return keepEdit(skinPiece(piecesStore.pieces, id, skin), 'bio-pieces-skin', 'Could not change its skin')
}

/**
 * A piece that has a skin of its own (a compartment, a membrane or a tube), what it is for its skin, and the skin it is drawn
 * with; null for any other.
 *
 * @param {string|null} id - The piece's.
 * @returns {{piece: Object, context: Object, drawn: Object|null}|null}
 */
function pieceSkinChoice(id) {
  const piece = id && piecesStore.pieces.find((each) => each.id === id)
  const context = piece && contextOfPiece(topologyOf(piecesStore.pieces), id)
  if (!context || !['area', 'membrane', 'tube'].includes(context.family)) return null
  return { piece, context, drawn: resolveSkin(context, piece.skin) }
}

/** The skin a piece keeps for a choice: NO_SKIN for none, else the skin, filling as it did while it is the same one. */
const pieceSkinFor = (piece, skinId) =>
  skinId === NO_SKIN ? { ref: NO_SKIN } : { ...(piece.skin?.ref === skinId ? piece.skin : {}), ref: skinId }

/**
 * The piece whose skin a node of the view chooses: a cell's inside, a region's compartment, a membrane's band's
 * membrane, a tube's (by its room, or the module drawn as its joint); null for any other node.
 */
function skinnedPieceOfNode(nodeId) {
  const place = layout.value.get(nodeId)
  if (place?.kind === 'cell' || place?.kind === 'region') return skinnedPieceOf(place)
  if (place?.kind === 'membrane') return place.piece ?? layout.value.get(place.cell)?.piece ?? null
  if (place?.kind === 'link') return (place.joint && place.piece) || null
  if (place?.kind === 'card' && place.joint && place.joint !== 'conduit') return layout.value.get(place.link)?.piece ?? null
  return null
}

/** Whether a node is a module drawn as its tube's joint, whose skin is the tube's. */
const isJointNode = (nodeId) => {
  const place = layout.value.get(nodeId)
  return place?.kind === 'card' && !!place.joint
}

/**
 * What a node of the view is, for its skin, and the skin it is drawn with: a protein's or process's, else the piece's
 * it draws (see skinnedPieceOfNode).
 *
 * @param {string} nodeId
 * @returns {{context: Object, skin: string|null}|null} skin: null for none; null for a node with no skin.
 */
function skinOf(nodeId) {
  const role = main.findNode(nodeId) && !isJointNode(nodeId) && roles.value.get(nodeId)
  if (role?.skinContext) return { context: role.skinContext, skin: role.skin }
  const choice = pieceSkinChoice(skinnedPieceOfNode(nodeId))
  return choice && { context: choice.context, skin: choice.drawn?.id ?? null }
}

/** The nodes selected in the view that are pieces with no module on them, which the diagram's selection leaves out. */
const selectedPieceNodes = computed(() =>
  getSelectedNodes.value.filter((node) => !main.findNode(node.id) && skinnedPieceOfNode(node.id)).map((node) => node.id)
)

const skinFileInput = ref(null)
/** The piece a loaded skin is for. */
let skinFileFor = null

/** Adds the chosen SVG file to the workspace's skins and draws the piece it was loaded for with it. */
async function onSkinFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  const target = skinFileFor
  skinFileFor = null
  if (!file) return
  if (file.size > SKIN_LIMITS.bytes) {
    return notify.error({
      title: `Could not load ${file.name}`,
      message: `A skin must be at most ${SKIN_LIMITS.bytes / 1024} KB.`,
    })
  }
  // It is offered for what the piece it was loaded for is.
  const context = target && contextOfPiece(topologyOf(piecesStore.pieces), target)
  const { skin, errors, warnings } = skinStore.addSvg(file.name, await file.text(), { appliesTo: [context?.target] })
  if (!skin) return notify.error({ title: `Could not load ${file.name}`, message: summariseProblems(errors) })
  if (warnings.length) notify.warning({ title: `Loaded ${file.name}`, message: summariseProblems(warnings) })
  if (target) setSkin(target, { ref: skin.id })
}

/**
 * The Skin submenu of a compartment or membrane: none where it can have none, the skins for what it is (those its
 * term matches first), and for an area how the one it is drawn with fills it, and a file.
 */
function skinMenu(id) {
  const choice = pieceSkinChoice(id)
  if (!choice) return []
  const { piece, context, drawn } = choice
  const isArea = context.family === 'area'
  // How it fills, kept while the skin it is drawn with is the one chosen.
  const current = isArea && drawn ? pieceSkinFor(piece, drawn.id) : null
  const mark = (isOn) => (isOn ? 'pi pi-check' : 'pi')
  return [
    ...(allowsNoSkin(context.target)
      ? [{ label: 'None', icon: mark(!drawn), command: () => setSkin(id, { ref: NO_SKIN }) }]
      : []),
    ...skinsFor(context).map((skin) => ({
      label: skin.name,
      icon: mark(drawn?.id === skin.id),
      command: () => setSkin(id, pieceSkinFor(piece, skin.id)),
    })),
    ...(isArea ? [{ separator: true }] : []),
    ...(current
      ? [
          {
            label: 'Fill',
            icon: 'pi pi-arrows-alt',
            items: SKIN_MODES.map((mode) => ({
              label: { contain: 'Fit Inside', cover: 'Cover', stretch: 'Stretch' }[mode],
              icon: mark((current.mode ?? SKIN_MODES[0]) === mode),
              command: () => setSkin(id, { ...current, mode }),
            })),
          },
          {
            label: 'Strength',
            icon: 'pi pi-circle',
            items: [1, 0.75, 0.5, 0.25].map((opacity) => ({
              label: `${opacity * 100}%`,
              icon: mark((current.opacity ?? 1) === opacity),
              command: () => setSkin(id, { ...current, opacity }),
            })),
          },
        ]
      : []),
    ...(isArea
      ? [
          {
            label: 'Load SVG…',
            icon: 'pi pi-upload',
            command: () => {
              skinFileFor = id
              skinFileInput.value?.click()
            },
          },
        ]
      : []),
  ]
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

// ── Removing pieces ────────────────────────────────────────────────────
/** How a piece is named in a menu or question. */
const pieceName = (id) => {
  const [pieceId, spanId] = id.split('.')
  const piece = piecesStore.pieces.find((each) => each.id === pieceId)
  if (!spanId) return piece?.label ?? id
  return (
    topologyOf(piecesStore.pieces)
      .spansOf(pieceId)
      .find((span) => span.id === spanId)?.label ?? id
  )
}

/**
 * Removes pieces, and what goes with them (see removePieces), as one step, asking first when modules are on what
 * goes. They stay in the diagram: proteins go to the tray, the rest where their roles put them.
 *
 * @param {string[]} ids
 * @param {Object} [options]
 * @param {boolean} [options.withModules=false] - Delete the modules on what goes from the diagram instead, as Delete
 *   does for a compartment and everything attached to it.
 * @returns {Promise<void>}
 */
async function removeThesePieces(ids, { withModules = false } = {}) {
  const { pieces: raw, removed } = removePieces(piecesStore.pieces, ids)
  const { pieces: next, errors } = validatePieces(raw)
  const label = ids.map(pieceName).join(', ')
  if (!next) return notify.error({ title: `Could not remove ${label}`, message: summariseProblems(errors) })
  const stranded = strandedBy(next)
  if (withModules) return removeWithModules(next, stranded, label)
  const alongWith = [...removed].filter((id) => !ids.includes(id)).map(pieceName)
  if (stranded.length || alongWith.length) {
    const names = stranded.map((node) => nameOf(node.id)).join(', ')
    isConfirming.value = true
    try {
      const answer = await choose({
        header: 'Remove piece?',
        message: [
          alongWith.length ? `${alongWith.join(', ')} go${alongWith.length === 1 ? 'es' : ''} with ${label}.` : '',
          stranded.length
            ? `Modules are placed there: ${names}. They stay in the diagram, without the connections their places ` +
              'there made; proteins go to the tray.'
            : '',
        ]
          .filter(Boolean)
          .join(' '),
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
    if (await editPieces(next, 'bio-pieces-remove')) await dropStaleLinks(before)
  } finally {
    history.endBatch('bio-pieces-remove')
  }
}

/**
 * Removes pieces with the modules on them, which are deleted from the diagram, as one step, asking first when
 * modules go.
 *
 * @param {ReadonlyArray<Object>} next - The pieces as the removal leaves them, validated.
 * @param {Array<Object>} stranded - The diagram nodes on what goes (see strandedBy).
 * @param {string} label - What was asked to go.
 * @returns {Promise<void>}
 */
async function removeWithModules(next, stranded, label) {
  if (!stranded.length) {
    await editPieces(next, 'bio-pieces-remove')
    return
  }
  const names = stranded.map((node) => nameOf(node.id)).join(', ')
  isConfirming.value = true
  let answer
  try {
    answer = await choose({
      header: 'Remove piece?',
      message: `Everything attached to ${label} goes with it, and these modules are deleted from the diagram: ${names}.`,
      severity: 'warning',
      acceptLabel: 'Remove',
      rejectLabel: 'Cancel',
    })
  } finally {
    isConfirming.value = false
  }
  if (answer !== 'accept') return
  await deleteInstances(
    stranded.map((node) => node.id),
    { removeNodes: main.removeNodes, history, after: () => editPieces(next, 'bio-pieces-remove') }
  )
}

// ── The build palette ──────────────────────────────────────────────────
// The tiles are in the library's Build tab (see BioBuildPalette): what is clicked or dragged there is kept in the
// view-mode store, and placed here.
const { armedTile, draggedTile } = storeToRefs(viewMode)
// A template file asked for there is loaded here, into the middle of the view.
watch(
  () => viewMode.templateFileRequests,
  () => loadTemplateFile(viewCentre())
)

/**
 * Adds copies of a template's pieces where it is dropped, saying why where it can't.
 *
 * @param {string} templateId - One of the template library's.
 * @param {{x: number, y: number}} point - Its corner, in flow coordinates.
 * @param {{ inCompartment?: boolean }} [options] - Whether it goes in the compartment the point is in, if any, as a
 *   template dropped from the palette does; else on the canvas.
 */
async function placePiecesAt(templateId, point, { inCompartment = false } = {}) {
  const template = templateLibrary.getTemplate(templateId)
  if (!template) return
  const into = inCompartment ? templateHost(dropScene(piecesStore.pieces, sceneOptions()), point) : null
  const errors = await placePiecesTemplate(template, point, { into })
  if (errors.length) notify.error({ title: 'Could not add the template', message: summariseProblems(errors) })
}

// ── Moving and resizing the pieces ─────────────────────────────────────
// A piece dragged, or resized, is laid out as the drag would leave it (the store's draft), worked out once a frame,
// so everything in, against or joined to it follows; the drop keeps the draft as one step. See pieces/moves.js.
/** The piece being dragged: its node, the piece, how it moves, where its node started, and the pieces then. */
let pieceMove = null
/** The piece being resized, likewise. */
let pieceResize = null
let moveFrameRequest = 0
let pendingPosition = null

/** Where each piece is drawn, from the pieces as they are (not as a draft has them). */
const pieceRects = () => layoutPieces(piecesStore.pieces).rects

/**
 * Begins a drag of a piece, or of a grip on one, if the node is one that moves so. The piece follows the pointer, by
 * how far it has gone: the node's own position is the draft's, which a drag would otherwise move twice.
 */
function startPieceMove(node, event) {
  const place = layout.value.get(node.id)
  const pointer = pointerAt(event)
  if (!place?.piece || !pointer) return false
  const mode = node.type === 'bioGrip' ? `grip:${place.grip}` : place.drag
  if (!mode) return false
  // The view stays where the user is working, however the layout's extent changes.
  isViewChosen = true
  pieceMove = {
    nodeId: node.id,
    piece: place.piece,
    mode,
    pointer,
    grip: place.kind === 'grip' ? { x: place.x, y: place.y } : null,
    base: piecesStore.pieces,
    rects: pieceRects(),
    end: place.end,
    below: place.below ?? 0,
    // A compartment's far edge can be dropped on another membrane's side or a fold: what it could go on, read once.
    scene: mode === 'grip:reach' ? dropScene(piecesStore.pieces, sceneOptions()) : null,
    dock: null,
  }
  return true
}

/** Whether a node change is one a piece's move or resize stands in for, and so is left unapplied. */
function takesPieceChange(change) {
  if (pieceMove && change.type === 'position') {
    // A tube's end follows the pointer, to be dropped on another compartment.
    if (change.id === pieceMove.nodeId && (pieceMove.mode === 'grip:start' || pieceMove.mode === 'grip:end'))
      return false
    return true
  }
  return (
    !!pieceResize && change.id === pieceResize.nodeId && (change.type === 'position' || change.type === 'dimensions')
  )
}

/**
 * The pieces as a move with the pointer here leaves them, validated; null where it can't go there. A grip goes as far
 * as the pointer has, but a compartment's far edge goes to the pointer itself, where what it would dock to is looked
 * for (see dockDraft).
 */
function moveDraft(pointer) {
  const { mode, piece, base, rects, below } = pieceMove
  const delta = { x: pointer.x - pieceMove.pointer.x, y: pointer.y - pieceMove.pointer.y }
  const grip = pieceMove.grip && { x: pieceMove.grip.x + delta.x, y: pieceMove.grip.y + delta.y }
  const raw =
    mode === 'frame'
      ? moveFrame(base, piece, delta, rects)
      : mode === 'slide'
      ? slideDock(base, piece, delta, rects)
      : mode === 'grip:fold'
      ? moveFold(base, piece, grip, rects)
      : mode === 'grip:bend'
      ? bendTube(base, piece, { x: grip.x, y: grip.y + below })
      : mode === 'grip:reach'
      ? reachTo(base, piece, pointer, rects)
      : null
  return raw && validatePieces(raw).pieces
}

/** Lays the dragged piece out for where the pointer is now, once a frame. */
function followPiece(pointer) {
  pendingPosition = pointer
  if (moveFrameRequest) return
  moveFrameRequest = requestAnimationFrame(() => {
    moveFrameRequest = 0
    if (!pieceMove || !pendingPosition) return
    // It reaches as far as it is dragged, and what it would dock to there is outlined.
    if (pieceMove.scene) dockDraft(pieceMove, pendingPosition)
    const draft = moveDraft(pendingPosition)
    if (draft) piecesStore.draft = draft
  })
}

/**
 * Ends a drag of a piece: keeps where it went, as one step, joins a tube's end to the compartment it is on, or docks
 * a compartment whose far edge is on another membrane's side or a fold there too.
 */
async function endPieceMove({ event, node }) {
  // Where the pointer was let go, which the frame still to come would have laid it out for.
  const last = moveFrameRequest && pendingPosition
  if (last) {
    const draft = moveDraft(last)
    if (draft) piecesStore.draft = draft
  }
  const move = pieceMove
  pieceMove = null
  cancelAnimationFrame(moveFrameRequest)
  moveFrameRequest = 0
  pendingPosition = null
  if (move.scene) {
    const docked = dockDraft(move, pointerAt(event))
    clearPiecePreview()
    if (docked) {
      try {
        await editPieces(docked, 'bio-pieces-dock')
      } finally {
        piecesStore.draft = null
      }
      return
    }
  }
  if (move.mode === 'grip:start' || move.mode === 'grip:end') {
    const point = pointerAt(event)
    const join = resolveTubeEnd(dropScene(piecesStore.pieces, sceneOptions()), move.piece, move.end, point)
    // Between two touching cells, it carries what the user says, as a tube dropped between them does.
    const flux = join?.cells ? await cellTubeFlux(join.cells) : undefined
    const raw = join && (!join.cells || flux) && join.apply(move.base, { flux })
    const next = raw && validatePieces(raw).pieces
    if (next) await editPieces(next, 'bio-pieces-tube-end')
    // Back where its layout puts it: on the end it is joined to now.
    putBack([node])
    return
  }
  const draft = piecesStore.draft
  try {
    if (draft && draft !== move.base) await editPieces(draft, 'bio-pieces-move')
  } finally {
    piecesStore.draft = null
  }
}

/**
 * The pieces as a compartment's far edge dropped at a point would leave them, docked there too, with the target
 * outlined and the label by the pointer saying so; null where it is by nothing to dock to, or can't dock there (the
 * label says why).
 *
 * @param {Object} move - The drag of its reach grip (see startPieceMove), which keeps the last target's result.
 * @param {{x: number, y: number}|null} point
 * @returns {ReadonlyArray<Object>|null}
 */
function dockDraft(move, point) {
  if (!point) return null
  const drop = resolveExtraDock(move.scene, move.piece, point)
  piecePointer.value = drop ? point : null
  if (!drop) {
    piecePreview.value = null
    move.dock = null
    return null
  }
  if (drop.key !== piecePreview.value?.key) {
    if (drop.invalid) {
      piecePreview.value = { key: drop.key, invalid: drop.invalid, highlights: [], ghosts: [] }
      move.dock = null
    } else {
      const { pieces, errors } = previewDrop(move.scene, drop)
      piecePreview.value = pieces
        ? { key: drop.key, label: drop.label, highlights: drop.highlights, ghosts: [] }
        : { key: drop.key, invalid: summariseProblems(errors), highlights: drop.highlights, ghosts: [] }
      move.dock = pieces
    }
  }
  return move.dock
}

/** Resizes a piece from its handle (see BioPieceResize): its frame. */
function onPieceResize(nodeId, phase, params) {
  if (phase === 'start') {
    const place = layout.value.get(nodeId)
    if (!place?.piece || !place.resize) return
    const base = piecesStore.pieces
    isViewChosen = true
    pieceResize = {
      nodeId,
      piece: place.piece,
      resize: place.resize,
      base,
      rects: pieceRects(),
      // How far what stands beside it has been pushed out of its way, which shrinking it again doesn't undo.
      pushed: new Map(),
    }
    return
  }
  if (pieceResize?.nodeId !== nodeId) return
  if (phase === 'resize') {
    const draft = resizeDraft(params)
    if (draft) piecesStore.draft = draft
    return
  }
  const draft = piecesStore.draft
  const base = pieceResize.base
  pieceResize = null
  const keep = draft && draft !== base ? editPieces(draft, 'bio-pieces-resize') : Promise.resolve()
  keep.finally(() => (piecesStore.draft = null))
}
provide('bioPieceResize', onPieceResize)

/** The pieces as a resize to these bounds leaves them, validated. */
function resizeDraft(params) {
  const { piece, base, rects, pushed } = pieceResize
  // A cell's junction partners stay against it, and what stands beside it out of its way, as far as it is drawn
  // resized.
  const rectsOf = (resized) => {
    const valid = validatePieces(resized).pieces
    return valid && layoutPieces(valid).rects
  }
  const raw = resizeFrame(base, piece, params, rects, { rectsOf, pushed })
  return raw && validatePieces(raw).pieces
}

/**
 * What can be done to a piece from its menu: rename it, change its skin, fit it to its contents, straighten a bent
 * tube, and remove it or what is on it.
 *
 * @param {Object} place - The piece's place.
 * @returns {Array<Object>} Menu items, after a separator; none for a place that is no piece.
 */
function pieceMenu(place) {
  const piece = place?.piece && piecesStore.pieces.find((each) => each.id === place.piece)
  if (!piece) return []
  const isStructure = place.kind === 'cell' || place.kind === 'region'
  const named = isStructure ? namedPieceOf(place) : piece.id
  const items = [
    {
      label: 'Rename Piece…',
      icon: 'pi pi-pencil',
      command: () => (renaming.value = { id: named, label: pieceName(named), placeholder: pieceName(named) }),
    },
  ]
  // A cell's inside and its membrane each have their own; an empty membrane's band, its membrane's.
  const areaItems = isStructure && skinnedPieceOf(place) ? skinMenu(skinnedPieceOf(place)) : []
  if (areaItems.length) items.push({ label: 'Skin', icon: 'pi pi-image', items: areaItems })
  const membraneItems = place.kind === 'cell' || place.kind === 'membrane' ? skinMenu(place.piece) : []
  if (membraneItems.length) {
    items.push({ label: place.kind === 'cell' ? 'Membrane Skin' : 'Skin', icon: 'pi pi-circle', items: membraneItems })
  }
  // A tube's joint, where its ends touch; the vessel along a conduit between compartments apart is the view's.
  const jointItems = piece.kind === 'tube' && place.joint && place.joint !== 'conduit' ? skinMenu(piece.id) : []
  if (jointItems.length) items.push({ label: 'Skin', icon: 'pi pi-image', items: jointItems })
  if (piece.frame && piece.kind !== 'zone') {
    items.push({
      label: 'Fit to Contents',
      icon: 'pi pi-arrows-alt',
      command: () => keepEdit(fitToContents(piecesStore.pieces, piece.id), 'bio-pieces-resize'),
    })
  }
  if (piece.kind === 'tube' && piece.bends?.length) {
    items.push({
      label: 'Straighten Tube',
      icon: 'pi pi-minus',
      command: () => keepEdit(bendTube(piecesStore.pieces, piece.id, null), 'bio-pieces-move'),
    })
  }
  if (piece.kind === 'compartment' && piece.docks?.length > 1) items.push(detachMenu(piece))
  items.push(...removeMenu(place, piece))
  return [{ separator: true }, ...items]
}

/**
 * The Remove item of a piece's menu: the piece, or with a submenu, a cell whole or its membrane alone, and what is on
 * it (folds, process zones, tubes), each with what goes with it.
 */
function removeMenu(place, piece) {
  const remove = (ids, label) => ({ label, command: () => removeThesePieces(ids) })
  const item = { label: 'Remove', icon: 'pi pi-minus-circle' }
  if (place.kind !== 'cell' && place.kind !== 'region') return [{ ...item, command: remove([piece.id]).command }]
  const all = piecesStore.pieces
  const inside = place.kind === 'cell' ? place.bulk : piece.id
  const enclosed = place.kind === 'cell' ? piece.encloses : []
  const parts = [
    ...all.filter((each) => each.kind === 'fold' && each.membrane === piece.id),
    ...all.filter((each) => each.kind === 'zone' && each.compartment === inside),
    ...all.filter((each) => each.kind === 'tube' && each.ends.some((end) => end === inside || enclosed.includes(end))),
  ].map((each) => remove([each.id], each.label))
  const whole =
    place.kind === 'cell'
      ? [
          remove([piece.id, ...enclosed], `${pieceName(namedPieceOf(place))} (whole cell)`),
          remove([piece.id], `${piece.label} only`),
        ]
      : [remove([piece.id], piece.label)]
  if (whole.length === 1 && !parts.length) return [{ ...item, command: whole[0].command }]
  return [{ ...item, items: [...whole, ...(parts.length ? [{ separator: true }, ...parts] : [])] }]
}

/** Takes one of the docks of a compartment docked to several membranes or folds away: one item for each. */
function detachMenu(piece) {
  const SIDE_WORDS = { top: 'top', bottom: 'bottom', left: 'left side', right: 'right side' }
  return {
    label: 'Detach From',
    icon: 'pi pi-link',
    items: piece.docks.map((dock, index) => {
      const target = piecesStore.pieces.find((each) => each.id === dock.on)
      const name = target?.label ?? dock.on
      return {
        label: dock.side ? `${name} (${SIDE_WORDS[dock.side]})` : name,
        command: () =>
          keepEdit(removeDock(piecesStore.pieces, piece.id, index), 'bio-pieces-undock', 'Could not detach it'),
      }
    }),
  }
}

/** Renaming a piece from its menu: { id, label, placeholder }. */
const renaming = ref(null)

function onRenameConfirm() {
  const { id, label } = renaming.value
  renaming.value = null
  if (label.trim()) keepEdit(relabelPiece(piecesStore.pieces, id, label), 'bio-pieces-rename', 'Could not rename it')
}

// ── The five pieces ────────────────────────────────────────────────────
// A piece carried from the palette, dragged or armed, shows what it would go on and where it would be drawn, worked
// out again only when its target changes (see pieces/drops.js).
const isPieceTile = (tile) => tile?.kind === 'piece'
const isTemplateTile = (tile) => tile?.kind === 'template'
/** A tile that previews where it would go: one of the five pieces, or a template's pieces. */
const isPreviewedTile = (tile) => isPieceTile(tile) || isTemplateTile(tile)
const carriedTile = computed(() => [draggedTile.value, armedTile.value].find(isPreviewedTile) ?? null)
/** The pieces and where each is drawn, read once while a piece is carried. */
/** The pieces are found and previewed laid out as the view draws them, with the modules on them. */
const sceneOptions = () => {
  const { nodes, widthOf } = pieceLayoutOptions.value
  return { nodes, widthOf }
}

const pieceScene = computed(() => (carriedTile.value ? dropScene(piecesStore.pieces, sceneOptions()) : null))
/** What the carried piece would do where the pointer is: { key, label | invalid, highlights, ghosts }. */
const piecePreview = shallowRef(null)
const piecePointer = ref(null)

/** Follows a carried piece: works out its drop where the target is a new one, and moves its label. */
function trackPiece(point) {
  const tile = carriedTile.value
  const scene = pieceScene.value
  if (!tile || !scene) return
  if (point.x !== piecePointer.value?.x || point.y !== piecePointer.value?.y) piecePointer.value = point
  const drop = isTemplateTile(tile) ? templateDrop(tile.template, point, scene) : resolveDrop(tile.piece, point, scene)
  if (!drop) return
  if (drop.key === piecePreview.value?.key) return
  if (drop.invalid) {
    piecePreview.value = { key: drop.key, invalid: drop.invalid, highlights: [], ghosts: [] }
    return
  }
  const preview = previewDrop(scene, drop)
  piecePreview.value = preview.errors.length
    ? { key: drop.key, invalid: summariseProblems(preview.errors), highlights: drop.highlights, ghosts: [] }
    : { key: drop.key, label: drop.label, highlights: drop.highlights, ghosts: preview.ghosts }
}

/**
 * The compartment a template dropped at a point goes in: the innermost drawn round it, with where it is drawn; null on
 * the canvas.
 *
 * @param {Object} scene - From dropScene.
 * @param {{x: number, y: number}} point - In flow coordinates.
 * @returns {{id: string, label: string, rect: Object, corner: {x: number, y: number}}|null}
 */
function templateHost(scene, point) {
  const host = compartmentAtPoint(scene, point)
  const rect = host && scene.rects.get(host.id)
  return rect ? { id: host.id, label: host.label, rect, corner: { x: rect.x, y: rect.y } } : null
}

/**
 * A template carried to a point, as a drop previewDrop can show: its pieces stamped there, as placePiecesTemplate
 * would add them: in the compartment the point is in, highlighted, else on the canvas.
 *
 * @param {string} templateId
 * @param {{x: number, y: number}} point - In flow coordinates.
 * @param {Object} scene - From dropScene.
 * @returns {Object|null}
 */
function templateDrop(templateId, point, scene) {
  const template = templateLibrary.getTemplate(templateId)
  if (!template) return null
  const at = whole(point)
  const into = templateHost(scene, point)
  return {
    key: `template ${templateId} ${into?.id ?? ''} ${at.x} ${at.y}`,
    label: into ? `Add ${template.name} in ${into.label}` : `Add ${template.name}`,
    highlights: into ? [{ type: 'rect', rect: into.rect }] : [],
    apply: (pieces) => {
      const { pieces: next, errors } = stampTemplate(pieces, template, at, { into })
      return errors.length ? { pieces: null, error: errors[0] } : { pieces: next, id: null }
    },
  }
}

function clearPiecePreview() {
  piecePreview.value = null
  piecePointer.value = null
}
watch(carriedTile, (tile) => {
  if (!tile) clearPiecePreview()
})

/** How round a ghost's corners are drawn: a cell's as a cell's, a compartment's as its target outline's. */
const cornerOf = (ghost) => (ghost.kind === 'cell' ? CELL_RADIUS : 12)

/**
 * What a drop does to what is there, under its label: a membrane round it makes it a cell, its corners rounded and
 * grown where a cell needs more room; anything else may grow a compartment or cell to fit it.
 */
function growthNote(ghosts) {
  const cell = ghosts.find((ghost) => ghost.was && ghost.type === 'rect')
  if (cell) return cell.grows ? 'Rounds its corners, and grows to fit a cell' : 'Rounds its corners as a cell'
  const said = (type, one, many) => {
    const names = ghosts.filter((ghost) => ghost.type === type).map((ghost) => ghost.label)
    if (!names.length) return null
    const listed = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names.at(-1)}` : names[0]
    return `${listed} ${names.length > 1 ? many : one}`
  }
  const notes = [
    said('grows', 'grows to fit it', 'grow to fit it'),
    said('moves', 'moves out of the way', 'move out of the way'),
  ]
  return notes.filter(Boolean).join('; ') || null
}

/** The label that follows a carried piece: what it would do there, or why it can't go there. */
const pieceLabel = computed(() => {
  if (!piecePreview.value || !piecePointer.value) return null
  const { x, y, zoom } = viewport.value
  const { invalid, label, ghosts = [] } = piecePreview.value
  return {
    left: piecePointer.value.x * zoom + x + 18,
    top: piecePointer.value.y * zoom + y + 18,
    text: invalid ?? label,
    ...(!invalid && { note: growthNote(ghosts) }),
    invalid: !!invalid,
  }
})

/** An armed piece previews where the pointer is over the view, as a dragged one does. */
function onArmedMove(event) {
  if (!isPreviewedTile(armedTile.value)) return
  if (
    !event.target.closest('.vue-flow') ||
    event.target.closest('.vue-flow__controls, .vue-flow__minimap, .vue-flow__panel')
  ) {
    clearPiecePreview()
    return
  }
  trackPiece(screenToFlowCoordinate({ x: event.clientX, y: event.clientY }))
}

/**
 * Adds one of the five pieces where it is dropped, as one step, saying why where it can't go there.
 *
 * @param {'compartment'|'membrane'|'tube'|'fold'|'zone'} kind
 * @param {{x: number, y: number}} point - In flow coordinates.
 */
async function placePieceAt(kind, point) {
  const scene = dropScene(piecesStore.pieces, sceneOptions())
  const drop = resolveDrop(kind, point, scene)
  if (drop.invalid) return notify.info({ title: 'It can’t go there', message: drop.invalid })
  let choice
  if (drop.cells) {
    const flux = await cellTubeFlux(drop.cells)
    if (!flux) return
    choice = { flux }
  }
  const { pieces, errors } = previewDrop(scene, drop, choice)
  if (!pieces) return notify.error({ title: 'It can’t go there', message: summariseProblems(errors) })
  await editPieces(pieces, `bio-pieces-${kind}`)
}

/** The flux each answer to "A tube between two cells" gives. */
const CELL_TUBE_FLUX = Object.freeze({ gap: 'junction', bridge: 'bridge' })

/**
 * What a tube between two touching cells joins them by: the setting's choice, else the user's, asked with a box to
 * remember it as the setting. Between two apart, the drop makes it a bridge, asking nothing (see resolveDrop).
 *
 * @param {[string, string]} cells - Their names.
 * @returns {Promise<'junction'|'bridge'|null>} null when cancelled.
 */
async function cellTubeFlux([first, second]) {
  const set = CELL_TUBE_FLUX[settings.bioCellTube]
  if (set) return set
  isConfirming.value = true
  try {
    const { action, remember } = await choose({
      header: 'Join two cells',
      message:
        `${first} and ${second} touch. How does the tube join them? A gap junction is where their two membranes ` +
        'meet, with a connexon in each; a bridge is an open channel of cytoplasm between them, walled by membrane. ' +
        'Between cells apart, a tube is always a bridge.',
      extraLabel: 'Gap junction',
      acceptLabel: 'Bridge',
      rejectLabel: 'Cancel',
      remember: 'Remember this choice',
    })
    const answer = { extra: 'gap', accept: 'bridge' }[action]
    if (!answer) return null
    if (remember) saveAppSettings({ bioCellTube: answer })
    return CELL_TUBE_FLUX[answer]
  } finally {
    isConfirming.value = false
  }
}

const isTileDrag = (event) => [...(event.dataTransfer?.types ?? [])].includes(TILE_DRAG_TYPE)

/** The middle of the view as shown, in flow coordinates. */
function viewCentre() {
  const { left, top, width, height } = vueFlowRef.value.getBoundingClientRect()
  return screenToFlowCoordinate({ x: left + width / 2, y: top + height / 2 })
}

/**
 * Places what a palette tile stands for at a point of the view: a template's pieces, one of the five pieces, or a new
 * module, as a drop of one from the library would be.
 *
 * @param {{kind: string, template?: string, piece?: string}} tile
 * @param {{x: number, y: number}} point - In flow coordinates.
 */
function applyTile(tile, point) {
  if (tile.kind === 'template') return placePiecesAt(tile.template, point, { inCompartment: true })
  if (isPieceTile(tile)) return placePieceAt(tile.piece, point)
  if (tile.kind === 'module') {
    const module = libraryStore.availableModules.get(NEW_INSTANCE_MODULE_REF)
    return module && props.createInstance ? placeModuleAt(module, point) : null
  }
}

/**
 * Places what a palette tile stands for, as applyTile does, with a new, empty module on each site it adds that takes
 * one module, all as one step, so a model built from the palette is whole, each module there to replace later.
 *
 * @param {{kind: string, template?: string}} tile
 * @param {{x: number, y: number}} point - In flow coordinates.
 */
async function placeTile(tile, point) {
  // Put where the user chose, as its preview showed: the view stays where it is, not fitted to what is added.
  isViewSet = isViewChosen = true
  // A new module adds no sites, and keeps its own step: a drop asking what it is holds that step open past here.
  if (tile.kind === 'module') return applyTile(tile, point)
  const before = new Set(siteTargets.value.map((target) => target.ref))
  history.startBatch()
  try {
    await applyTile(tile, point)
    const module = newModule()
    if (!module || !props.createInstance) return
    await nextTick()
    const fresh = siteTargets.value
      .filter((target) => !before.has(target.ref) && takesPlaceholder(target))
      .map((target) => target.ref)
    for (const ref of fresh) {
      // Found again each time, as the sites before it took their modules.
      await nextTick()
      const site = siteTargets.value.find((target) => target.ref === ref && target.type === 'area')
      if (!site || !takesPlaceholder(site)) continue
      const id = await addModuleIn(module, { site })
      // Named for the piece, which is drawn by its module's name while it holds one.
      const name = placeholderName(
        site.label,
        main.nodes.value.filter((node) => node.id !== id).map((node) => node.data?.name)
      )
      if (id && name) await renameInstance(id, name)
    }
  } finally {
    history.endBatch('bio-build')
  }
}

/** Places the armed tile where the view is clicked; a click on the view's own controls is theirs. */
function onArmedClick(event) {
  if (!armedTile.value || !event.target.closest('.vue-flow')) return
  if (event.target.closest('.vue-flow__controls, .vue-flow__minimap, .vue-flow__panel')) return
  event.stopPropagation()
  event.preventDefault()
  const tile = armedTile.value
  armedTile.value = null
  placeTile(tile, screenToFlowCoordinate({ x: event.clientX, y: event.clientY }))
}

/** Escape lets go of the armed tile. */
function onArmedKey(event) {
  if (event.key === 'Escape') armedTile.value = null
}
watch(armedTile, (tile) => {
  if (tile) window.addEventListener('keydown', onArmedKey)
  else window.removeEventListener('keydown', onArmedKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onArmedKey))

// ── Template files ─────────────────────────────────────────────────────
const templateFileInput = ref(null)
/** Where a template loaded from a file goes, in flow coordinates. */
let templateFileAt = null

function loadTemplateFile(at) {
  templateFileAt = at
  templateFileInput.value?.click()
}

/**
 * Adds the chosen template file to the user's templates and places it as a Build tab drop would, or says what is wrong
 * with it.
 */
async function onTemplateFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  const at = templateFileAt ?? { x: 0, y: 0 }
  const { raw, errors: parseErrors } = await readTemplateFile(file)
  const { template, errors, warnings } = parseErrors.length
    ? { template: null, errors: parseErrors, warnings: [] }
    : templateLibrary.addLocalTemplate(raw)
  if (!template) return notify.error({ title: `Could not load ${file.name}`, message: summariseProblems(errors) })
  await placeTile({ kind: 'template', template: template.id }, at)
  if (warnings.length) notify.warning({ title: `Loaded ${template.name}`, message: summariseProblems(warnings) })
}

/** Downloads every piece of the view as a template file anyone can load. */
function savePiecesAsTemplate() {
  const template = {
    schemaVersion: PIECES_SCHEMA_VERSION,
    id: 'physiology',
    name: 'Physiology',
    pieces: piecesStore.pieces,
  }
  const { filename, text } = templateFile(template)
  legacyDownload(filename, new Blob([text], { type: 'application/json' }))
}

/**
 * The Add Template submenu: built-ins, then the user's own, then loading and removing theirs. A template chosen here is
 * placed as one dropped from the Build tab would be, with its modules.
 */
function addTemplateMenu(at) {
  const place = (template) => ({
    label: template.name,
    command: () => placeTile({ kind: 'template', template: template.id }, at),
  })
  const builtIn = templateLibrary.library.filter((template) => !isLocalTemplateId(template.id))
  const own = templateLibrary.localTemplates
  return [
    ...builtIn.map(place),
    { separator: true },
    ...own.map(place),
    { label: 'Load Template File…', icon: 'pi pi-upload', command: () => loadTemplateFile(at) },
    ...(own.length
      ? [
          {
            label: 'Save My Template As File…',
            icon: 'pi pi-download',
            items: own.map((template) => ({ label: template.name, command: () => saveTemplate(template) })),
          },
          {
            label: 'Remove from My Templates',
            icon: 'pi pi-trash',
            items: own.map((template) => ({
              label: template.name,
              command: () => templateLibrary.removeLocalTemplate(template.id),
            })),
          },
        ]
      : []),
  ]
}

/** Downloads one of the user's templates as a file anyone can load. */
function saveTemplate(template) {
  const { filename, text } = templateFile(template)
  legacyDownload(filename, new Blob([text], { type: 'application/json' }))
}

// ── Skin libraries ─────────────────────────────────────────────────────
const skinLibraryInput = ref(null)

/** Adds the chosen skin library file to the user's own, or says what is wrong with it. */
async function onSkinLibraryFile(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file) return
  const { raw, errors: parseErrors } = await readTemplateFile(file, { what: 'a skin library' })
  const { library, errors, warnings } = parseErrors.length
    ? { library: null, errors: parseErrors, warnings: [] }
    : skinStore.addLocalLibrary(raw)
  if (!library) {
    notify.error({ title: `Could not load ${file.name}`, message: summariseProblems(errors) })
    return
  }
  const count = `${library.skins.length} skin${library.skins.length === 1 ? '' : 's'}`
  if (warnings.length) notify.warning({ title: `Loaded ${library.name}`, message: summariseProblems(warnings) })
  else notify.success({ title: `Loaded ${library.name}`, message: `${count} added to the Skin menus.` })
}

/** Downloads a skin library as a file anyone can load. */
function saveSkinLibraryFile(library) {
  const { filename, text } = skinLibraryFile(library)
  legacyDownload(filename, new Blob([text], { type: 'application/json' }))
}

/** Loading, saving and removing the user's own skin libraries. */
function skinLibraryMenu() {
  const own = skinStore.localLibraries
  const each = (icon, label, act) => ({
    label,
    icon,
    items: own.map((library) => ({ label: library.name, command: () => act(library) })),
  })
  return [
    { label: 'Load Skin Library…', icon: 'pi pi-upload', command: () => skinLibraryInput.value?.click() },
    ...(own.length
      ? [
          each('pi pi-download', 'Save Skin Library As File…', saveSkinLibraryFile),
          each('pi pi-trash', 'Remove Skin Library', (library) => skinStore.removeLocalLibrary(library.id)),
        ]
      : []),
  ]
}

/**
 * The Skin submenu for a protein or process: None for a process, then the skins for what it is, those its
 * annotations match first, then the libraries.
 *
 * @param {string} nodeId
 * @param {Object} role - From resolveBioRole: its skinContext and the skin it is drawn with.
 */
function moduleSkinMenu(nodeId, role) {
  const context = role.skinContext
  const item = (skin) => ({
    label: skin.name,
    icon: role.skin === skin.id ? 'pi pi-check' : undefined,
    command: () => chooseSkin([nodeId], skin.id),
  })
  return [
    ...(allowsNoSkin(context.target)
      ? [
          {
            label: 'None',
            icon: role.skin ? undefined : 'pi pi-check',
            command: () => chooseSkin([nodeId], NO_SKIN),
          },
          { separator: true },
        ]
      : []),
    ...skinsFor(context).map(item),
    { separator: true },
    ...skinLibraryMenu(),
  ]
}

function onNodeContextMenu({ event, node }) {
  event.preventDefault()
  // A piece with no module on it, a zone or a grip, is no diagram node: only the piece's menu.
  const place = layout.value.get(node.id)
  if (!main.findNode(node.id)) {
    const here = newModuleItem(event)
    const items = pieceMenu(place)
    menuItems.value = [...here, ...items.slice(here.length ? 0 : 1)]
    if (!menuItems.value.length) return
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
  ]
  if (role?.skinContext && !isJointNode(node.id)) {
    items.push({
      label: 'Skin',
      icon: 'pi pi-palette',
      items: moduleSkinMenu(node.id, role),
    })
  }
  // A module drawn as its tube's joint is drawn by the tube's skin.
  const jointTube = isJointNode(node.id) ? skinnedPieceOfNode(node.id) : null
  const jointItems = jointTube ? skinMenu(jointTube) : []
  if (jointItems.length) items.push({ label: 'Skin', icon: 'pi pi-image', items: jointItems })
  items.push(connectionsMenu(node.id, main.nodes.value, main.edges.value, (edgeId) => emit('open-edge-dialog', edgeId)))
  items.push(...primeMenuItems(props.parameterSetMenu?.(node.id) ?? [], { 'Apply Parameter Set': 'pi pi-sliders-h' }))
  // On a piece of the pieces: what can be done to the piece itself.
  if (place?.piece) items.push(...pieceMenu(place))
  // Bound to a site of the pieces that is there: unbound, it is drawn as its annotations say, beside the pieces.
  const site = role?.site && place?.instance ? sites.value.find((entry) => entry.ref === role.site) : null
  const unbind = () =>
    takeOut(node.id, planUnbind({ id: node.id, position: trayPosition(), ...planContext() }), 'bio-unbind')
  if (site && place?.kind === 'protein') {
    items.push({ label: 'Take Out of Membrane', icon: 'pi pi-sign-out', command: unbind })
  }
  if (site) {
    items.push({ label: `Unbind from "${site.label}"`, icon: 'pi pi-link', command: unbind })
  }
  if (main.findNode(node.id)?.data?.bioView?.speciesOrder) {
    items.push({
      label: 'Reset Species Order',
      icon: 'pi pi-sort-alt',
      command: () => setChoice(node.id, { speciesOrder: undefined }, 'bio-species-order'),
    })
  }
  items.push(
    { separator: true },
    {
      label: deletionLabel(node.id, main.nodes.value),
      icon: 'pi pi-trash',
      command: () => deleteNodes(deletionScope(node.id, main.nodes.value)),
    }
  )
  menuItems.value = items
  contextMenu.value.show(event)
}

/**
 * Deletes instances from the workspace, with their edges, as the diagram's Delete does: one undo step.
 *
 * @param {Array<string>} ids - Diagram node ids.
 * @returns {Promise<boolean>} Whether anything was asked to go.
 */
async function deleteNodes(ids) {
  const going = ids.filter((id) => main.findNode(id))
  return deleteInstances(going, { removeNodes: main.removeNodes, history })
}

/**
 * The module a piece's own node holds apart from it, if any: a cell's membrane's (drawn as a band over it), or a
 * tube's (drawn as a card in its room). A compartment's module is drawn as the piece itself, so it is never apart.
 */
function moduleApartFrom(id, place) {
  if (place.kind === 'cell') return place.membrane ?? null
  if (place.kind === 'link') {
    for (const [cardId, card] of layout.value) if (card.kind === 'card' && card.link === id) return cardId
  }
  return null
}

/**
 * What Delete takes of the selection, a layer at a time: a module before the piece it is on. A selected node that
 * is a module (a piece holding one is drawn as its module's node) loses only its module, leaving the piece empty. A
 * cell's inside, once empty, is its compartment, which goes with everything attached to it: its membrane, and what
 * is docked to that, the modules on them deleted. Any other selected empty piece loses its own module if it holds
 * one apart, else goes itself, as its Remove would take it; an empty membrane's band takes the membrane alone. Grips
 * are handles on a piece, not the piece, so they are left out.
 *
 * @returns {{instances: string[], pieces: string[], compartments: string[]}} compartments: the cells' insides to go.
 */
function deletionLayers() {
  const instances = new Set(main.nodes.value.filter((node) => node.selected).map((node) => node.id))
  const pieces = new Set()
  const compartments = new Set()
  for (const node of getSelectedNodes.value) {
    if (main.findNode(node.id)) {
      instances.add(node.id)
      continue
    }
    const place = layout.value.get(node.id)
    const piece = place?.piece && place.kind !== 'grip' && piecesStore.pieces.find((each) => each.id === place.piece)
    if (!piece) continue
    if (place.kind === 'cell' && place.bulk) {
      compartments.add(place.bulk)
      continue
    }
    const held = moduleApartFrom(node.id, place)
    if (held && main.findNode(held)) {
      instances.add(held)
      continue
    }
    pieces.add(piece.id)
    if (place.kind === 'cell') for (const id of piece.encloses ?? []) pieces.add(id)
  }
  return { instances: [...instances], pieces: [...pieces], compartments: [...compartments] }
}

/**
 * Deletes the selection, for the workspace's Delete and Backspace keys, a layer at a time (see deletionLayers): the
 * modules first, then the empty pieces.
 */
async function deleteSelection() {
  const { instances, pieces, compartments } = deletionLayers()
  if (instances.length && !(await deleteNodes(instances))) return
  if (compartments.length) await removeThesePieces([...compartments, ...pieces], { withModules: true })
  else if (pieces.length) await removeThesePieces(pieces)
}

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
    {
      label: 'Add Template',
      icon: 'pi pi-objects-column',
      items: addTemplateMenu(at),
    },
    ...(piecesStore.pieces.length
      ? [{ label: 'Save Pieces As Template File…', icon: 'pi pi-download', command: savePiecesAsTemplate }]
      : []),
    { label: 'Skin Libraries', icon: 'pi pi-palette', items: skinLibraryMenu() },
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

/**
 * Whether a drag is a module from the library: its data says so and it carries no files. The library's
 * drag state alone can be left over from a drag that was cancelled.
 */
function isLibraryDrag(event) {
  const types = [...(event.dataTransfer?.types ?? [])]
  return !!libraryDrag.draggedType.value && types.includes('application/vueflow') && !types.includes('Files')
}

function onModuleDragOver(event) {
  if (isTileDrag(event)) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    if (isPreviewedTile(draggedTile.value)) trackPiece(screenToFlowCoordinate({ x: event.clientX, y: event.clientY }))
    return
  }
  if (!isLibraryDrag(event)) return
  event.preventDefault()
  const point = screenToFlowCoordinate({ x: event.clientX, y: event.clientY })
  draggingId.value = 'library'
  trackDrag(point, targetAt(point))
}

function onModuleDragLeave(event) {
  if (event.currentTarget.contains(event.relatedTarget)) return
  clearPiecePreview()
  if (draggingId.value === 'library') draggingId.value = activeTarget.value = pointer.value = null
}

/**
 * Adds a library module dropped here: into the membrane slot or onto the template site it was dropped on, as
 * one step, or where it was dropped, asking what it is. Files dropped here go on to the workspace.
 */
async function onModuleDrop(event) {
  if (isTileDrag(event)) {
    event.preventDefault()
    event.stopPropagation()
    const tile = draggedTile.value ?? JSON.parse(event.dataTransfer.getData(TILE_DRAG_TYPE) || 'null')
    draggedTile.value = null
    draggingId.value = activeTarget.value = pointer.value = null
    if (tile) placeTile(tile, screenToFlowCoordinate({ x: event.clientX, y: event.clientY }))
    return
  }
  const module = libraryDrag.draggedType.value
  if (!isLibraryDrag(event) || !props.createInstance) return
  event.preventDefault()
  event.stopPropagation()
  // The library's own end-of-drag listener is on the document, which this drop doesn't reach.
  libraryDrag.draggedType.value = null
  libraryDrag.isDragging.value = false
  libraryDrag.isDragOver.value = false
  draggingId.value = activeTarget.value = pointer.value = null
  return placeModuleAt(module, screenToFlowCoordinate({ x: event.clientX, y: event.clientY }))
}

/** The library's new, empty module, which the Module tile and "New Module Here" add. */
const newModule = () => libraryStore.availableModules.get(NEW_INSTANCE_MODULE_REF) ?? null

/**
 * Adds a library module where it was dropped or the armed New Module tile put: into the membrane slot or onto the
 * template site there, or loose where it was put, drawn as its annotations say; each as one step.
 *
 * @param {Object} module - A library module.
 * @param {{x: number, y: number}} point - In flow coordinates.
 * @returns {Promise<void>}
 */
async function placeModuleAt(module, point) {
  const target = targetAt(point)
  if (target) {
    if (!(await confirmReplace(target.site, null, module.moduleRef?.split(':')[0] ?? 'the new module'))) return
    await addModuleAt(module, target)
    return
  }
  props.createInstance(module, { position: whole({ x: point.x - CARD.width / 2, y: point.y - CARD.height / 2 }) })
}

/**
 * Adds an instance of a library module on a site of the pieces, joined to its neighbours there, as one step.
 *
 * @param {Object} module - A library module.
 * @param {{site: Object}} target - From targetAt.
 * @returns {Promise<string>} The instance's id.
 */
async function addModuleAt(module, target) {
  history.startBatch()
  try {
    // A placeholder there goes, for the module to take its place.
    const replaced = replacedOccupant(target.site, null)
    if (replaced && isPlaceholder(main.findNode(replaced), main.edges.value)) main.removeNodes([replaced], true)
    return await addModuleIn(module, target)
  } finally {
    history.endBatch('bio-add')
  }
}

/**
 * Adds an instance of a library module as addModuleAt does, in the step already open.
 *
 * @returns {Promise<string>} The new instance's id.
 */
async function addModuleIn(module, { site }) {
  // An instance of the module, bound to the site; planned against the sites as they were drawn.
  const id = props.createInstance(module, {})
  await applyPlan(planSiteBind({ id, site, ...planContext() }), 'bio-add')
  await connectToNeighbours(id, site)
  return id
}

/**
 * The "New Module Here" item, where the menu opened on an empty template site or a slot: it adds a new module
 * there, as a drop of one would. The first save of its maths makes it a module of its own.
 *
 * @param {MouseEvent} event - The menu's.
 * @returns {Array<Object>} The item, or none.
 */
function newModuleItem(event) {
  const module = newModule()
  if (!module || !props.createInstance) return []
  const target = targetAt(screenToFlowCoordinate({ x: event.clientX, y: event.clientY }))
  if (!target || replacedOccupant(target.site, null)) return []
  return [
    {
      label: 'New Module Here',
      icon: 'pi pi-file-plus',
      command: async () => openEditor(await addModuleAt(module, target)),
    },
  ]
}

/** Whether one of the view's dialogs is open, so the workspace's shortcuts wait. */
const isDialogOpen = computed(() => !!renaming.value || !!renamingNode.value || isConfirming.value)
/**
 * What the properties panel reads and sets while this view is open: the roles, the skins, the pieces selected that
 * are no module's, and the choices the menus make.
 */
const properties = { roles, chooseSkin, skinOf, selectedPieceNodes }

defineExpose({ isDialogOpen, isMenuOpen, deleteSelection, properties })
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

.bio-species-leg {
  fill: none;
  stroke: var(--species);
  stroke-linecap: round;
  stroke-dasharray: 2 6;
  opacity: 0.55;
}

/* A path whose flow is known after a run: solid, with its dashes running the way the species goes, and arrowheads,
   fewer than the dashes, running with them along its path. The dashes and arrowheads keep running while the
   speciesFlowContinuous setting is on; off, they run a few times when the flow is shown, then rest, since an endless animation repaints the view every frame (Firefox can't run it off the main
   thread). A focused species' paths always run. */
.bio-species-path--moving > .bio-species-leg {
  stroke-linecap: butt;
  stroke-dasharray: 10 6;
  opacity: 0.9;
  animation: bio-species-flow 1.2s linear 4;
}

.bio-species-arrow {
  fill: var(--species);
  stroke: none;
  opacity: 0.9;
  offset-anchor: 0 0;
  offset-rotate: auto;
  offset-distance: var(--arrow-to);
  animation-name: bio-species-arrow-run;
  animation-timing-function: linear;
  animation-iteration-count: var(--arrow-runs);
}

.bio-species-path--focused > .bio-species-leg,
.bio-species-path--focused > .bio-species-arrow,
.bio-species--continuous .bio-species-path--moving > .bio-species-leg,
.bio-species--continuous .bio-species-path--moving > .bio-species-arrow {
  animation-iteration-count: infinite;
}

/* Nothing runs while the view is panned (paths hide while a node is dragged). */
.vue-flow__pane.dragging .bio-species-path--moving > .bio-species-leg,
.vue-flow__pane.dragging .bio-species-path--moving > .bio-species-arrow {
  animation-play-state: paused;
}

@keyframes bio-species-flow {
  to {
    stroke-dashoffset: -16;
  }
}

@keyframes bio-species-arrow-run {
  from {
    offset-distance: var(--arrow-from);
  }
  to {
    offset-distance: var(--arrow-to);
  }
}

@media (prefers-reduced-motion: reduce) {
  .bio-species-path--moving > .bio-species-leg,
  .bio-species-arrow {
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

/* Out of the column, against the species button's right side */
/* A palette tile is armed: the next click on the view places it */
.bio-flow-root--placing :deep(.vue-flow__pane),
.bio-flow-root--placing :deep(.vue-flow__node) {
  cursor: crosshair;
}

.bio-species-menu-button {
  position: absolute;
  left: 100%;
  bottom: 0;
  margin-left: 2px;
  border-radius: 4px;
  box-shadow: 0 0 2px 1px rgba(0, 0, 0, 0.08);
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

/* A piece's resize handle shows while the pointer is over it. */
.bio-flow :deep(.vue-flow__node:not(:hover) .bio-piece-resize) {
  opacity: 0;
}

/* Where a carried piece can't go: said in red. */
.bio-drop-label--invalid {
  border-color: var(--p-red-500);
  color: var(--p-red-600);
}

/* A carried piece's preview: what it would go on, solid, and where it would be drawn, a dashed ghost. */
.bio-piece-preview {
  position: absolute;
  overflow: visible;
  pointer-events: none;
}

.bio-piece-preview__target {
  fill: none;
  stroke: var(--bio-drop-active);
  stroke-width: 2;
  opacity: 0.7;
}

.bio-piece-preview__target--line {
  stroke-width: 8;
  stroke-linecap: round;
  opacity: 0.5;
}

.bio-piece-preview__ghost {
  fill: color-mix(in srgb, var(--bio-drop-active) 12%, transparent);
  stroke: var(--bio-drop-active);
  stroke-width: 2;
  stroke-dasharray: 8 5;
}

/* A membrane round what is there: the room it adds, shaded; the corners it rounds off, hatched out; its band. */
.bio-piece-preview__grows {
  fill: color-mix(in srgb, var(--bio-drop-active) 22%, transparent);
}

.bio-piece-preview__trims {
  fill: color-mix(in srgb, var(--p-text-muted-color) 30%, transparent);
}

.bio-piece-preview__moved {
  fill: color-mix(in srgb, var(--p-text-muted-color) 10%, transparent);
  stroke: var(--p-text-muted-color);
  stroke-width: 1.5;
  stroke-dasharray: 6 4;
}

.bio-piece-preview__band {
  fill: none;
  stroke: color-mix(in srgb, var(--bio-drop-active) 25%, transparent);
}

.bio-piece-preview__outline {
  fill: none;
  stroke: var(--bio-drop-active);
  stroke-width: 2;
  stroke-dasharray: 8 5;
}

.bio-piece-preview__way {
  fill: none;
  stroke: var(--bio-drop-active);
  stroke-width: 3;
  stroke-dasharray: 8 5;
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
