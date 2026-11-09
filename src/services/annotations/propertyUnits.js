/**
 * Whether a variable's units suit the property it is annotated with: an amount is moles, a concentration an amount
 * per volume, a molar flow rate an amount per time, or per area and time, and so on. Only
 * a check: nothing is changed.
 */

import { OPB } from './iris.js'
import { resolveUnits, sameDimensions } from '../../utils/units.js'
import { cleanName } from '../../utils/identifiers.js'

const dimensions = (...each) => each.map((d) => ({ dimensions: d }))
const FLOW = { mol: 1, s: -1 }
const FLUX = { mol: 1, m: -2, s: -1 }

// What each property is called and the SI dimensions its units may have.
const PROPERTY_UNITS = {
  [OPB.concentration]: { noun: 'a concentration', allowed: dimensions({ mol: 1, m: -3 }) },
  [OPB.amount]: { noun: 'an amount', allowed: dimensions({ mol: 1 }) },
  [OPB.molarFlowRate]: { noun: 'a molar flow rate', allowed: dimensions(FLOW, FLUX) },
  [OPB.amountDensityFlowRate]: { noun: 'a molar flow rate', allowed: dimensions(FLOW, FLUX) },
  [OPB.chargeFlowRate]: { noun: 'a charge flow rate', allowed: dimensions({ A: 1 }, { A: 1, m: -2 }) },
  [OPB.fluidVolume]: { noun: 'a volume', allowed: dimensions({ m: 3 }) },
  [OPB.spatialArea]: { noun: 'an area', allowed: dimensions({ m: 2 }) },
  [OPB.electricalPotential]: { noun: 'an electrical potential', allowed: dimensions({ kg: 1, m: 2, s: -3, A: -1 }) },
}

/**
 * Why a variable's units don't suit its property, e.g. "fmol isn't a concentration"; null when they do, or when the
 * property, units or their definition is unknown.
 *
 * @param {string|null} property - An OPB CURIE.
 * @param {string|null} units - The variable's units name.
 * @param {Map<string, Array<Object>>} definitions - Units definitions, as libraryStore.unitDefinitions.
 * @param {Map<string, Object|null>} [cache] - For resolveUnits, shared across calls with the same definitions.
 * @returns {string|null}
 */
export function propertyUnitsProblem(property, units, definitions, cache = new Map()) {
  const expected = PROPERTY_UNITS[property]
  const name = cleanName(units)
  if (!expected || !name) return null
  const resolved = resolveUnits(name, definitions ?? new Map(), cache)
  if (!resolved || expected.allowed.some((allowed) => sameDimensions(resolved, allowed))) return null
  return `${name} isn’t ${expected.noun}`
}
