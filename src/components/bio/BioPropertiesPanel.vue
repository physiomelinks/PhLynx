<template>
  <div class="bio-properties-panel" data-testid="bio-properties-panel">
    <p v-if="!selected.length" class="hint">Select one or more instances to choose how they are shown here.</p>

    <!-- ── What the selection is shown as ─────────────────────────── -->
    <div v-else class="panel-block">
      <span class="block-title">
        Show as
        <span v-if="selected.length > 1" class="context-count">({{ selected.length }} selected)</span>
      </span>
      <Select
        :modelValue="commonRole"
        :options="roleOptions"
        optionLabel="label"
        optionValue="value"
        :placeholder="commonRole === null ? 'Mixed' : 'Choose a role'"
        size="small"
        class="w-full"
        data-testid="bio-properties-role"
        @update:modelValue="(role) => properties.chooseRole(ids, role)"
      />
    </div>

    <!-- ── The cartoon a protein or process is drawn with ─────────── -->
    <div v-if="canHaveGlyph" class="panel-block">
      <span class="block-title">Cartoon</span>
      <p v-if="commonGlyph === MIXED" class="hint">The selection has more than one cartoon.</p>
      <div class="glyph-tiles" role="group" aria-label="Cartoons" data-testid="bio-properties-glyphs">
        <button
          v-if="allProcesses"
          type="button"
          class="glyph-tile glyph-tile--none"
          :class="{ 'glyph-tile--active': commonGlyph === null }"
          :aria-pressed="commonGlyph === null"
          :data-glyph="NO_GLYPH"
          @click="properties.chooseGlyph(ids, NO_GLYPH)"
        >
          <span class="glyph-tile__art"></span>
          <span class="glyph-tile__name">None</span>
        </button>
        <button
          v-for="glyph in glyphs"
          :key="glyph.id"
          type="button"
          class="glyph-tile"
          :class="{ 'glyph-tile--active': commonGlyph === glyph.id }"
          :aria-pressed="commonGlyph === glyph.id"
          :data-glyph="glyph.id"
          :title="glyph.name"
          @click="properties.chooseGlyph(ids, glyph.id)"
        >
          <ProteinGlyph class="glyph-tile__art" :glyph="glyph.id" />
          <span class="glyph-tile__name">{{ glyph.name }}</span>
        </button>
      </div>
      <p class="hint">Load your own cartoons from Glyph Libraries in the view's right-click menu.</p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import Select from 'primevue/select'

import ProteinGlyph from './ProteinGlyph.vue'
import { BUILT_IN_GLYPHS, NO_GLYPH, loadedGlyphs } from '../../services/bioView/glyphs'
import { GLYPH_ROLES, ROLE_LABELS } from '../../services/bioView/roles'
import { FLOW_IDS, GHOST_NODE_TYPE } from '../../utils/constants'

const props = defineProps({
  /**
   * From the open physiology view (BioFlow's exposed `properties`): { roles: Ref<Map>, chooseRole(ids, role),
   * chooseGlyph(ids, glyph) }.
   */
  properties: { type: Object, required: true },
})

/** A choice the selection doesn't share. */
const MIXED = Symbol('mixed')

const { getSelectedNodes } = useVueFlow(FLOW_IDS.MAIN)
const selected = computed(() => getSelectedNodes.value.filter((node) => node.type !== GHOST_NODE_TYPE))
const ids = computed(() => selected.value.map((node) => node.id))
const selectedRoles = computed(() => ids.value.map((id) => props.properties.roles.value.get(id)))

const roleOptions = Object.entries(ROLE_LABELS).map(([value, label]) => ({ value, label }))

/** The value every selected node shares, or MIXED. */
function shared(values) {
  return values.every((value) => value === values[0]) ? values[0] : MIXED
}

/** The role the whole selection has, or null, which the select shows as Mixed. */
const commonRole = computed(() => {
  const role = shared(selectedRoles.value.map((entry) => entry?.role ?? 'none'))
  return role === MIXED ? null : role
})

const canHaveGlyph = computed(
  () => selectedRoles.value.length > 0 && selectedRoles.value.every((entry) => GLYPH_ROLES.has(entry?.role))
)
/** Only a process can be drawn without one: a protein always has a cartoon, generic by default. */
const allProcesses = computed(() => selectedRoles.value.every((entry) => entry?.role === 'cytosolic'))
const commonGlyph = computed(() => shared(selectedRoles.value.map((entry) => entry?.glyph ?? null)))

const glyphs = computed(() => [...BUILT_IN_GLYPHS, ...loadedGlyphs()])
</script>

<style scoped>
.bio-properties-panel {
  display: flex;
  flex-direction: column;
  gap: 1.25rem;
  overflow-y: auto;
  min-height: 0;
}

.panel-block {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.block-title {
  font-size: 0.85rem;
  font-weight: 600;
}

.context-count {
  font-weight: normal;
  color: var(--p-text-muted-color);
}

.hint {
  margin: 0;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.w-full {
  width: 100%;
}

.glyph-tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 0.4rem;
}

.glyph-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  padding: 0.4rem 0.35rem 0.3rem;
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  background: var(--p-content-background);
  color: var(--p-text-color);
  font: inherit;
  font-size: 0.75rem;
  cursor: pointer;
  min-width: 0;
}

.glyph-tile:hover {
  border-color: var(--p-primary-color);
}

.glyph-tile--active {
  border-color: var(--p-primary-color);
  box-shadow: 0 0 0 1px var(--p-primary-color);
}

.glyph-tile__art {
  width: 64px;
  height: 48px;
  flex: none;
}

.glyph-tile--none .glyph-tile__art {
  border-radius: 6px;
  background: repeating-linear-gradient(
    45deg,
    transparent 0 5px,
    color-mix(in srgb, var(--p-text-color) 18%, transparent) 5px 6px
  );
}

.glyph-tile__name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
