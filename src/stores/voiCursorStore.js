import { defineStore } from 'pinia'
import { computed, ref, watch } from 'vue'

import { useSimulationResultsStore } from './simulationResultsStore'

/** How long playing the whole window takes, in seconds, unless the user picks another. */
export const DEFAULT_PLAY_SECONDS = 10

/**
 * Finds the last point at or before a value of the variable of integration.
 *
 * @param {ArrayLike<number>} values - The VoI's values, ascending.
 * @param {number} value
 * @returns {number} An index into `values`; 0 for a value before the first.
 */
export function indexAt(values, value) {
  let low = 0
  let high = values.length - 1
  while (low < high) {
    const middle = (low + high + 1) >> 1
    if (values[middle] <= value) low = middle
    else high = middle - 1
  }
  return low
}

/**
 * Where in the latest run's variable of integration (VoI) the views that follow it are looking, and its playback.
 * Until it is moved the cursor is at the end of the run, as a view with no cursor shows it. Never saved.
 */
export const useVoiCursorStore = defineStore('voiCursor', () => {
  const simulationResults = useSimulationResultsStore()

  /** The run's VoI: `{ name, unit, values }`; null with no run, or with a sweep, which has no course to follow. */
  const voi = computed(() => {
    const results = simulationResults.results
    return results && !results.isSweep && results.voi?.values?.length > 1 ? results.voi : null
  })
  /** The VoI value the cursor is at; null until it is moved, for the end of the run. */
  const position = ref(null)
  /** The stretch of the VoI played and scrubbed over, as `{ from, to }` in its units; null for the whole run. */
  const window = ref(null)
  const isPlaying = ref(false)
  const isLooping = ref(false)
  /** How long playing the whole window takes, in seconds. */
  const playSeconds = ref(DEFAULT_PLAY_SECONDS)
  /**
   * What a flow's width is compared with as the run is played, and whether brief spikes set the scale: see
   * flowScales. `group` is 'species', 'path' or 'all'.
   */
  const flowScale = ref({ group: 'species', spikes: false })
  /** Whether a view is following the cursor and offering its playback, as species mode does. */
  const isFollowed = ref(false)

  /** The window's first and last points, as indices into the VoI's values; null with no run. */
  const range = computed(() => {
    const values = voi.value?.values
    if (!values) return null
    const last = values.length - 1
    if (!window.value) return [0, last]
    const from = Math.min(indexAt(values, window.value.from), last - 1)
    // The first point at or past its start, where the start falls between two.
    const first = values[from] < window.value.from ? from + 1 : from
    return [first, Math.max(first + 1, indexAt(values, window.value.to))]
  })
  /** Whether the cursor has been moved off the end of the run. */
  const isActive = computed(() => !!voi.value && position.value !== null)
  /** The point the cursor is at, as an index into the VoI's values; null with no run. */
  const index = computed(() => {
    if (!range.value) return null
    const [first, last] = range.value
    if (position.value === null) return last
    return Math.min(last, Math.max(first, indexAt(voi.value.values, position.value)))
  })
  /** The VoI's value at the cursor; null with no run. */
  const value = computed(() => (index.value === null ? null : voi.value.values[index.value]))
  /** The window's ends, in the VoI's units; null with no run. */
  const span = computed(() => {
    if (!range.value) return null
    const { values } = voi.value
    return { from: values[range.value[0]], to: values[range.value[1]] }
  })

  /**
   * What a chart against the VoI marks while the cursor is followed: `{ value, from, to }` in the VoI's units,
   * `value` null until the cursor is moved and `from` and `to` null over the whole run; null when it isn't followed.
   */
  const marker = computed(() => {
    if (!isFollowed.value || !voi.value) return null
    return { value: isActive.value ? value.value : null, from: window.value ? span.value.from : null, to: window.value ? span.value.to : null }
  })

  /** Moves the cursor to a point of the run, kept within the window. */
  function seek(point) {
    if (!range.value) return
    const [first, last] = range.value
    position.value = voi.value.values[Math.min(last, Math.max(first, Math.round(point)))]
  }

  /** Moves the cursor to the point nearest a value of the VoI, kept within the window. */
  function seekValue(value) {
    const values = voi.value?.values
    if (!values || !Number.isFinite(value)) return
    const before = indexAt(values, value)
    const after = Math.min(before + 1, values.length - 1)
    isPlaying.value = false
    seek(value - values[before] <= values[after] - value ? before : after)
  }

  /** Puts the cursor back at the window's start, and stops playing. */
  function rewind() {
    if (!range.value) return
    isPlaying.value = false
    seek(range.value[0])
  }

  /** Moves the cursor a number of points on, or back. */
  function step(points) {
    if (index.value === null) return
    isPlaying.value = false
    seek(index.value + points)
  }

  /** Starts playing, from the window's start if the cursor is at its end. */
  function play() {
    if (!range.value) return
    if (index.value >= range.value[1]) position.value = span.value.from
    isPlaying.value = true
  }

  function pause() {
    isPlaying.value = false
  }

  /**
   * Moves a playing cursor on by a stretch of real time. At the window's end it starts again if looping, and
   * otherwise stops there.
   *
   * @param {number} seconds - How long since it was last moved on.
   */
  function advance(seconds) {
    if (!isPlaying.value || !span.value || !(seconds > 0)) return
    const { from, to } = span.value
    const length = to - from
    const next = (position.value ?? to) + (length * seconds) / Math.max(playSeconds.value, 0.1)
    if (next < to) position.value = next
    else if (isLooping.value) position.value = from + ((next - from) % length)
    else {
      position.value = to
      isPlaying.value = false
    }
  }

  /**
   * Sets the stretch of the VoI played and scrubbed over, bringing the cursor into it.
   *
   * @param {{from: number, to: number}|null} next - In the VoI's units; null, or an empty stretch, for the whole run.
   */
  function setWindow(next) {
    const isStretch = next && Number.isFinite(next.from) && Number.isFinite(next.to) && next.to > next.from
    window.value = isStretch ? { from: next.from, to: next.to } : null
    if (position.value !== null && index.value !== null) position.value = voi.value.values[index.value]
  }

  /** Puts the cursor back at the end of the run, over the whole of it. */
  function reset() {
    position.value = null
    window.value = null
    isPlaying.value = false
  }

  // Another run is another course: its end is what a view shows until the cursor is moved again.
  watch(() => simulationResults.results, reset)

  return {
    voi,
    window,
    isPlaying,
    isLooping,
    playSeconds,
    flowScale,
    isFollowed,
    marker,
    range,
    isActive,
    index,
    value,
    span,
    seek,
    seekValue,
    rewind,
    step,
    play,
    pause,
    advance,
    setWindow,
    reset,
  }
})
