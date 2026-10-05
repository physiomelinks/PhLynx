/**
 * Moves parameter values out of stored math: the math keeps its equations, declarations and each
 * state's link to its initialiser, and the values go to the parameter rows.
 * Pure (no Vue, no DOM), so it is safe in a worker.
 */
import { analyzeMathXml } from './analyzeMath'
import { VARIABLE_INTERFACE, isNumericLiteral } from '../../utils/variables'
import { getUniqueName } from '../../utils/identifiers'

// A whole <variable> element: CellML variables are always empty, so either form is the full element.
const VARIABLE_ELEMENT = /<((?:[\w.-]+:)?)variable\b((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(?:\/>|>\s*<\/\1variable\s*>)/g
const ATTRIBUTE = /([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

/**
 * Reads a tag's attributes, in order.
 *
 * @param {string} source - The attribute part of a tag.
 * @returns {Array<[string, string]>} Name and value pairs.
 */
function parseAttributes(source) {
  return [...source.matchAll(ATTRIBUTE)].map((match) => [match[1], match[2] ?? match[3] ?? ''])
}

/**
 * Writes a self-closing <variable> element.
 *
 * @param {string} prefix - The element's namespace prefix, e.g. `cellml:`, or ''.
 * @param {Array<[string, string]>} attributes
 * @returns {string}
 */
function printVariable(prefix, attributes) {
  return `<${prefix}variable${attributes.map(([name, value]) => ` ${name}="${value}"`).join('')}/>`
}

/**
 * Strips numeric initial values from a component's math, returning them separately. A state keeps
 * (or gets) `initial_value` naming its initialiser: a numeric value moves to a new `<state>_init`
 * variable, and a state with no initial value is linked to one with no value yet. Math already in
 * this form comes back unchanged.
 *
 * @param {string} xml - CellML model XML with one component.
 * @returns {{ math: string, values: Map<string, string>, initialisers: Set<string> }} The math, each
 *   variable's value by name, and the initialisers this created.
 */
export function separateParameters(xml) {
  const values = new Map()
  const initialisers = new Set()
  const analysis = analyzeMathXml(xml)
  if (!analysis) return { math: xml, values, initialisers }

  const states = new Set(analysis.stateVariables)
  const needsChange = analysis.declared.some(
    (variable) =>
      isNumericLiteral(variable.initialValue) || (states.has(variable.name) && !variable.initialValue.trim())
  )
  if (!needsChange) return { math: xml, values, initialisers }

  const takenNames = new Set([...analysis.declared.map((variable) => variable.name), ...analysis.referenced])

  const math = xml.replace(VARIABLE_ELEMENT, (element, prefix, attributeSource) => {
    const attributes = parseAttributes(attributeSource)
    const get = (key) => attributes.find(([name]) => name === key)?.[1] ?? ''
    const name = get('name')
    const initialValue = get('initial_value').trim()
    if (!name) return element

    const others = attributes.filter(([key]) => key !== 'initial_value')

    if (!states.has(name)) {
      if (!isNumericLiteral(initialValue)) return element
      values.set(name, initialValue)
      return printVariable(prefix, others)
    }

    // A state already linked to its initialiser keeps the link.
    if (initialValue && !isNumericLiteral(initialValue)) return element

    const initialiserName = getUniqueName(`${name}_init`, takenNames)
    takenNames.add(initialiserName)
    initialisers.add(initialiserName)
    if (initialValue) values.set(initialiserName, initialValue)

    const units = get('units')
    const initialiser = [['name', initialiserName], ...(units ? [['units', units]] : []), ['interface', VARIABLE_INTERFACE]]
    return printVariable(prefix, [...others, ['initial_value', initialiserName]]) + printVariable(prefix, initialiser)
  })

  return { math, values, initialisers }
}
