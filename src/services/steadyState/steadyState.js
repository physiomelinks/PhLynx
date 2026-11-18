/**
 * Steady-state reduction of a module's math with @physiomelinks/steady-state: its transporter or enzyme cycles,
 * their flux in the common form `v = κ/Φ·{…}`, and the whole module at steady state. Pure, so it runs in the
 * steady-state worker and inline alike.
 */
import { readMathML, toEquations, toMathML } from '@physiomelinks/math-ast'
import { deriveSteadyState, reduceModel, suggestSpecs, verify } from '@physiomelinks/steady-state'
import { DOMParser } from '@xmldom/xmldom'

/**
 * @typedef {import('@physiomelinks/steady-state').SteadyStateSpec} SteadyStateSpec
 *
 * @typedef {Object} SteadyStateAnalysis
 * @property {Array<{ spec: SteadyStateSpec, reactions: string[], solutes: string[] }>} suggestions - The cycles found.
 * @property {SteadyStateSpec|null} spec - The spec used: the one given, or the first suggestion.
 * @property {Array<{ code: string, message: string }>} issues - Why there is no result, or no common form.
 * @property {Object|null} common - The common form's summary, when there is one.
 * @property {Object|null} reduced - The module at steady state: `mathml` (one `<math>`), `sections`, `flux` and
 *   `parameters` (variables it adds, such as the cycle's total).
 * @property {number|null} verifyError - The largest relative difference from a numeric solve of the full cycle.
 */

const MATH_PATTERN = /<math\b[\s\S]*?<\/math>/g

/**
 * Reads a model's equations.
 *
 * @param {string} xml - CellML model XML.
 * @returns {import('@physiomelinks/math-ast').Equation[]}
 */
export function readEquations(xml) {
  const domParser = new DOMParser()
  const expressions = (xml.match(MATH_PATTERN) ?? []).flatMap((math) => readMathML(math, { domParser }).expressions)
  return toEquations(expressions.filter(Boolean))
}

/**
 * Finds a module's cycles and reduces one of them.
 *
 * @param {Object} options
 * @param {string} options.xml - The module's CellML model XML.
 * @param {SteadyStateSpec|null} [options.spec] - What to reduce; by default the first cycle found.
 * @param {Object<string, number>} [options.values] - Parameter values: for transformer ratios, and the numeric check.
 * @param {string[]} [options.ratios] - Parameters that are transformer ratios, to recognise as multiples of F.
 * @param {string[]} [options.keep] - The cycle's variables to keep at their steady state, such as reaction fluxes the
 *   module's annotations name, so they still can.
 * @param {boolean} [options.check] - Also check the result numerically against the full cycle; only when asked, as it
 *   costs a numeric solve per sample.
 * @returns {SteadyStateAnalysis}
 */
export function analyseSteadyState({ xml, spec = null, values = {}, ratios = [], keep = [], check = false }) {
  const empty = { suggestions: [], spec: null, issues: [], common: null, reduced: null, verifyError: null }
  if (typeof xml !== 'string' || !xml.trim()) return empty

  const equations = readEquations(xml)
  const suggestions = suggestSpecs(equations, { values, ratios })
  const chosen = spec ?? suggestions[0]?.spec ?? null
  if (!chosen) {
    return {
      ...empty,
      issues: [{ code: 'no-cycle', message: 'No conserved enzyme or transporter cycle was found in this module.' }],
    }
  }

  const result = deriveSteadyState(equations, chosen)
  if (!result.ok) return { ...empty, suggestions, spec: chosen, issues: [...result.issues] }

  const reduced = reduceModel(equations, chosen, result, { keep })
  const cnUnits = (cn) => cn.units ?? 'dimensionless'
  let verifyError = null
  if (check) {
    try {
      verifyError = verify(equations, chosen, result, { fastScale: 1e9, values }).maxRelativeError
    } catch {
      verifyError = null
    }
  }

  return {
    suggestions,
    spec: chosen,
    issues: [...result.issues],
    common: result.common ? summarise(result.common) : null,
    reduced: {
      mathml: toMathML(reduced.equations, { cnUnits }),
      sections: reduced.sections.map(({ title, variables }) => ({ title, variables: [...variables] })),
      flux: reduced.flux,
      parameters: [...reduced.parameters],
    },
    verifyError,
  }
}

/**
 * What the setup panel shows of the common form.
 *
 * @param {import('@physiomelinks/steady-state').CommonForm} common
 */
function summarise(common) {
  const z = common.exponent?.z
  return {
    bracket: common.bracket,
    concentrations: common.concentrations,
    kappa: common.kappa.name,
    qeq: common.qeq?.name ?? null,
    phi: common.phi.name,
    z: z ? (z.d === 1n ? String(z.n) : `${z.n}/${z.d}`) : null,
    potential: common.exponent?.potential ?? null,
    lumped: common.definitions.map(({ name }) => name),
    variables: common.variables.map(({ name }) => name),
  }
}
