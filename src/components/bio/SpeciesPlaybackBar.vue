<template>
  <div
    v-if="cursor.voi"
    class="species-playback"
    role="group"
    aria-label="Play the run's species flows"
    data-testid="bio-species-playback"
    @keydown="onKey"
  >
    <Button
      :icon="cursor.isPlaying ? 'pi pi-pause' : 'pi pi-play'"
      size="small"
      text
      rounded
      :aria-label="cursor.isPlaying ? 'Pause' : 'Play'"
      v-tooltip.top="cursor.isPlaying ? 'Pause' : 'Play the flows through the run'"
      data-testid="bio-species-play"
      @click="cursor.isPlaying ? cursor.pause() : cursor.play()"
    />
    <Button
      icon="pi pi-fast-backward"
      size="small"
      text
      rounded
      aria-label="Back to the start"
      v-tooltip.top="cursor.window ? 'Back to the start of the window' : 'Back to the start of the run'"
      :disabled="cursor.index <= cursor.range[0]"
      data-testid="bio-species-rewind"
      @click="cursor.rewind()"
    />
    <Button
      icon="pi pi-step-backward"
      size="small"
      text
      rounded
      aria-label="Step back"
      v-tooltip.top="'Step back'"
      :disabled="cursor.index <= cursor.range[0]"
      @click="cursor.step(-1)"
    />
    <Button
      icon="pi pi-step-forward"
      size="small"
      text
      rounded
      aria-label="Step forward"
      v-tooltip.top="'Step forward'"
      :disabled="cursor.index >= cursor.range[1]"
      @click="cursor.step(1)"
    />
    <input
      class="species-playback__scrubber"
      type="range"
      :min="cursor.range[0]"
      :max="cursor.range[1]"
      step="1"
      :value="cursor.index"
      :aria-label="`${cursor.voi.name} shown`"
      :aria-valuetext="readout"
      data-testid="bio-species-scrubber"
      @input="scrub($event.target.value)"
    />
    <output class="species-playback__readout" :style="{ minWidth: `${readoutWidth}ch` }" data-testid="bio-species-voi">{{
      readout
    }}</output>
    <Button
      icon="pi pi-sync"
      size="small"
      text
      rounded
      :class="{ 'species-playback__toggle--on': cursor.isLooping }"
      :aria-pressed="cursor.isLooping"
      aria-label="Loop"
      v-tooltip.top="cursor.isLooping ? 'Stop at the end' : 'Loop'"
      @click="cursor.isLooping = !cursor.isLooping"
    />
    <Button
      icon="pi pi-sliders-h"
      size="small"
      text
      rounded
      aria-label="Playback settings"
      aria-haspopup="dialog"
      v-tooltip.top="'Speed and window'"
      data-testid="bio-species-playback-settings"
      @click="settings.toggle($event)"
    />
    <Button
      v-if="cursor.isActive"
      label="End of run"
      size="small"
      text
      v-tooltip.top="'Show the end of the whole run again'"
      data-testid="bio-species-playback-reset"
      @click="cursor.reset()"
    />

    <Popover ref="settings" @show="plotZoom = latestChartZoom()">
      <div class="species-playback__settings" role="dialog" aria-label="Playback settings">
        <label class="species-playback__field">
          <span>Play the window in</span>
          <select v-model.number="cursor.playSeconds" data-testid="bio-species-play-seconds">
            <option v-for="seconds in playTimes" :key="seconds" :value="seconds">{{ seconds }} s</option>
          </select>
        </label>
        <label class="species-playback__field">
          <span>or at ({{ unitLabel }} per second)</span>
          <input
            type="number"
            min="0"
            step="any"
            :value="rate"
            data-testid="bio-species-play-rate"
            @change="setRate($event.target.value)"
          />
        </label>
        <fieldset class="species-playback__window">
          <legend>Arrow widths</legend>
          <label class="species-playback__field">
            <span>Compare</span>
            <select v-model="cursor.flowScale.group" class="species-playback__wide" data-testid="bio-species-width-group">
              <option v-for="option in WIDTH_GROUPS" :key="option.group" :value="option.group">{{ option.label }}</option>
            </select>
          </label>
          <p class="species-playback__note">{{ WIDTH_GROUPS.find((option) => option.group === cursor.flowScale.group).note }}</p>
          <label class="species-playback__check">
            <input v-model="cursor.flowScale.spikes" type="checkbox" data-testid="bio-species-width-spikes" />
            Scale to brief spikes
          </label>
          <p class="species-playback__note">
            {{
              cursor.flowScale.spikes
                ? 'The largest flow in the window is the widest, however briefly it lasts. A start-up transient counts too: set the window past it.'
                : 'The few largest points are drawn as wide as the rest of the largest, so they don’t flatten everything else.'
            }}
          </p>
        </fieldset>
        <fieldset class="species-playback__window">
          <legend>Concentration tint</legend>
          <label class="species-playback__field">
            <span>Scale</span>
            <select v-model="cursor.concentrationScale" class="species-playback__wide" data-testid="bio-species-tint-scale">
              <option v-for="option in TINT_SCALES" :key="option.mode" :value="option.mode">{{ option.label }}</option>
            </select>
          </label>
          <p class="species-playback__note">
            {{ TINT_SCALES.find((option) => option.mode === cursor.concentrationScale).note }} Click a species to tint
            every compartment holding it.
          </p>
        </fieldset>
        <fieldset class="species-playback__window">
          <legend>Window ({{ unitLabel }})</legend>
          <label class="species-playback__field">
            <span>From</span>
            <input
              type="number"
              step="any"
              :value="trim(cursor.span.from)"
              data-testid="bio-species-window-from"
              @change="setWindow({ from: $event.target.value })"
            />
          </label>
          <label class="species-playback__field">
            <span>To</span>
            <input
              type="number"
              step="any"
              :value="trim(cursor.span.to)"
              data-testid="bio-species-window-to"
              @change="setWindow({ to: $event.target.value })"
            />
          </label>
          <div class="species-playback__window-actions">
            <Button
              label="Use plot zoom"
              size="small"
              text
              :disabled="!plotZoom"
              v-tooltip.top="plotZoom ? 'The stretch a plot is zoomed into' : 'Zoom a plot first, by dragging across it'"
              data-testid="bio-species-window-zoom"
              @click="cursor.setWindow({ from: plotZoom.min, to: plotZoom.max })"
            />
            <Button label="Whole run" size="small" text :disabled="!cursor.window" @click="cursor.setWindow(null)" />
          </div>
        </fieldset>
      </div>
    </Popover>
  </div>
</template>

<script setup>
import Button from 'primevue/button'
import Popover from 'primevue/popover'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import { latestChartZoom } from '../../services/simulation/chartZoom'
import { useVoiCursorStore } from '../../stores/voiCursorStore'

/** What a path's width can be compared with, and what each shows. */
const WIDTH_GROUPS = [
  { group: 'species', label: 'Within each species', note: 'A path against the flows of its own species: which of a species’ paths carries most, and when.' },
  { group: 'path', label: 'Each path with itself', note: 'A path against its own flow alone: every path’s own course, however small beside the others.' },
  { group: 'all', label: 'Across all paths', note: 'Every path against every flow: which species and paths carry most overall.' },
]

/** How a focused species' concentration can tint its compartments, and what each shows (see TINT_MODES). */
const TINT_SCALES = [
  { mode: 'linear', label: 'Linear, shared', note: 'None at zero, full at the most any compartment holds in the window: compartments compared as they are.' },
  { mode: 'log', label: 'Log, shared', note: 'From the least to the most held, on a log scale: a small concentration still shows beside a large one.' },
  { mode: 'compartment', label: 'Each compartment with itself', note: 'Each from its own least to most in the window: its own course, but compartments can’t be compared.' },
]

/** The times the whole window can be played in, in seconds. */
const PLAY_SECONDS = [5, 10, 30, 60]

const cursor = useVoiCursorStore()
const settings = ref(null)
/** The stretch a plot was zoomed into when the settings opened, if any. */
const plotZoom = ref(null)

/** A number short enough to read, as it is shown and typed. */
const trim = (value) => Number(value.toPrecision(4))
const unitLabel = computed(() => cursor.voi.unit || cursor.voi.name)
/**
 * How many decimals tell one point of the window from the next, so every point is read out to the same number of
 * them and the bar keeps its width as the cursor moves.
 */
const decimals = computed(() => {
  const points = cursor.range[1] - cursor.range[0]
  const step = points > 0 ? (cursor.span.to - cursor.span.from) / points : 0
  if (!(step > 0)) return 0
  const places = Math.max(0, Math.ceil(-Math.log10(step)))
  // One more where the step isn't a whole number of the last place, as 0.25 isn't of tenths.
  const scaled = step * 10 ** places
  return Math.min(8, Math.abs(scaled - Math.round(scaled)) > 1e-6 ? places + 1 : places)
})
const readoutOf = (value) => `${cursor.voi.name} = ${value.toFixed(decimals.value)}${cursor.voi.unit ? ` ${cursor.voi.unit}` : ''}`
const readout = computed(() => readoutOf(cursor.value))
/** The longest the readout gets over the window, in characters: room kept for it whichever point is shown. */
const readoutWidth = computed(() => Math.max(readoutOf(cursor.span.from).length, readoutOf(cursor.span.to).length))
/** The preset times, with the one set by a rate of the user's among them. */
const playTimes = computed(() => [...new Set([...PLAY_SECONDS, cursor.playSeconds])].sort((a, b) => a - b))
/** How much of the VoI a second of playing covers. */
const rate = computed(() => trim((cursor.span.to - cursor.span.from) / cursor.playSeconds))

function scrub(point) {
  cursor.pause()
  cursor.seek(Number(point))
}

/** Plays at a rate in VoI units a second, by the time that takes over the window. */
function setRate(text) {
  const perSecond = Number(text)
  if (!(perSecond > 0)) return
  cursor.playSeconds = Number(((cursor.span.to - cursor.span.from) / perSecond).toPrecision(3))
}

/** Moves one end of the window, keeping the other. */
function setWindow(end) {
  const next = { ...cursor.span, ...Object.fromEntries(Object.entries(end).map(([key, text]) => [key, Number(text)])) }
  cursor.setWindow(next)
}

/** Space plays or pauses and the arrows step, wherever in the bar the focus is but a field. */
function onKey(event) {
  if (event.target.closest('input, select')) return
  if (event.key === ' ') cursor.isPlaying ? cursor.pause() : cursor.play()
  else if (event.key === 'ArrowLeft') cursor.step(-1)
  else if (event.key === 'ArrowRight') cursor.step(1)
  else return
  event.preventDefault()
}

// While playing, the cursor moves on with each frame by the time since the last.
let frame = 0
let last = 0
function tick(now) {
  cursor.advance((now - last) / 1000)
  last = now
  frame = cursor.isPlaying ? requestAnimationFrame(tick) : 0
}
watch(
  () => cursor.isPlaying,
  (isPlaying) => {
    cancelAnimationFrame(frame)
    if (!isPlaying) return
    last = performance.now()
    frame = requestAnimationFrame(tick)
  },
  { immediate: true }
)
// The plots mark the cursor for as long as the bar is there to move it.
onMounted(() => (cursor.isFollowed = true))
onBeforeUnmount(() => {
  cancelAnimationFrame(frame)
  cursor.pause()
  cursor.isFollowed = false
})
</script>

<style scoped>
.species-playback {
  position: absolute;
  left: 50%;
  bottom: 12px;
  transform: translateX(-50%);
  z-index: 6;
  display: flex;
  align-items: center;
  gap: 0.125rem;
  max-width: calc(100% - 22rem);
  padding: 0.125rem 0.5rem;
  background: var(--p-content-background);
  border: 1px solid var(--p-content-border-color);
  border-radius: 999px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
  font-size: 0.8125rem;
}

.species-playback__scrubber {
  width: 14rem;
  min-width: 4rem;
  flex: 1 1 14rem;
  margin: 0 0.375rem;
  accent-color: var(--p-primary-color);
}

.species-playback__readout {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  color: var(--p-text-color);
}

.species-playback__toggle--on {
  color: var(--p-primary-color);
  background: color-mix(in srgb, var(--p-primary-color) 14%, transparent);
}

.species-playback__settings {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  min-width: 15rem;
  font-size: 0.875rem;
}

.species-playback__field {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.75rem;
}

.species-playback__field input,
.species-playback__field select {
  width: 6.5rem;
  padding: 0.25rem 0.375rem;
  color: var(--p-text-color);
  background: var(--p-form-field-background, var(--p-content-background));
  border: 1px solid var(--p-form-field-border-color, var(--p-content-border-color));
  border-radius: 4px;
}

.species-playback__window {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin: 0;
  padding: 0.5rem 0 0;
  border: 0;
  border-top: 1px solid var(--p-content-border-color);
}

.species-playback__window-actions {
  display: flex;
  justify-content: space-between;
}

.species-playback__wide.species-playback__wide {
  width: 10.5rem;
}

.species-playback__note {
  max-width: 17rem;
  margin: 0;
  font-size: 0.75rem;
  line-height: 1.35;
  color: var(--p-text-muted-color);
}

.species-playback__check {
  display: flex;
  align-items: center;
  gap: 0.375rem;
}

.species-playback__window legend {
  padding: 0;
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--p-text-muted-color);
  text-transform: uppercase;
  letter-spacing: 0.04em;
}
</style>
