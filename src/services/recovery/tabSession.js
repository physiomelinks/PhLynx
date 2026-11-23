/**
 * Names this tab's recovery draft, and tells which tabs are still open.
 *
 * A tab's id is made fresh for each page load, not kept in sessionStorage: a duplicated tab copies sessionStorage, so
 * two tabs would share a draft, and a reload would write over the draft it should be offering back. Each page holds a
 * Web Lock named for its id until it goes, so a draft whose lock nobody holds belongs to a tab that has closed,
 * reloaded or crashed.
 *
 * A reload is told apart: each page also notes its id in sessionStorage, so the page that replaces it on a reload can
 * claim the draft the old one left. A duplicated tab copies that note too, but it is not a reload, and the tab it
 * copied still holds the lock.
 */

const LOCK_PREFIX = 'phlynx-recovery-tab:'
const LAST_TAB_KEY = 'phlynx-recovery-last-tab'

/** A new tab id. */
export function newTabId() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
}

/**
 * Holds the tab's lock until the page goes.
 *
 * @param {string} id
 * @param {LockManager} [locks=navigator.locks]
 * @returns {boolean} Whether the browser has locks to hold.
 */
export function holdTabLock(id, locks = globalThis.navigator?.locks) {
  if (!locks?.request) return false
  locks.request(`${LOCK_PREFIX}${id}`, () => new Promise(() => {})).catch(() => {})
  return true
}

/**
 * The ids of the tabs still open, this one included.
 *
 * @param {LockManager} [locks=navigator.locks]
 * @returns {Promise<Set<string>|null>} Null when the browser cannot tell.
 */
export async function liveTabIds(locks = globalThis.navigator?.locks) {
  if (!locks?.query) return null
  const { held = [] } = await locks.query()
  return new Set(
    held
      .map((lock) => lock.name)
      .filter((name) => name?.startsWith(LOCK_PREFIX))
      .map((name) => name.slice(LOCK_PREFIX.length))
  )
}

/**
 * Whether this page was loaded by reloading the tab.
 *
 * @param {Performance} [performance=globalThis.performance]
 */
export function isReload(performance = globalThis.performance) {
  try {
    return performance?.getEntriesByType?.('navigation')?.[0]?.type === 'reload'
  } catch {
    return false
  }
}

/**
 * Notes this page's id in the tab's sessionStorage, returning the id the page before it noted.
 *
 * @param {string} id
 * @param {Storage} [storage=sessionStorage]
 * @returns {string|null}
 */
export function swapLastTabId(id, storage = globalThis.sessionStorage) {
  try {
    const last = storage?.getItem(LAST_TAB_KEY) ?? null
    storage?.setItem(LAST_TAB_KEY, id)
    return last
  } catch {
    return null
  }
}

let pageTab = null
let reloadedTab = null

/** This page's tab id, holding its lock the first time it is asked for. */
export function pageTabId() {
  if (!pageTab) {
    pageTab = newTabId()
    holdTabLock(pageTab)
    const last = swapLastTabId(pageTab)
    reloadedTab = last && isReload() ? last : null
  }
  return pageTab
}

/**
 * The id of the page this one replaced by a reload of the tab, or null when it was not loaded by a reload.
 *
 * Whether that page has truly gone is for its lock to tell: see liveTabIds.
 */
export function reloadedTabId() {
  pageTabId()
  return reloadedTab
}
