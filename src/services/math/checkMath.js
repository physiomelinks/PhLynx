import { checkModel } from './checkModel'
import { AFFINE_UNIT_CONVERSIONS, STANDARD_UNITS } from '../../utils/constants'
import { unitsModelXml } from '../../utils/unitExpression'

export { NO_FINDINGS } from './checkModel'

const BUILT_IN_UNITS = new Set(STANDARD_UNITS)

/** Every units name a model's variables and numbers use: `units="…"` and `cellml:units="…"`. */
const UNITS_ATTRIBUTE = /\bunits="([^"]+)"/g

/** The units a model defines itself, which the library's mustn't repeat. */
const OWN_UNITS = /<units\b[^>]*\bname="([^"]+)"/g

/**
 * The library units definitions a math needs, those they build on included, as unitsModelXml takes them.
 * Built-in units and those the math defines need none; an affine units (celsius) stands in as its base units,
 * as the export does.
 * Units the library lacks are left out: the math then fails validation, and isn't checked.
 *
 * @param {string} mathXml
 * @param {Map<string, Array<Object>>} unitDefinitions - The library's, as libraryStore.unitDefinitions.
 * @returns {Map<string, Array<Object>>}
 */
export function unitsNeededBy(mathXml, unitDefinitions) {
  const needed = new Map()
  const own = new Set(Array.from(mathXml.matchAll(OWN_UNITS), ([, name]) => name))
  const queue = [...new Set(Array.from(mathXml.matchAll(UNITS_ATTRIBUTE), ([, name]) => name))]
  while (queue.length) {
    const name = queue.pop()
    if (needed.has(name) || own.has(name) || BUILT_IN_UNITS.has(name)) continue
    const parts = Object.hasOwn(AFFINE_UNIT_CONVERSIONS, name)
      ? [{ units: AFFINE_UNIT_CONVERSIONS[name].baseUnit }]
      : unitDefinitions.get(name)
    if (!parts) continue
    needed.set(name, parts)
    queue.push(...parts.map((part) => part.units))
  }
  return needed
}

/**
 * Adds the library units a math uses to its model, before its component, so libCellML can check it on its own.
 *
 * @param {string} mathXml - A math as libraryStore keeps it: a CellML 2.0 model with one component.
 * @param {Map<string, Array<Object>>} unitDefinitions - The library's, as libraryStore.unitDefinitions.
 * @returns {string}
 */
export function withLibraryUnits(mathXml, unitDefinitions) {
  if (typeof mathXml !== 'string') return ''
  const units = unitsModelXml(unitsNeededBy(mathXml, unitDefinitions))
  const definitions = units.slice(units.indexOf('>', units.indexOf('<model')) + 1, units.lastIndexOf('</model>'))
  return mathXml.replace(/<model\b[^>]*>/, (open) => `${open}\n${definitions}`)
}

/**
 * Checks a math on its own, with the library's units, on this thread (see checkModel for what it finds).
 * libraryStore checks in the background instead, with checkMathInBackground.
 *
 * @param {Object} libcellml - The libCellML instance.
 * @param {string} mathXml - A math as libraryStore keeps it.
 * @param {Map<string, Array<Object>>} unitDefinitions - The library's, as libraryStore.unitDefinitions.
 * @returns {{ invalid: string[], imbalances: string[] }}
 */
export function checkMath(libcellml, mathXml, unitDefinitions) {
  return checkModel(libcellml, withLibraryUnits(mathXml, unitDefinitions))
}

/**
 * Shortens an imbalance from checkModel to its equation and what doesn't match, e.g.
 * "dx/dt = k*x: 'dx/dt' is in 'metre x second^-1' while 'k*x' is in 'metre x second'." or
 * "dx/dt = k*exp(x): 'x' in 'exp(x)' is not dimensionless; 'x' is in 'metre'." Others stay whole.
 *
 * @param {string} description
 * @returns {string}
 */
export function summariseImbalance(description) {
  const equation =
    description.match(/ in equation '(.+?)' in component '/)?.[1] ?? description.match(/^The units in '(.+?)' in component '/)?.[1]
  const [, problem, detail] = description.match(/ in component '[^']*' (.+?)\. (.+)$/s) ?? []
  if (!equation || !detail) return description
  if (problem === 'are not equivalent') return `${equation}: ${detail}`
  // "The unit of 'x' in 'exp(x)' in … is not dimensionless.": say which term, and in what.
  const [, term, within] = description.match(/^The unit of '(.+?)' in '(.+?)' in /) ?? []
  return term ? `${equation}: '${term}' in '${within}' ${problem}; ${detail}` : `${equation}: ${problem}; ${detail}`
}

/**
 * Shortens a validity error from checkModel: the component is always the math's own, so isn't named.
 *
 * @param {string} description
 * @returns {string}
 */
export function summariseInvalid(description) {
  return description.replace(/ (in|of|present in) component '[^']*'/g, '').replace(/ in the parent model/g, ' in the units library')
}

