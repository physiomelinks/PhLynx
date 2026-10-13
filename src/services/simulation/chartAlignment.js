/**
 * Lines up the drawings of charts against the same time axis, as the charts whose cursors move together are: each takes
 * the widest value axis and right padding of its group, so a time falls at the same place across them.
 */
import { reactive } from 'vue'

// Each group's charts' own gutters, in pixels, by chart.
const groups = reactive(new Map())

/**
 * Keeps one of a chart's own gutters, as its axes need them.
 *
 * @param {string} key - The group's.
 * @param {symbol} id - The chart's.
 * @param {'left'|'right'} side
 * @param {number} size - Pixels.
 */
export function reportChartGutter(key, id, side, size) {
  if (!groups.has(key)) groups.set(key, new Map())
  const charts = groups.get(key)
  const gutters = charts.get(id)
  if (gutters?.[side] === size) return
  charts.set(id, { left: 0, right: 0, ...gutters, [side]: size })
}

/**
 * Forgets a chart's gutters, as it leaves its group.
 *
 * @param {string} key
 * @param {symbol} id
 */
export function forgetChartGutters(key, id) {
  const charts = groups.get(key)
  if (!charts?.delete(id) || charts.size) return
  groups.delete(key)
}

/**
 * Gets the widest gutters of a group's charts.
 *
 * @param {string} key
 * @returns {{left: number, right: number}} Pixels, 0 for a group with no charts.
 */
export function widestChartGutters(key) {
  const widest = { left: 0, right: 0 }
  for (const { left, right } of groups.get(key)?.values() ?? []) {
    widest.left = Math.max(widest.left, left)
    widest.right = Math.max(widest.right, right)
  }
  return widest
}
