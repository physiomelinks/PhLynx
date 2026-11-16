/**
 * Frees states a connection drives (see resolveBoundaryValues' `driven`): drops each one's own equation, d(state)/dt,
 * and its initial value from an instance's copy of the math, so the variable it is coupled to sets it. An initial
 * value held in another variable, such as `q_S_c_init`, goes too once nothing else uses it, as it would be left with
 * no value.
 */
import { CELLML_NS, MATHML_NS } from '../../utils/constants'

const childElements = (element) => [...element.childNodes].filter((node) => node.nodeType === 1)

/**
 * Gets the state an equation differentiates on either side, as in `<apply><eq/><apply><diff/><bvar>…</bvar><ci>q</ci>
 * </apply>…</apply>`, or the same with the derivative on the right.
 *
 * @param {Element} apply - A top-level `<apply>` of a `<math>` block.
 * @returns {string|null}
 */
function differentiatedState(apply) {
  const [operator, ...sides] = childElements(apply)
  if (operator?.localName !== 'eq' || sides.length !== 2) return null
  for (const side of sides) {
    if (side.localName !== 'apply') continue
    const [diff, ...rest] = childElements(side)
    if (diff?.localName !== 'diff') continue
    const ci = rest.find((element) => element.localName === 'ci')
    if (ci) return ci.textContent.trim()
  }
  return null
}

/**
 * Drops the equations and initial values of driven states from a model's first component.
 *
 * @param {string} xmlString - A model holding the instance's component, as the library stores math.
 * @param {Iterable<string>} stateNames - The states to free.
 * @returns {string} The rewritten model, or the same string when it doesn't parse or nothing is driven.
 */
export function dropDrivenStates(xmlString, stateNames) {
  const names = new Set(stateNames)
  if (!names.size) return xmlString

  const doc = new DOMParser().parseFromString(xmlString, 'application/xml')
  if (doc.getElementsByTagName('parsererror').length) return xmlString
  const component = doc.getElementsByTagNameNS(CELLML_NS, 'component')[0]
  if (!component) return xmlString

  const variables = childElements(component).filter((element) => element.localName === 'variable')
  const initialisers = new Set()
  for (const variable of variables) {
    if (!names.has(variable.getAttribute('name')) || !variable.hasAttribute('initial_value')) continue
    initialisers.add(variable.getAttribute('initial_value').trim())
    variable.removeAttribute('initial_value')
  }
  const maths = childElements(component).filter((element) => element.namespaceURI === MATHML_NS && element.localName === 'math')
  for (const math of maths) {
    for (const apply of childElements(math)) {
      if (apply.localName === 'apply' && names.has(differentiatedState(apply))) math.removeChild(apply)
    }
    if (!childElements(math).length) component.removeChild(math)
  }

  const used = new Set(variables.map((variable) => variable.getAttribute('initial_value')?.trim()).filter(Boolean))
  for (const ci of doc.getElementsByTagNameNS(MATHML_NS, 'ci')) used.add(ci.textContent.trim())
  for (const variable of variables) {
    const name = variable.getAttribute('name')
    if (initialisers.has(name) && !used.has(name)) component.removeChild(variable)
  }
  return new XMLSerializer().serializeToString(doc)
}
