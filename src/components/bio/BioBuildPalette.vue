<template>
  <div class="bio-palette" aria-label="Build the physiology view" data-testid="bio-palette">
    <p class="bio-palette__hint">
      Drag a piece onto the physiology view, or click it and then click where it goes. Drop modules on what you build,
      or a new module to write its math there.
    </p>

    <h5 class="bio-palette__heading">Modules</h5>
    <div class="bio-palette__tiles">
      <button
        type="button"
        :class="['bio-palette__tile', { 'bio-palette__tile--armed': viewMode.armedTile?.kind === 'module' }]"
        :draggable="!!newModule"
        :disabled="!newModule"
        title="A module with no math yet: drop it on a site, or anywhere, and write its math in the editor that opens"
        :aria-pressed="viewMode.armedTile?.kind === 'module'"
        data-testid="bio-palette-new-module"
        @dragstart="onModuleDragStart"
        @dragend="onModuleDragEnd"
        @click="toggle({ kind: 'module' })"
      >
        <i class="pi pi-file-plus" aria-hidden="true"></i>
        New module
      </button>
    </div>

    <h5 class="bio-palette__heading">Pieces</h5>
    <div class="bio-palette__tiles">
      <button
        v-for="tile in PALETTE_TILES"
        :key="tile.kind"
        type="button"
        :class="['bio-palette__tile', { 'bio-palette__tile--armed': viewMode.armedTile?.kind === tile.kind }]"
        draggable="true"
        :title="tile.hint"
        :aria-pressed="viewMode.armedTile?.kind === tile.kind"
        data-testid="bio-palette-tile"
        :data-kind="tile.kind"
        @dragstart="onDragStart($event, { kind: tile.kind })"
        @dragend="viewMode.draggedTile = null"
        @click="toggle({ kind: tile.kind })"
      >
        <i :class="tile.icon" aria-hidden="true"></i>
        {{ tile.label }}
      </button>
    </div>

    <h5 class="bio-palette__heading">Templates</h5>
    <div class="bio-palette__templates">
      <button
        v-for="template in templateStore.library"
        :key="template.id"
        type="button"
        :class="['bio-palette__tile', { 'bio-palette__tile--armed': viewMode.armedTile?.template === template.id }]"
        draggable="true"
        :title="template.description ?? `${template.name}: drag onto the view`"
        :aria-pressed="viewMode.armedTile?.template === template.id"
        data-testid="bio-palette-template"
        :data-template="template.id"
        @dragstart="onDragStart($event, { kind: 'template', template: template.id })"
        @dragend="viewMode.draggedTile = null"
        @click="toggle({ kind: 'template', template: template.id })"
      >
        <i class="pi pi-objects-column" aria-hidden="true"></i>
        {{ template.name }}
      </button>
      <button
        type="button"
        class="bio-palette__tile bio-palette__tile--action"
        data-testid="bio-palette-load-template"
        @click="viewMode.templateFileRequests += 1"
      >
        <i class="pi pi-upload" aria-hidden="true"></i>
        Load file…
      </button>
    </div>

    <!-- The templates written as the five fundamental pieces, while they are being built -->
    <template v-if="showPieces">
      <h5 class="bio-palette__heading">Templates from pieces (preview)</h5>
      <div class="bio-palette__templates">
        <button
          v-for="template in BUILT_IN_PIECE_TEMPLATES"
          :key="template.id"
          type="button"
          :class="[
            'bio-palette__tile',
            { 'bio-palette__tile--armed': isSame(viewMode.armedTile, { kind: 'pieces', template: template.id }) },
          ]"
          draggable="true"
          :title="template.description ?? `${template.name}: drag onto the view`"
          :aria-pressed="isSame(viewMode.armedTile, { kind: 'pieces', template: template.id })"
          data-testid="bio-palette-pieces-template"
          :data-template="template.id"
          @dragstart="onDragStart($event, { kind: 'pieces', template: template.id })"
          @dragend="viewMode.draggedTile = null"
          @click="toggle({ kind: 'pieces', template: template.id })"
        >
          <i class="pi pi-th-large" aria-hidden="true"></i>
          {{ template.name }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup>
/**
 * The build palette, in the library's Build tab: tiles for what the physiology view can be built from, dragged onto
 * the view or clicked and then placed with a click on it. The view does the placing (see BioFlow); what is being
 * carried there is kept in the view-mode store.
 */
import { computed, onBeforeUnmount } from 'vue'

import useDragAndDrop from '../../composables/useDnD'

import { PALETTE_TILES, TILE_DRAG_TYPE, isPiecesPreview } from '../../services/bioView/palette'
import { BUILT_IN_PIECE_TEMPLATES } from '../../services/bioView/pieces/builtInTemplates'
import { useBioTemplateStore } from '../../stores/bioTemplateStore'
import { useLibraryStore } from '../../stores/libraryStore'
import { useViewModeStore } from '../../stores/viewModeStore'
import { NEW_INSTANCE_MODULE_REF } from '../../utils/constants'

const viewMode = useViewModeStore()
const templateStore = useBioTemplateStore()
const libraryStore = useLibraryStore()
const libraryDrag = useDragAndDrop()

/** The blank module the New Module tile adds: the one the library's own New Module adds. */
const newModule = computed(() => libraryStore.availableModules.get(NEW_INSTANCE_MODULE_REF) ?? null)

/** Whether the templates written as pieces are offered (see isPiecesPreview). */
const showPieces = isPiecesPreview()

const isSame = (a, b) => !!a && !!b && a.kind === b.kind && a.template === b.template

/** Arms a tile for placing with a click on the view, or lets go of the one armed. */
function toggle(tile) {
  viewMode.armedTile = isSame(viewMode.armedTile, tile) ? null : tile
}

function onDragStart(event, tile) {
  event.dataTransfer.setData(TILE_DRAG_TYPE, JSON.stringify(tile))
  event.dataTransfer.effectAllowed = 'copy'
  viewMode.armedTile = null
  viewMode.draggedTile = tile
}

/** Carries a new module as a drag from the library would, so the view places it as it places one of those. */
function onModuleDragStart(event) {
  viewMode.armedTile = null
  libraryDrag.onDragStart(event, newModule.value)
}

/** A drag let go of anywhere but a drop target carries nothing on. */
function onModuleDragEnd() {
  libraryDrag.draggedType.value = null
  libraryDrag.isDragging.value = false
}

// Nothing stays armed once the tab is left.
onBeforeUnmount(() => {
  viewMode.armedTile = null
  viewMode.draggedTile = null
})
</script>

<style scoped>
.bio-palette {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding: 0.5rem 0.75rem 1rem;
  font-size: 0.8125rem;
}

.bio-palette__hint {
  margin: 0 0 0.25rem;
  font-size: 0.75rem;
  line-height: 1.35;
  color: var(--p-text-muted-color);
}

.bio-palette__heading {
  margin: 0.5rem 0 0.125rem;
  font-size: 0.6875rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--p-text-muted-color);
}

.bio-palette__tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(6.5rem, 1fr));
  gap: 0.375rem;
}

.bio-palette__templates {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.bio-palette__tile {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 0;
  padding: 0.4375rem 0.5rem;
  color: var(--p-text-color);
  background: var(--p-content-hover-background, transparent);
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  font: inherit;
  text-align: left;
  cursor: grab;
}

.bio-palette__tile:hover {
  border-color: var(--p-primary-color);
  color: var(--p-primary-color);
}

.bio-palette__tile:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 1px;
}

.bio-palette__tile--armed {
  color: var(--p-primary-color);
  border-color: var(--p-primary-color);
  background: color-mix(in srgb, var(--p-primary-color) 14%, transparent);
}

.bio-palette__tile--action {
  cursor: pointer;
  border-style: dashed;
}
</style>
