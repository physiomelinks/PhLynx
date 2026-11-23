<template>
  <div class="bio-properties-panel" data-testid="bio-properties-panel">
    <p v-if="!skinIds.length" class="hint">Select one or more instances to choose how they are shown here.</p>

    <!-- ── The skin a protein, process, compartment or membrane is drawn with ─────────── -->
    <div v-if="skinContext" class="panel-block">
      <span class="block-title">Skin</span>
      <p v-if="commonSkin === MIXED" class="hint">The selection has more than one skin.</p>
      <div class="skin-tiles" role="group" aria-label="Skins" data-testid="bio-properties-skins">
        <button
          v-if="noneAllowed"
          type="button"
          class="skin-tile skin-tile--none"
          :class="{ 'skin-tile--active': commonSkin === null }"
          :aria-pressed="commonSkin === null"
          :data-skin="NO_SKIN"
          @click="properties.chooseSkin(skinIds, NO_SKIN)"
        >
          <span class="skin-tile__art"></span>
          <span class="skin-tile__name">None</span>
        </button>
        <button
          v-for="skin in skins"
          :key="skin.id"
          type="button"
          class="skin-tile"
          :class="{ 'skin-tile--active': commonSkin === skin.id }"
          :aria-pressed="commonSkin === skin.id"
          :data-skin="skin.id"
          :title="skin.name"
          @click="properties.chooseSkin(skinIds, skin.id)"
        >
          <BioSymbol v-if="skin.renderer === 'symbol'" class="skin-tile__art" :skin="skin.id" />
          <img v-else-if="skin.renderer === 'area'" class="skin-tile__art skin-tile__picture" :src="skinHref(skin.svg)" alt="" />
          <span v-else-if="skin.renderer === 'joint'" class="skin-tile__art skin-tile__joint">
            <BioJointSymbol kind="flow" :skin="skin.id" :width="64" :height="48" />
          </span>
          <svg v-else class="skin-tile__art skin-tile__line" viewBox="0 0 120 90">
            <g transform="translate(14 14)">
              <BioMembraneLine :skin="skin.id" :width="92" :height="62" />
            </g>
          </svg>
          <span class="skin-tile__name">{{ skin.name }}</span>
        </button>
      </div>
      <p v-if="loadHint" class="hint">{{ loadHint }}</p>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import BioJointSymbol from './BioJointSymbol.vue'
import BioMembraneLine from './BioMembraneLine.vue'
import BioSymbol from './BioSymbol.vue'
import { NO_SKIN, allowsNoSkin, skinsFor } from '../../services/bioView/skinRegistry'
import { skinHref } from '../../services/bioView/skins'
import { FLOW_IDS, GHOST_NODE_TYPE } from '../../utils/constants'

const props = defineProps({
  /**
   * From the open physiology view (BioFlow's exposed `properties`): { roles: Ref<Map>, chooseSkin(ids, skin),
   * skinOf(id), selectedPieceNodes: Ref<string[]> }. Without skinOf, a node's skin is its
   * role's.
   */
  properties: { type: Object, required: true },
})

/** A choice the selection doesn't share. */
const MIXED = Symbol('mixed')

const { getSelectedNodes } = useVueFlow(FLOW_IDS.MAIN)
const selected = computed(() => getSelectedNodes.value.filter((node) => node.type !== GHOST_NODE_TYPE))
const ids = computed(() => selected.value.map((node) => node.id))

/** The value every selected node shares, or MIXED. */
function shared(values) {
  return values.every((value) => value === values[0]) ? values[0] : MIXED
}

/** The selected nodes a skin is chosen for: the instances, and the pieces selected in the view with no module on them. */
const skinIds = computed(() => [...ids.value, ...(props.properties.selectedPieceNodes?.value ?? [])])

/** A node's skin: what it is for its skin, and the skin it is drawn with (null for none); null with no skin. */
const skinOfNode = (id) => {
  if (props.properties.skinOf) return props.properties.skinOf(id)
  const role = props.properties.roles.value.get(id)
  return role?.skinContext ? { context: role.skinContext, skin: role.skin } : null
}
const selectedSkins = computed(() => skinIds.value.map(skinOfNode))

/**
 * What the whole selection is, for its skin: the target every selected node shares, ranked by all their terms; null
 * where they are not all one thing with a skin.
 */
const skinContext = computed(() => {
  const contexts = selectedSkins.value.map((entry) => entry?.context ?? null)
  if (!contexts[0] || contexts.some((context) => context?.target !== contexts[0].target)) return null
  return { ...contexts[0], terms: [...new Set(contexts.flatMap((context) => context.terms))] }
})
/** Only some things can be drawn without one: a protein or membrane always has a skin. */
const noneAllowed = computed(() => !!skinContext.value && allowsNoSkin(skinContext.value.target))
const commonSkin = computed(() => shared(selectedSkins.value.map((entry) => entry?.skin ?? null)))

/** The skins for what the selection is, those their annotations match first. */
const skins = computed(() => skinsFor(skinContext.value))

/** Where more skins come from, for what the selection is. */
const loadHint = computed(
  () =>
    ({
      module: "Load your own skins from Skin Libraries in the view's right-click menu.",
      area: "Load an SVG drawing from the Skin menu of what it fills.",
      tube: "Load your own symbols for joints from Skin Libraries in the view's right-click menu.",
    })[skinContext.value?.family] ?? null
)
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

.skin-tiles {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
  gap: 0.4rem;
}

.skin-tile {
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

.skin-tile:hover {
  border-color: var(--p-primary-color);
}

.skin-tile--active {
  border-color: var(--p-primary-color);
  box-shadow: 0 0 0 1px var(--p-primary-color);
}

.skin-tile__art {
  width: 64px;
  height: 48px;
  flex: none;
}

.skin-tile--none .skin-tile__art {
  border-radius: 6px;
  background: repeating-linear-gradient(
    45deg,
    transparent 0 5px,
    color-mix(in srgb, var(--p-text-color) 18%, transparent) 5px 6px
  );
}

.skin-tile__picture {
  object-fit: contain;
}

.skin-tile__line {
  --bilayer-head: var(--p-amber-700);
  --bilayer-tail: var(--p-amber-600);
  --bilayer-core: color-mix(in srgb, var(--p-amber-200) 70%, var(--p-content-background));
}

.skin-tile__name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
