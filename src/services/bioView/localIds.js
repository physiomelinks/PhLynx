/**
 * The ids of what the user keeps of their own on this device, templates and skin libraries: their own id with a
 * 'local:' prefix, so it never collides with a built-in one.
 */

import { TEMPLATE_ID } from './pieces/constants.js'

/** Prefixes the id of a template or skin library from the user's own library. */
export const LOCAL_TEMPLATE_PREFIX = 'local:'

/**
 * @param {string} id
 * @returns {string} The id without the 'local:' prefix.
 */
export const bareTemplateId = (id) =>
  id.startsWith(LOCAL_TEMPLATE_PREFIX) ? id.slice(LOCAL_TEMPLATE_PREFIX.length) : id

/**
 * @param {*} id
 * @returns {boolean} Whether `id` is a template id from the user's own library.
 */
export const isLocalTemplateId = (id) =>
  typeof id === 'string' && id.startsWith(LOCAL_TEMPLATE_PREFIX) && TEMPLATE_ID.test(bareTemplateId(id))

/**
 * Picks an id for a template joining the user's library: `local:` and its own id, with a number added when that is
 * taken.
 *
 * @param {string} id - The template's own id, with or without the prefix.
 * @param {Iterable<string>} taken - Ids already in use.
 * @returns {string}
 */
export function freeLocalId(id, taken) {
  const prefix = LOCAL_TEMPLATE_PREFIX
  const used = new Set(taken)
  const bare = bareTemplateId(id)
  if (!used.has(prefix + bare)) return prefix + bare
  for (let n = 2; ; n++) {
    const suffix = `-${n}`
    const candidate = bare.slice(0, 48 - suffix.length) + suffix
    if (TEMPLATE_ID.test(candidate) && !used.has(prefix + candidate)) return prefix + candidate
  }
}
