/**
 * The reduced module as CellML: the steady-state equations, declaring the module's own variables as its math does
 * and the variables the reduction adds with units found from their definitions.
 */
import { sectionLayout } from '../celldl/sectionLayout'
import { buildModelFromEquations } from '../math/mathmlModel'
import { inferSteadyStateUnits } from './steadyStateUnits'

const NUMERIC = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/

/**
 * Reads the variable declarations of a model's first component.
 *
 * @param {string} xml - CellML model XML.
 * @returns {Array<{ name: string, units: string, interface: string, initialValue?: string }>} An initial value only
 *   when it names another variable (a state's initialiser); numbers are values, not declarations.
 */
export function declarationsFromModel(xml) {
  const doc = new DOMParser().parseFromString(xml ?? '', 'application/xml')
  const component = doc.getElementsByTagName('component')[0]
  if (!component || doc.getElementsByTagName('parsererror').length) return []
  return Array.from(component.getElementsByTagName('variable')).flatMap((variable) => {
    const name = variable.getAttribute('name')
    const units = variable.getAttribute('units')
    if (!name || !units) return []
    const initial = variable.getAttribute('initial_value')
    return [{ name, units, interface: 'public', ...(initial && !NUMERIC.test(initial) ? { initialValue: initial } : {}) }]
  })
}

/**
 * Builds the reduced module.
 *
 * @param {Object} options
 * @param {string} options.xml - The full module's CellML.
 * @param {import('./steadyState').SteadyStateAnalysis} options.analysis - With a `reduced` result.
 * @param {Map<string, Array<Object>>} options.unitDefinitions - The library's units.
 * @param {string} [options.componentName] - The component's name; the full module's by default.
 * @param {Array<Object>} [options.declarations] - The full module's declarations; read from `xml` by default.
 * @param {Object<string, number>} [options.values] - Values to give the variables, as initial values.
 * @returns {{ xml: string, layout: Object|null, added: Array<Object>, unresolved: string[] }|null} Null when it can't
 *   be built.
 */
export function buildReducedModel({ xml, analysis, unitDefinitions, componentName, declarations, values = null }) {
  if (!analysis?.reduced) return null
  const own = declarations ?? declarationsFromModel(xml)
  const known = new Map(own.map((declaration) => [declaration.name, declaration.units]))
  // The cycle's total is an amount, as its states are
  const firstState = analysis.spec?.cycleStates?.[0]
  const totals = analysis.reduced.parameters.filter(() => known.has(firstState))
  for (const name of totals) known.set(name, known.get(firstState))
  const { units, unresolved } = inferSteadyStateUnits({ mathml: analysis.reduced.mathml, known, unitDefinitions })
  const added = [...totals.map((name) => [name, known.get(name)]), ...units].map(([name, unitsName]) => ({
    name,
    units: unitsName,
    interface: 'public',
  }))

  const withValue = (declaration) => {
    const value = values?.[declaration.name]
    return declaration.initialValue === undefined && Number.isFinite(value) ? { ...declaration, initialValue: String(value) } : declaration
  }
  const name = componentName || new DOMParser().parseFromString(xml, 'application/xml').getElementsByTagName('component')[0]?.getAttribute('name')
  const built = buildModelFromEquations({
    baseXml: xml,
    componentName: name,
    mathml: [analysis.reduced.mathml],
    definitions: [...own, ...added].map(withValue),
  })
  if (!built.xml) return null
  return { xml: built.xml, layout: sectionLayout(built.xml, name, analysis.reduced.sections), added, unresolved }
}

/**
 * The reduced module's default values: the full module's, and the cycle's total as the sum of its states' initial
 * amounts.
 *
 * @param {Map<string, string>} defaults - The full module's defaults (libraryStore.getMathDefaults).
 * @param {Array<Object>} declarations - The full module's declarations, for states' initialisers.
 * @param {import('./steadyState').SteadyStateAnalysis} analysis
 * @returns {Map<string, string>}
 */
export function reducedDefaults(defaults, declarations, analysis) {
  const result = new Map(defaults)
  const initialiser = new Map(declarations.filter((d) => d.initialValue).map((d) => [d.name, d.initialValue]))
  const amountOf = (state) => Number(defaults.get(state) ?? defaults.get(initialiser.get(state)))
  const total = (analysis?.spec?.cycleStates ?? []).reduce((sum, state) => sum + amountOf(state), 0)
  if (Number.isFinite(total)) for (const name of analysis?.reduced?.parameters ?? []) result.set(name, String(total))
  return result
}
