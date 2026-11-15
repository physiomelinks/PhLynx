<template>
  <aside
    :class="['bio-palette', { 'bio-palette--collapsed': isCollapsed }]"
    aria-label="Build the physiology view"
    data-testid="bio-palette"
  >
    <button
      type="button"
      class="bio-palette__heading"
      :aria-expanded="!isCollapsed"
      :title="isCollapsed ? 'Show what can be added' : 'Hide'"
      data-testid="bio-palette-toggle"
      @click="setCollapsed(!isCollapsed)"
    >
      <i class="pi pi-hammer" aria-hidden="true"></i>
      <span>Build</span>
      <i :class="['pi', isCollapsed ? 'pi-angle-right' : 'pi-angle-left']" aria-hidden="true"></i>
    </button>
    <template v-if="!isCollapsed">
      <p class="bio-palette__hint">Drag onto the view, or click then click where it goes. Drop modules on what you build.</p>
      <button
        v-for="tile in tiles"
        :key="tile.kind"
        type="button"
        :class="['bio-palette__tile', { 'bio-palette__tile--armed': armed?.kind === tile.kind }]"
        draggable="true"
        :title="tile.hint"
        :aria-pressed="armed?.kind === tile.kind"
        data-testid="bio-palette-tile"
        :data-kind="tile.kind"
        @dragstart="onDragStart($event, { kind: tile.kind })"
        @dragend="emit('drag', null)"
        @click="toggle({ kind: tile.kind })"
      >
        <i :class="tile.icon" aria-hidden="true"></i>
        {{ tile.label }}
      </button>

      <button
        type="button"
        class="bio-palette__tile bio-palette__tile--more"
        :aria-expanded="isShowingTemplates"
        data-testid="bio-palette-templates"
        @click="isShowingTemplates = !isShowingTemplates"
      >
        <i class="pi pi-objects-column" aria-hidden="true"></i>
        Templates
        <i :class="['pi', isShowingTemplates ? 'pi-angle-up' : 'pi-angle-down']" aria-hidden="true"></i>
      </button>
      <div v-if="isShowingTemplates" class="bio-palette__templates">
        <button
          v-for="template in templates"
          :key="template.id"
          type="button"
          :class="[
            'bio-palette__tile',
            'bio-palette__tile--template',
            { 'bio-palette__tile--armed': armed?.template === template.id },
          ]"
          draggable="true"
          :title="`${template.name}: drag onto the view`"
          :aria-pressed="armed?.template === template.id"
          data-testid="bio-palette-template"
          :data-template="template.id"
          @dragstart="onDragStart($event, { kind: 'template', template: template.id })"
          @dragend="emit('drag', null)"
          @click="toggle({ kind: 'template', template: template.id })"
        >
          {{ template.name }}
        </button>
        <button type="button" class="bio-palette__tile bio-palette__tile--template" @click="emit('load-template')">
          <i class="pi pi-upload" aria-hidden="true"></i>
          Load file…
        </button>
      </div>
    </template>
  </aside>
</template>

<script setup>
/**
 * The build palette: tiles for what the physiology view can be built from, dragged onto the view or clicked and then
 * placed with a click on it. The view does the placing; this only says what is being carried.
 */
import { ref } from 'vue'

import { PALETTE_TILES, TILE_DRAG_TYPE } from '../../services/bioView/palette'

const props = defineProps({
  /** The templates that can be placed: { id, name }. */
  templates: { type: Array, default: () => [] },
  /** The tile clicked and waiting for a place: { kind, template? }, or null. */
  armed: { type: Object, default: null },
})
// arm: the tile clicked, or null to let it go; drag: the tile being dragged, or null as the drag ends.
const emit = defineEmits(['arm', 'drag', 'load-template'])

const COLLAPSED_KEY = 'phlynx.bioPalette.collapsed'

/** Reads whether the viewer left the palette open; it starts folded away, clear of the view, as it does where nothing is kept. */
function readCollapsed() {
  try {
    return localStorage.getItem(COLLAPSED_KEY) !== '0'
  } catch {
    return true
  }
}

const isCollapsed = ref(readCollapsed())
const isShowingTemplates = ref(false)
const tiles = PALETTE_TILES

function setCollapsed(value) {
  isCollapsed.value = value
  if (value) emit('arm', null)
  try {
    localStorage.setItem(COLLAPSED_KEY, value ? '1' : '0')
  } catch {
    // Remembered for this visit only.
  }
}

const isSame = (a, b) => !!a && !!b && a.kind === b.kind && a.template === b.template

/** Arms a tile for placing with a click on the view, or lets go of the one armed. */
function toggle(tile) {
  emit('arm', isSame(props.armed, tile) ? null : tile)
}

function onDragStart(event, tile) {
  event.dataTransfer.setData(TILE_DRAG_TYPE, JSON.stringify(tile))
  event.dataTransfer.effectAllowed = 'copy'
  emit('arm', null)
  emit('drag', tile)
}
</script>

<style scoped>
.bio-palette {
  position: absolute;
  top: 44px;
  left: 12px;
  z-index: 6;
  /* Clear of the library panel, which lies over the view's left side, as the view's controls are */
  transform: translateX(var(--library-panel-width, 0px));
  transition: transform 160ms ease;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  width: 9.5rem;
  max-height: calc(100% - 15rem);
  overflow-y: auto;
  padding: 0.375rem;
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 8px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
  font-size: 0.8125rem;
}

.bio-palette--collapsed {
  width: auto;
}

.bio-palette__heading {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.125rem 0.25rem;
  color: var(--p-text-muted-color);
  background: none;
  border: 0;
  border-radius: 4px;
  font: inherit;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  cursor: pointer;
}

.bio-palette__heading span {
  flex: 1;
  text-align: left;
}

.bio-palette__hint {
  margin: 0 0.25rem 0.125rem;
  font-size: 0.6875rem;
  line-height: 1.3;
  color: var(--p-text-muted-color);
}

.bio-palette__tile {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.375rem 0.5rem;
  color: var(--p-text-color);
  background: var(--p-content-hover-background, transparent);
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  font: inherit;
  text-align: left;
  cursor: grab;
}

.bio-palette__tile:hover,
.bio-palette__heading:hover {
  border-color: var(--p-primary-color);
  color: var(--p-primary-color);
}

.bio-palette__tile:focus-visible,
.bio-palette__heading:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 1px;
}

.bio-palette__tile--armed {
  color: var(--p-primary-color);
  border-color: var(--p-primary-color);
  background: color-mix(in srgb, var(--p-primary-color) 14%, transparent);
}

.bio-palette__tile--more {
  cursor: pointer;
}

.bio-palette__tile--more .pi:last-child {
  margin-left: auto;
}

.bio-palette__templates {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  padding-left: 0.5rem;
}

.bio-palette__tile--template {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
}
</style>
