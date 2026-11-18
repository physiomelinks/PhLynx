import { AFFINE_UNIT_CONVERSIONS, STANDARD_UNITS } from '../../utils/constants'
import { unitsModelXml } from '../../utils/unitExpression'

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
 * Finds the equations in a math whose units don't balance, such as `dx/dt = k*x` with k in seconds, as
 * libCellML's Analyser reports them. That includes terms that differ only in scale (ms and s), which
 * libCellML doesn't convert inside an equation. A units the Analyser can't work out, such as a power
 * with a variable exponent, isn't reported.
 *
 * @param {Object} libcellml - The libCellML instance.
 * @param {string} mathXml - A math as libraryStore keeps it: a CellML 2.0 model with one component.
 * @param {Map<string, Array<Object>>} unitDefinitions - The library's, as libraryStore.unitDefinitions.
 * @returns {string[]} The Analyser's descriptions. A math that doesn't validate on its own (a units the library
 *   lacks, say) has none: the Analyser checks units only in a valid model.
 */
export function findUnitImbalances(libcellml, mathXml, unitDefinitions) {
  if (typeof mathXml !== 'string' || !mathXml.trim()) return []

  // The math's units definitions go before its component, in its own model.
  const units = unitsModelXml(unitsNeededBy(mathXml, unitDefinitions))
  const definitions = units.slice(units.indexOf('>', units.indexOf('<model')) + 1, units.lastIndexOf('</model>'))
  const xml = mathXml.replace(/<model\b[^>]*>/, (open) => `${open}\n${definitions}`)

  const parser = new libcellml.Parser(false)
  const analyser = new libcellml.Analyser()
  let model = null
  try {
    model = parser.parseModel(xml)
    if (!model || parser.errorCount()) return []

    analyser.analyseModel(model)
    const unitsRule = libcellml.Issue.ReferenceRule.ANALYSER_UNITS.value
    const warning = libcellml.Issue.Level.WARNING.value
    const imbalances = []
    for (let i = 0; i < analyser.issueCount(); i++) {
      const issue = analyser.issue(i)
      const description = issue.description()
      // "may not be equivalent": libCellML can't tell, e.g. pow(x, n) with n a variable.
      if (
        issue.referenceRule().value === unitsRule &&
        issue.level().value === warning &&
        !description.includes('may not be equivalent')
      ) {
        imbalances.push(description)
      }
      issue.delete()
    }
    return imbalances
  } finally {
    model?.delete()
    analyser.delete()
    parser.delete()
  }
}

/**
 * Shortens a description from findUnitImbalances to its equation and what doesn't match, e.g.
 * "dx/dt = k*x: 'dx/dt' is in 'metre x second^-1' while 'k*x' is in 'metre x second'." Others stay whole.
 *
 * @param {string} description
 * @returns {string}
 */
export function summariseImbalance(description) {
  const equation =
    description.match(/ in equation '(.+?)' in component '/)?.[1] ?? description.match(/^The units in '(.+?)' in component '/)?.[1]
  const detail = description.match(/ are not equivalent\. (.+)$/s)?.[1]
  return equation && detail ? `${equation}: ${detail}` : description
}
