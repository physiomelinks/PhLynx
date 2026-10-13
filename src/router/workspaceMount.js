/**
 * Whether the workspace is mounted, so its canvas store exists for views that read it, such as the simulation page.
 * Kept alive, the workspace stays mounted once shown, until the app closes.
 */
let isMounted = false

/**
 * Notes whether the workspace is mounted.
 *
 * @param {boolean} value
 */
export function setWorkspaceMounted(value) {
  isMounted = value
}

/**
 * Sends a visit to a view that needs the workspace to the workspace instead, while the workspace hasn't mounted, as
 * on loading that view's address.
 *
 * @returns {true|{name: string}}
 */
export function ensureWorkspaceMounted() {
  return isMounted || { name: 'workspace' }
}
