/**
 * Where a CellDL diagram opens in the editor, and the last view of each module, kept for this viewer only: in
 * memory and the browser's storage, never in the workspace.
 */

const STORAGE_KEY = 'phlynx.celldl.views'
/** The most modules' views kept; the longest unviewed go first. */
const MAX_VIEWS = 200

/** @type {Map<string, {scale: number, centre: {x: number, y: number}}>|null} */
let views = null

/**
 * Checks whether a value is a view worth restoring.
 *
 * @param {any} view
 * @returns {boolean}
 */
function isView(view) {
  return (
    Number.isFinite(view?.scale) && view.scale > 0 && Number.isFinite(view?.centre?.x) && Number.isFinite(view?.centre?.y)
  )
}

function loadViews() {
  if (views) return views
  views = new Map()
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}')
    for (const [key, view] of Object.entries(stored ?? {})) {
      if (isView(view)) views.set(key, { scale: view.scale, centre: { x: view.centre.x, y: view.centre.y } })
    }
  } catch {
    // No storage, or nothing readable in it
  }
  return views
}

/**
 * Gets the view a module's diagram was last left at.
 *
 * @param {string|null} key - The module's CellDL documentUri.
 * @returns {{scale: number, centre: {x: number, y: number}}|null}
 */
export function lastView(key) {
  return (key && loadViews().get(key)) || null
}

/**
 * Remembers the view a module's diagram is at.
 *
 * @param {string|null} key - The module's CellDL documentUri.
 * @param {{scale: number, centre: {x: number, y: number}}} view
 */
export function rememberView(key, view) {
  if (!key || !isView(view)) return
  const all = loadViews()
  all.delete(key)
  all.set(key, { scale: view.scale, centre: { x: view.centre.x, y: view.centre.y } })
  while (all.size > MAX_VIEWS) all.delete(all.keys().next().value)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(all)))
  } catch {
    // Kept in memory only
  }
}

/** Forgets every view, in memory only; for tests. */
export function resetViews() {
  views = null
}

/**
 * Chooses the view a diagram opens at: 100% when blank; fitted, but at most 100%, when not; or, if the module was
 * last left more zoomed in than either, that view again, centred where it was if that is still on the diagram.
 *
 * @param {{fitScale: number|null, bounds: {left: number, top: number, right: number, bottom: number}|null}} state -
 *   The opened diagram's, as the editor's `view-state` reports it.
 * @param {{scale: number, centre: {x: number, y: number}}|null} last - The module's last view.
 * @returns {{zoom: 'fit'|number, maxScale?: number, centre?: {x: number, y: number}}} The editor's `view` options.
 */
export function chooseOpenView(state, last) {
  const bounds = state?.bounds
  if (!bounds) return { zoom: 1 }
  const fitScale = state.fitScale ?? 1
  if (isView(last) && last.scale > Math.max(fitScale, 1)) {
    const { x, y } = last.centre
    const isOnDiagram = x >= bounds.left && x <= bounds.right && y >= bounds.top && y <= bounds.bottom
    return isOnDiagram ? { zoom: last.scale, centre: { x, y } } : { zoom: last.scale }
  }
  return { zoom: 'fit', maxScale: 1 }
}
