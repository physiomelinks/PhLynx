/**
 * The time ranges charts are zoomed into, by a name each chart is given, so a chart rebuilt (as showing the
 * floating box's sliders does) keeps its zoom. Never saved.
 */
const zooms = new Map()

/**
 * Gets the range a chart was zoomed into, if any.
 *
 * @param {string|null} key
 * @returns {{min: number, max: number}|null}
 */
export const getChartZoom = (key) => (key ? zooms.get(key) ?? null : null)

/**
 * Keeps, or with null forgets, the range a chart is zoomed into.
 *
 * @param {string|null} key
 * @param {{min: number, max: number}|null} range
 */
export function setChartZoom(key, range) {
  if (!key) return
  if (range) zooms.set(key, range)
  else zooms.delete(key)
}
