/**
 * Colour slots for chart series: a series keeps its slot while it stays on the chart, so plotting or
 * unplotting another never recolours it.
 */

/** How many series one chart holds, one per colour of the categorical palette. */
export const SLOT_COUNT = 8

/** The categorical palette by slot, stepped for each theme (validated against the sidebar's surfaces). */
export const SERIES_COLOURS = {
  light: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'],
  dark: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'],
}

/**
 * Assigns slots to a chart's series, keeping each one's previous slot and giving new ones the lowest free.
 *
 * @param {Map<string, number>} previous - Slots by series key from the last assignment.
 * @param {string[]} keys - The chart's series, at most SLOT_COUNT.
 * @returns {Map<string, number>}
 */
export function assignSeriesSlots(previous, keys) {
  const slots = new Map()
  for (const key of keys) {
    const slot = previous.get(key)
    if (slot !== undefined && ![...slots.values()].includes(slot)) slots.set(key, slot)
  }
  for (const key of keys) {
    if (slots.has(key)) continue
    let slot = 0
    while ([...slots.values()].includes(slot)) slot++
    slots.set(key, slot)
  }
  return slots
}

/**
 * Splits series into charts of at most SLOT_COUNT, so no chart repeats a colour.
 *
 * @param {Array} series
 * @returns {Array<Array>}
 */
export function chunkSeries(series) {
  const charts = []
  for (let i = 0; i < series.length; i += SLOT_COUNT) charts.push(series.slice(i, i + SLOT_COUNT))
  return charts
}

// Matplotlib's colour letters, as CA's experiment_colors use them.
const MATPLOTLIB_COLOURS = { r: '#e34948', b: '#2a78d6', g: '#1baf7a', m: '#e87ba4', c: '#17becf', y: '#eda100', k: '#52514e' }

/**
 * Colours an experiment as its protocol does (a matplotlib colour letter or a '#' hex colour, with or without alpha),
 * or by its place when it gives none that PhLynx reads.
 *
 * @param {string|null|undefined} colour - From experiment_colors.
 * @param {number} index - The experiment's place, from 0.
 * @returns {string} '#rgb', '#rgba', '#rrggbb' or '#rrggbbaa'.
 */
export function resolveExperimentColour(colour, index) {
  if (colour && MATPLOTLIB_COLOURS[colour]) return MATPLOTLIB_COLOURS[colour]
  if (colour && /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(colour)) return colour
  return SERIES_COLOURS.light[index % SERIES_COLOURS.light.length]
}
