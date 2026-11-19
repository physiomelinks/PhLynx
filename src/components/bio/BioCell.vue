<template>
  <div
    :class="[
      'bio-cell',
      { 'bio-cell--selected': selected, 'bio-cell--empty': isEmpty, 'bio-cell--own-membrane': !data.membrane },
    ]"
    data-testid="bio-cell"
    :data-site="data.site ?? undefined"
  >
    <svg class="bio-cell__art" :width="width" :height="height" :viewBox="`0 0 ${width} ${height}`" overflow="visible">
      <!-- A template's cell with no module in it yet: just where it goes -->
      <path v-if="isEmpty" class="bio-cell__outline" :d="leaflet(0)" data-testid="bio-cell-outline" />
      <path v-else class="bio-cell__cytosol" :d="leaflet(-HEAD_OFFSET)" />
      <!-- Its skin: artwork of the user's, within its outline, under everything else in it -->
      <template v-if="skin">
        <clipPath :id="skinClipId"><path :d="leaflet(-HEAD_OFFSET)" /></clipPath>
        <image
          class="bio-cell__skin"
          :href="skin.href"
          x="0"
          y="0"
          :width="width"
          :height="height"
          :preserveAspectRatio="skin.aspect"
          :opacity="skin.opacity"
          :clip-path="`url(#${skinClipId})`"
          data-testid="bio-skin"
        />
      </template>
      <!-- A fold's lumen is the space outside: in the colour of the compartment against that side -->
      <path
        v-for="fold in folds"
        :key="`lumen-${fold.facetId}`"
        :class="['bio-cell__lumen', fold.tone && `bio-cell__lumen--${fold.tone}`]"
        :d="lumenPath(fold)"
        data-testid="bio-fold"
      />
      <!-- The lipid bilayer: two rows of head groups with their tails meeting in the middle; drawn too round an
           empty inside once a module is the membrane, so a bound membrane shows -->
      <g v-if="hasBilayer" class="bio-cell__bilayer" data-testid="bio-bilayer">
        <path class="bio-cell__core" :d="leaflet(0)" />
        <!-- Along an outline a skin draws, the membrane is two plain rows of heads; else lipid by lipid -->
        <template v-if="data.outline">
          <path class="bio-cell__membrane-heads" :d="data.outline" />
          <path class="bio-cell__membrane-tails" :d="data.outline" />
        </template>
        <BioBilayer v-else :width="width" :height="height" :folds="folds" />
      </g>
      <!-- Selected with its membrane a node of its own: a ring just inside the bilayer, which is the membrane's -->
      <path
        v-if="selected && data.membrane && hasBilayer"
        class="bio-cell__selection"
        :d="leaflet(-HEAD_OFFSET - SELECTION_INSET)"
        data-testid="bio-cell-selection"
      />
      <!-- A template's process areas, where cards for what goes on in the cell are put -->
      <g
        v-for="zone in data.zones ?? []"
        :key="zone.processId ?? 'process'"
        class="bio-cell__zone"
        data-testid="bio-process-zone"
      >
        <!-- Outlined only while empty, to say where a process goes: one in it is drawn as itself, as a protein is -->
        <rect v-if="!zone.filled" :x="zone.rect.x" :y="zone.rect.y" :width="zone.rect.width" :height="zone.rect.height" rx="8" />
        <text v-if="zone.label" :x="zone.rect.x + 8" :y="zone.rect.y + 12">{{ zone.label }}</text>
      </g>
    </svg>
    <!-- A template's names for its facets, just inside each edge, clear of its proteins -->
    <span
      v-for="label in facetLabels"
      :key="label.facetId"
      :class="['bio-cell__facet', `bio-cell__facet--${label.edge}`]"
      :style="label.style"
      data-testid="bio-facet-label"
    >
      {{ label.label }}
    </span>
    <!-- Each fold's name, past its end -->
    <span
      v-for="fold in folds"
      :key="`name-${fold.facetId}`"
      class="bio-cell__facet bio-cell__fold-name"
      :style="foldNameStyle(fold)"
      data-testid="bio-facet-label"
    >
      {{ fold.label }}
    </span>
    <BioHandles :handles="data.handles ?? []" />
    <!-- A piece of the pieces is resized from its handle -->
    <BioPieceResize v-if="data.resize && id" :node-id="id" :position="data.resize.position" />
    <span class="bio-cell__label" :style="labelStyle">
      <BioPieceName :id="id" :name="data.name" />
      <!-- Not on a template's cell that takes no module of its own, as one that is all microdomains inside -->
      <small v-if="data.empty && data.site !== null" class="bio-cell__hint" data-testid="bio-empty-hint">Drop a module</small>
    </span>
  </div>
</template>

<script setup>
import { computed, inject, useId } from 'vue'
import BioBilayer from './BioBilayer.vue'
import BioHandles from './BioHandles.vue'
import BioPieceName from './BioPieceName.vue'
import BioPieceResize from './BioPieceResize.vue'
import { HEAD_OFFSET, foldPoint, leafletPath } from '../../services/bioView/geometry'

const props = defineProps({
  /** Its node id, for renaming it. */
  id: { type: String, default: null },
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
  width: { type: Number, required: true },
  height: { type: Number, required: true },
})

/** Whether the bilayer is drawn: on a cell with a module inside it, or with one as its membrane. */
/**
 * Whether it is a place still waiting for its module. A template's cell that takes none of its own, being all
 * spaces inside, is never waiting: it is drawn as a cell from the start.
 */
const isEmpty = computed(() => !!props.data.empty && props.data.site !== null)
const hasBilayer = computed(() => !isEmpty.value || !!props.data.membrane)

/** How far inside the bilayer's inner head groups a selected cell's ring is drawn. */
const SELECTION_INSET = 6

/** How far in from the outline a facet's name sits, clear of the bilayer drawn over the edge. */
const FACET_INSET = 14

/**
 * Each facet's name: where the layout found room along its edge (see facetLabelBoxes), else spread along its edge
 * when an edge has more than one.
 */
const facetLabels = computed(() => {
  const labels = props.data.facetLabels ?? []
  return labels.map((label) => {
    if (Number.isFinite(label.x) && Number.isFinite(label.y)) {
      const style = { left: `${label.x}px`, top: `${label.y}px`, width: `${label.width}px`, height: `${label.height}px` }
      return { ...label, style }
    }
    const along = labels.filter((other) => other.edge === label.edge)
    const share = `${(100 * along.indexOf(label)) / along.length}%`
    const span = `${100 / along.length}%`
    const style = {
      top: { top: `${FACET_INSET}px`, left: share, width: span },
      bottom: { bottom: `${FACET_INSET}px`, left: share, width: span },
      left: { left: `${FACET_INSET}px`, top: share, height: span },
      right: { right: `${FACET_INSET}px`, top: share, height: span },
    }[label.edge]
    return { ...label, style }
  })
})

/**
 * The name goes where the layout found room, in a corner clear of the proteins (see cellNameBox). An empty
 * template cell's name and hint are centred where a drop goes to the cell (see cellHint); else centred low.
 */
const labelStyle = computed(() => {
  const hint = props.data.empty && props.data.hintAt
  if (hint) return { left: `${hint.x}px`, top: `${hint.y}px`, bottom: 'auto', transform: 'translate(-50%, -50%)' }
  const at = props.data.nameAt
  if (!at) return undefined
  return { left: `${at.x}px`, top: `${at.y}px`, bottom: 'auto', transform: 'none', whiteSpace: 'nowrap' }
})

/** The view's `(skin) => { href, aspect, opacity } | null`: the artwork a piece's skin names, if the workspace has it. */
const skinOf = inject('bioSkinOf', () => null)
const skin = computed(() => skinOf(props.data.skin))
const skinClipId = `bio-skin-${useId()}`

/** The cell's folds, each where it is in the cell (see foldPocket). */
const folds = computed(() => props.data.folds ?? [])

/**
 * The cell's outline grown by an offset, outward when positive; it dips in round each fold. An outline a skin draws
 * is as it is drawn, whatever the offset.
 */
const leaflet = (offset) => props.data.outline ?? leafletPath(props.width, props.height, offset, folds.value)

const box = computed(() => ({ x: 0, y: 0, width: props.width, height: props.height }))

/** A fold's lumen: from its mouth down between its walls and round its end. */
function lumenPath({ edge, at, half, depth }) {
  const point = (along, inward) => {
    const { x, y } = foldPoint(box.value, edge, along, inward)
    return `${x} ${y}`
  }
  const end = depth - half
  // The end is rounded the same way whichever side the fold is in from, as seen from its mouth.
  const sweep = edge === 'top' || edge === 'right' ? 0 : 1
  return `M ${point(at - half, 0)} L ${point(at - half, end)} A ${half} ${half} 0 0 ${sweep} ${point(at + half, end)} L ${point(at + half, 0)} Z`
}

/** Where a fold's name goes: centred a little past its end. */
function foldNameStyle({ edge, at, depth }) {
  const { x, y } = foldPoint(box.value, edge, at, depth + 14)
  return { left: `${x}px`, top: `${y}px`, transform: 'translate(-50%, -50%)', whiteSpace: 'nowrap' }
}
</script>

<style scoped>
.bio-cell {
  position: relative;
  width: 100%;
  height: 100%;
  --bilayer-head: var(--p-amber-700);
  --bilayer-tail: var(--p-amber-600);
}

.bio-cell__art {
  position: absolute;
  inset: 0;
}

/* A fold's lumen: the view's own background, tinted as the compartment that fills it is */
.bio-cell__lumen {
  fill: var(--p-content-background);
  stroke: none;
}

.bio-cell__lumen--sky {
  fill: color-mix(in srgb, var(--p-sky-200) 40%, var(--p-content-background));
}

.bio-cell__lumen--rose {
  fill: color-mix(in srgb, var(--p-rose-200) 40%, var(--p-content-background));
}

.bio-cell__lumen--teal {
  fill: color-mix(in srgb, var(--p-teal-200) 45%, var(--p-content-background));
}

.bio-cell__lumen--amber {
  fill: color-mix(in srgb, var(--p-amber-200) 40%, var(--p-content-background));
}

.bio-cell__lumen--violet {
  fill: color-mix(in srgb, var(--p-violet-200) 40%, var(--p-content-background));
}

.bio-cell__lumen--lime {
  fill: color-mix(in srgb, var(--p-lime-200) 40%, var(--p-content-background));
}

.bio-cell__lumen--slate {
  fill: color-mix(in srgb, var(--p-slate-200) 40%, var(--p-content-background));
}

/* A drawn outline's membrane: a wide band the colour of the head groups, with the tails' colour down its middle */
.bio-cell__membrane-heads {
  fill: none;
  stroke: var(--bilayer-head);
  stroke-width: 15;
  stroke-linejoin: round;
}

.bio-cell__membrane-tails {
  fill: none;
  stroke: color-mix(in srgb, var(--p-amber-200) 80%, var(--p-content-background));
  stroke-width: 7;
  stroke-linejoin: round;
}

.bio-cell__cytosol {
  fill: color-mix(in srgb, var(--p-amber-200) 45%, var(--p-content-background));
}

.bio-cell__core {
  fill: none;
  stroke: color-mix(in srgb, var(--p-amber-200) 70%, var(--p-content-background));
  stroke-width: 14;
}


.bio-cell__selection {
  fill: none;
  stroke: var(--p-primary-color);
  stroke-width: 2;
}

.bio-cell--selected.bio-cell--own-membrane {
  --bilayer-head: var(--p-primary-color);
}

.bio-cell__label {
  position: absolute;
  left: 50%;
  bottom: 30%;
  transform: translateX(-50%);
  font-weight: 600;
  color: var(--p-amber-900);
}

.p-dark .bio-cell__label {
  color: var(--p-amber-200);
}

.bio-cell__outline {
  fill: color-mix(in srgb, var(--p-amber-100) 35%, var(--p-content-background));
  stroke: var(--p-amber-500);
  stroke-width: 2;
  stroke-dasharray: 8 6;
}

.bio-cell--selected .bio-cell__outline {
  stroke: var(--p-primary-color);
}

.bio-cell--empty .bio-cell__label {
  color: var(--p-text-muted-color);
  text-align: center;
}

.bio-cell__hint {
  display: block;
  font-weight: 400;
  font-size: 0.75rem;
}

.bio-cell__zone rect {
  fill: none;
  stroke: var(--p-amber-500);
  stroke-width: 1;
  stroke-dasharray: 4 4;
  opacity: 0.6;
}

.bio-cell__zone text {
  font-size: 10px;
  fill: var(--p-text-muted-color);
}

.bio-cell__facet {
  position: absolute;
  display: flex;
  justify-content: center;
  align-items: center;
  font-size: 10px;
  line-height: 1;
  color: var(--p-text-muted-color);
  white-space: nowrap;
  pointer-events: none;
  opacity: 0.8;
}

.bio-cell__facet--left,
.bio-cell__facet--right {
  writing-mode: vertical-rl;
}

.bio-cell__facet--left {
  transform: rotate(180deg);
}
</style>
