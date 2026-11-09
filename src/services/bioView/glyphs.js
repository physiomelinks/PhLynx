/**
 * The cartoons a membrane protein can be drawn as in the physiological view, and which GO molecular
 * function each one stands for. Only terms PhLynx's annotations use are listed; any other protein is
 * drawn as a generic one until the user picks.
 */

import { GO } from '../annotations/iris.js'

export const GLYPHS = ['symporter', 'antiporter', 'uniporter', 'pump', 'channel', 'generic']

/** GO molecular function -> glyph. */
export const GO_FUNCTION_GLYPHS = new Map([
  [GO.glucoseSodiumSymporter, 'symporter'],
  [GO.glucoseTransporter, 'uniporter'],
  [GO.sodiumPotassiumAtpase, 'pump'],
  [GO.inwardRectifierPotassiumChannel, 'channel'],
])

/**
 * Picks a membrane protein's glyph: the user's choice, else the first of its GO functions with one.
 *
 * @param {string[]} [isVersionOf] - The component's bqbiol:isVersionOf CURIEs.
 * @param {string} [override] - The user's choice.
 * @returns {string} One of GLYPHS.
 */
export function glyphFor(isVersionOf = [], override) {
  if (GLYPHS.includes(override)) return override
  for (const curie of isVersionOf) if (GO_FUNCTION_GLYPHS.has(curie)) return GO_FUNCTION_GLYPHS.get(curie)
  return 'generic'
}
