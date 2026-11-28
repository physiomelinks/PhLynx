/**
 * Site references, as a module bound to a site stores them in `node.data.bioView.site`: '<owner>/<path>', where the
 * owner is 'pieces' for the pieces the view is built from (see pieces/layout.js pieceSiteRef).
 */

import { SITE_PATH } from './pieces/constants.js'

/** What owns a site, as it appears before the slash of a site reference. */
export const SITE_OWNER = /^[A-Za-z0-9][A-Za-z0-9_:.-]*$/

/**
 * Names a site, as stored in `node.data.bioView.site`.
 *
 * @param {string} owner - E.g. 'pieces'.
 * @param {string} path - The site's path, e.g. 'pm.apical'.
 * @returns {string|null} '<owner>/<path>', or null when either part is malformed.
 */
export function siteRef(owner, path) {
  if (typeof owner !== 'string' || !SITE_OWNER.test(owner)) return null
  if (typeof path !== 'string' || !SITE_PATH.test(path)) return null
  return `${owner}/${path}`
}

/**
 * Splits a site reference into its owner and site path.
 *
 * @param {*} ref - '<owner>/<path>'.
 * @returns {{ instance: string, path: string }|null} instance: the owner. Null when `ref` is not a site reference.
 */
export function parseSiteRef(ref) {
  if (typeof ref !== 'string') return null
  const slash = ref.indexOf('/')
  if (slash < 0) return null
  const instance = ref.slice(0, slash)
  const path = ref.slice(slash + 1)
  return siteRef(instance, path) ? { instance, path } : null
}
