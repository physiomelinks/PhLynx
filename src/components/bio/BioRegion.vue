<template>
  <div
    :class="[
      'bio-region',
      `bio-region--tone-${tone}`,
      edge && `bio-region--edge-${edge}`,
      {
        'bio-region--selected': selected,
        'bio-region--empty': data.empty,
        'bio-region--template': data.instance,
        'bio-region--inner': data.form === 'inner' && !data.clip,
        'bio-region--drawn': !!data.clip,
        'bio-region--tube': data.shape === 'tube',
      },
    ]"
    :style="cutoutStyle"
    data-testid="bio-region"
    :data-site="data.site ?? undefined"
  >
    <!-- Its skin: artwork of the user's, filling it under its name -->
    <svg v-if="skin" class="bio-region__skin" :width="data.width" :height="data.height" data-testid="bio-skin">
      <image
        :href="skin.href"
        x="0"
        y="0"
        :width="data.width"
        :height="data.height"
        :preserveAspectRatio="skin.aspect"
        :opacity="skin.opacity"
      />
    </svg>
    <BioHandles :handles="data.handles ?? []" />
    <!-- A piece of the pieces is resized from its handle -->
    <BioPieceResize v-if="data.resize && id" :node-id="id" :position="data.resize.position" />
    <span class="bio-region__label" :style="labelStyle">
      <BioPieceName :id="id" :name="data.name" />
      <small v-if="data.empty" class="bio-region__hint" data-testid="bio-empty-hint">Drop a module</small>
    </span>
  </div>
</template>

<script setup>
import { computed, inject } from 'vue'
import BioHandles from './BioHandles.vue'
import BioPieceName from './BioPieceName.vue'
import BioPieceResize from './BioPieceResize.vue'
import { partOf } from '../../services/bioView/geometry'
import { EPITHELIAL_SHAPE, facetById } from '../../services/bioView/shape'

const props = defineProps({
  /** Its node id, for renaming it. */
  id: { type: String, default: null },
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
})

/** The colour of a region against each of the epithelial cell's facets, or of a region against none. */
const TONES = { apical: 'sky', basolateral: 'rose', lateral: 'teal' }
const DEFAULT_TONE = 'sky'

/**
 * The edge of the cell the region lies against: a template's own, else the epithelial facet it faces, a left
 * one with no side given, as layout puts it.
 */
const edge = computed(() => {
  if (props.data.instance) return props.data.edge ?? null
  if (!props.data.side) return null
  return facetById(EPITHELIAL_SHAPE, partOf(props.data.side, props.data.at ?? undefined))?.edge ?? null
})
/** The view's `(skin) => { href, aspect, opacity } | null`: the artwork a piece's skin names, if the workspace has it. */
const skinOf = inject('bioSkinOf', () => null)
const skin = computed(() => skinOf(props.data.skin))

/** A microdomain round a fold leaves the fold clear: the fold is the cell's, drawn under it. */
const cutoutStyle = computed(() => {
  // An area a skin draws is drawn to its own outline, not its box.
  const clip = props.data.clip
  if (clip?.length) return { clipPath: `polygon(${clip.map((point) => `${point.x}px ${point.y}px`).join(', ')})` }
  const hole = props.data.cutout
  if (!hole) return undefined
  const { x, y, width, height, radius } = hole
  const r = Math.min(radius, width / 2, height / 2)
  const cut = `M ${x + r} ${y} H ${x + width - r} A ${r} ${r} 0 0 1 ${x + width} ${y + r} V ${y + height - r} A ${r} ${r} 0 0 1 ${x + width - r} ${y + height} H ${x + r} A ${r} ${r} 0 0 1 ${x} ${y + height - r} V ${y + r} A ${r} ${r} 0 0 1 ${x + r} ${y} Z`
  return { clipPath: `path(evenodd, "M -4 -4 H 100000 V 100000 H -4 Z ${cut}")` }
})

/** Where the layout found room for its name, clear of the compartments nested in it (see regionNameAt). */
const labelStyle = computed(() => {
  const at = props.data.nameAt
  return at ? { position: 'absolute', left: `${at.x}px`, top: `${at.y}px`, whiteSpace: 'nowrap' } : undefined
})

const tone = computed(() => (props.data.instance && props.data.tone) || TONES[props.data.side] || DEFAULT_TONE)
</script>

<style scoped>
.bio-region {
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 12px;
  background: color-mix(in srgb, var(--p-sky-200) 40%, transparent);
  border: 2px solid transparent;
}

.bio-region--tone-rose {
  background: color-mix(in srgb, var(--p-rose-200) 40%, transparent);
}

.bio-region--tone-teal {
  background: color-mix(in srgb, var(--p-teal-200) 45%, transparent);
}

.bio-region--tone-amber {
  background: color-mix(in srgb, var(--p-amber-200) 40%, transparent);
}

.bio-region--tone-violet {
  background: color-mix(in srgb, var(--p-violet-200) 40%, transparent);
}

.bio-region--tone-lime {
  background: color-mix(in srgb, var(--p-lime-200) 40%, transparent);
}

.bio-region--tone-slate {
  background: color-mix(in srgb, var(--p-slate-200) 40%, transparent);
}

/* Its top runs under the cells, so its name goes at the bottom, clear of their corners */
.bio-region--edge-bottom .bio-region__label {
  position: absolute;
  left: 0;
  bottom: 0;
}

/* Narrow, down a cell's side, so its name runs down it, on the outer side away from the cell */
.bio-region--edge-left .bio-region__label,
.bio-region--edge-right .bio-region__label {
  writing-mode: vertical-rl;
  padding: 12px 8px;
}

.bio-region--edge-right .bio-region__label {
  position: absolute;
  top: 0;
  right: 0;
}

.bio-region--selected {
  border-color: var(--p-primary-color);
}

/*
 * A template's compartment runs under its cells' rounded corners on one side, or on both for the gap between
 * two cells, so its name goes midway across it, where no cell covers it.
 */
.bio-region--template.bio-region--edge-top .bio-region__label,
.bio-region--template.bio-region--edge-bottom .bio-region__label {
  position: absolute;
  left: 0;
  top: 50%;
  bottom: auto;
  transform: translateY(-50%);
}

.bio-region--template.bio-region--edge-left .bio-region__label,
.bio-region--template.bio-region--edge-right .bio-region__label {
  position: absolute;
  top: 50%;
  left: 50%;
  right: auto;
  padding: 0;
  transform: translate(-50%, -50%);
  white-space: nowrap;
}

/* A microdomain lies over its cell: on the view's own background, so its colour is its own and not the cell's too */
.bio-region--inner::before {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  border-radius: inherit;
  background: var(--p-content-background);
}

/* A tube, a stretch of vessel or duct: walls along its length, open at its ends */
.bio-region--tube,
.bio-region--tube.bio-region--empty {
  border-radius: 0;
  border-left: 0;
  border-right: 0;
  border-top: 6px solid color-mix(in srgb, var(--p-text-muted-color) 55%, transparent);
  border-bottom: 6px solid color-mix(in srgb, var(--p-text-muted-color) 55%, transparent);
}

.bio-region--tube.bio-region--selected {
  border-top-color: var(--p-primary-color);
  border-bottom-color: var(--p-primary-color);
}

/* An area a skin draws shows the skin's artwork through its tint, and is outlined by the skin, not by a box */
.bio-region--drawn,
.bio-region--drawn.bio-region--empty {
  border-color: transparent;
}

.bio-region--empty {
  border: 2px dashed color-mix(in srgb, var(--p-text-muted-color) 45%, transparent);
  opacity: 0.75;
}

.bio-region--empty.bio-region--selected {
  border-color: var(--p-primary-color);
}

.bio-region__hint {
  display: block;
  font-weight: 400;
  font-size: 0.75rem;
}

.bio-region__skin {
  position: absolute;
  top: 0;
  left: 0;
  border-radius: inherit;
  overflow: hidden;
  pointer-events: none;
}

.bio-region__label {
  position: relative;
  display: block;
  padding: 8px 12px;
  font-weight: 600;
  color: var(--p-text-muted-color);
}
</style>
