import { loggerMessages } from '../../utils/cellml'
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

/** Each message once: libCellML reports a misspelt name at each place the math uses it. */
const unique = (messages) => [...new Set(messages)]

/** What checkMath finds in a math with nothing wrong. */
export const NO_FINDINGS = Object.freeze({ invalid: Object.freeze([]), imbalances: Object.freeze([]) })

/**
 * Checks a math on its own, with the library's units: whether it's valid CellML, and, if it is, which equations'
 * units don't balance.
 *
 * Invalid is what the Parser and Validator report, such as a variable the math uses but doesn't declare, or a
 * units no units file defines; the export rejects such math. The Analyser's own errors (a state with no initial
 * value, a variable it can't classify) aren't reported: on its own a math lacks the values its parameter rows and
 * connections give it.
 *
 * Imbalances are equations such as `dx/dt = k*x` with k in seconds, as the Analyser reports them. That includes
 * terms that differ only in scale (ms and s), which libCellML doesn't convert inside an equation. A units the
 * Analyser can't work out, such as a power with a variable exponent, isn't reported. The Analyser checks units
 * only in valid math, so invalid math has none.
 *
 * @param {Object} libcellml - The libCellML instance.
 * @param {string} mathXml - A math as libraryStore keeps it: a CellML 2.0 model with one component.
 * @param {Map<string, Array<Object>>} unitDefinitions - The library's, as libraryStore.unitDefinitions.
 * @returns {{ invalid: string[], imbalances: string[] }} libCellML's descriptions.
 */
export function checkMath(libcellml, mathXml, unitDefinitions) {
  if (typeof mathXml !== 'string' || !mathXml.trim()) return NO_FINDINGS

  // The math's units definitions go before its component, in its own model.
  const units = unitsModelXml(unitsNeededBy(mathXml, unitDefinitions))
  const definitions = units.slice(units.indexOf('>', units.indexOf('<model')) + 1, units.lastIndexOf('</model>'))
  const xml = mathXml.replace(/<model\b[^>]*>/, (open) => `${open}\n${definitions}`)

  const parser = new libcellml.Parser(false)
  const validator = new libcellml.Validator()
  const analyser = new libcellml.Analyser()
  let model = null
  try {
    model = parser.parseModel(xml)
    if (!model || parser.errorCount()) return { invalid: unique(loggerMessages(parser)), imbalances: [] }

    validator.validateModel(model)
    if (validator.errorCount()) return { invalid: unique(loggerMessages(validator)), imbalances: [] }

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
    return imbalances.length ? { invalid: [], imbalances: unique(imbalances) } : NO_FINDINGS
  } finally {
    model?.delete()
    analyser.delete()
    validator.delete()
    parser.delete()
  }
}

/**
 * Shortens an imbalance from checkMath to its equation and what doesn't match, e.g.
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
 * Shortens a validity error from checkMath: the component is always the math's own, so isn't named.
 *
 * @param {string} description
 * @returns {string}
 */
export function summariseInvalid(description) {
  return description.replace(/ (in|of|present in) component '[^']*'/g, '').replace(/ in the parent model/g, ' in the units library')
}
