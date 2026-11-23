/**
 * What each instance is in the physiological view. On a piece it is what its site is; off the pieces, what its
 * annotations say, which decides only how the loose module is drawn: a protein in the tray, else a card.
 *
 * A node's data.bioView holds its place and look in that view, all optional:
 * - site: '<owner>/<sitePath>', the site of the pieces it is bound to; one the pieces don't offer leaves it unbound;
 * - order: its slot along a row of slots on its site;
 * - position: where it is drawn, when it is on no site;
 * - skin: the skin chosen for it;
 * - speciesOrder: the species of a compartment's tokens in species mode, in the order the user dragged them into.
 */

import { GO } from '../annotations/iris.js'
import { contextOfModule } from './skinContext.js'
import { resolveSkin } from './skinRegistry.js'

/**
 * What an instance can be:
 * - membraneProtein: sits in a membrane;
 * - membrane: a cell's membrane itself;
 * - cytosol: a cell's inside;
 * - cytosolic: a process inside a cell, such as glycolysis;
 * - region: a compartment outside a cell's bulk, such as a lumen or a vessel;
 * - none: nothing physiological is known, drawn as a card.
 */
export const ROLES = ['membraneProtein', 'membrane', 'cytosol', 'cytosolic', 'region', 'none']

/**
 * Gives the GO cellular components a sidecar puts its variables in, leaving out ones only on the
 * component itself.
 *
 * @param {Object|null} sidecar - From parseSidecar.
 * @returns {Set<string>}
 */
export function goLocationsOf(sidecar) {
  const locations = new Set()
  for (const { location } of sidecar?.variables ?? []) {
    if (!location || location === 'self') continue
    locations.add(location.startsWith('self+') ? location.slice('self+'.length) : location)
  }
  return locations
}

/**
 * Works out a role from a module's sidecar: its component kind, else where its variables are.
 *
 * @param {Object} sidecar
 * @returns {string|null}
 */
function fromSidecar(sidecar) {
  switch (sidecar.component?.kind) {
    case 'transporter':
      return 'membraneProtein'
    case 'membrane':
      return 'membrane'
    case 'compartment':
      return 'region'
  }
  const locations = goLocationsOf(sidecar)
  if (locations.has(GO.cytoplasm) && locations.has(GO.extracellularRegion)) return 'membraneProtein'
  if (locations.size === 1 && locations.has(GO.cytoplasm)) return 'cytosolic'
  return null
}

/**
 * Works out what an instance is in the physiological view: its site's role on a piece, else a role the location
 * source worked out, else its module's sidecar's.
 *
 * @param {Object} data - The node's data.
 * @param {Object} [context]
 * @param {Object|null} [context.sidecar] - The parsed sidecar of the node's math.
 * @param {string|null} [context.worked] - A role the location source worked out (see locationSources.js).
 * @param {string|null} [context.siteRole] - The role of the site of the pieces the node is bound to (see
 *   siteRolesOf), which wins over everything.
 * @returns {{ role: string, skin: string|null, skinContext: {family: string, target: string, terms: string[]}|null,
 *   source: 'site'|'location'|'sidecar'|'none', site?: string }}
 *   skin is the skin it is drawn with (see resolveSkin), null for a role drawn with none or a process chosen to have
 *   none; skinContext, what it is for its skin (see contextOfModule), null for a role with no skin; site, only there
 *   when set, the site it is bound to.
 */
export function resolveBioRole(data, { sidecar = null, worked = null, siteRole = null } = {}) {
  const bioView = data?.bioView ?? {}
  const fromModule = sidecar ? fromSidecar(sidecar) : null
  const [role, source] = ROLES.includes(siteRole)
    ? [siteRole, 'site']
    : ROLES.includes(worked)
      ? [worked, 'location']
      : fromModule
        ? [fromModule, 'sidecar']
        : ['none', 'none']
  const site = typeof bioView.site === 'string' && bioView.site ? bioView.site : null
  const skinContext = contextOfModule(role, sidecar?.component?.isVersionOf)
  return {
    role,
    skin: resolveSkin(skinContext, bioView.skin)?.id ?? null,
    skinContext,
    source,
    ...(site && { site }),
  }
}
