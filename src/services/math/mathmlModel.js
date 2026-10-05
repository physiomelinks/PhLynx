/**
 * Converts between a model's XML and the Content MathML equations a math editor works on. The
 * model is built the way CellMLTextParser builds it in Simple Mode, so both editors produce
 * equivalent XML for the same equations.
 */
import { CellMLTextParser, applyVariableDefinitions } from 'cellml-text-editor'

const CELLML_NS = 'http://www.cellml.org/cellml/2.0#'
const MATHML_NS = 'http://www.w3.org/1998/Math/MathML'
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/'
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8"?>\n'

// Only used for its serializer, which writes namespaces and <sep/> the way the text editor does.
const serializer = new CellMLTextParser({ simplified: true })

/**
 * Parses an XML string, returning null if it is empty or malformed.
 *
 * @param {string} xml
 * @returns {Document|null}
 */
function parseXml(xml) {
  if (!xml) return null
  const doc = new DOMParser().parseFromString(xml, 'application/xml')
  return doc.querySelector('parsererror') ? null : doc
}

/**
 * Reads the Content MathML of the model's first component, the component Simple Mode edits.
 *
 * @param {string} xml - CellML model XML.
 * @returns {string[]} Each `<math>` element of the component, standalone.
 */
export function extractEquationsMathML(xml) {
  const component = parseXml(xml)?.getElementsByTagName('component')[0]
  if (!component) return []
  return Array.from(component.getElementsByTagNameNS(MATHML_NS, 'math')).map((math) =>
    serializer.serialize(declareCellmlPrefix(math.cloneNode(true)))
  )
}

/**
 * Declares the `cellml` prefix on a `<math>` element whose `cellml:units` attributes need it. The
 * serializer can't tell on its own, since happy-dom leaves those attributes without a namespace.
 *
 * @param {Element} math
 * @returns {Element} The same element.
 */
function declareCellmlPrefix(math) {
  const usesPrefix = Array.from(math.getElementsByTagName('*')).some((element) =>
    Array.from(element.attributes).some((attribute) => attribute.name.startsWith('cellml:'))
  )
  if (usesPrefix && !math.hasAttribute('xmlns:cellml')) math.setAttributeNS(XMLNS_NS, 'xmlns:cellml', CELLML_NS)
  return math
}

/**
 * Builds a single-component model from equations, declaring the variables they use.
 *
 * @param {Object} options
 * @param {string} [options.baseXml] - The model being edited; its root attributes are kept.
 * @param {string} [options.componentName] - Defaults to the base model's first component name.
 * @param {string[]} options.mathml - Content MathML per line, each a `<math>` element; blank lines are skipped
 *   but still counted, so error line numbers match the editor's.
 * @param {Array} [options.definitions] - Variable declarations from buildVariableDeclarations.
 * @returns {{ xml: string|null, errors: Array<{ line: number, message: string }> }}
 */
export function buildModelFromEquations({ baseXml, componentName, mathml, definitions = [] }) {
  // Parsed rather than created: happy-dom's createDocument returns an HTML document.
  const doc = parseXml(`<model xmlns="${CELLML_NS}"/>`)
  const model = doc.documentElement
  const base = parseXml(baseXml)

  for (const attribute of Array.from(base?.documentElement.attributes ?? [])) {
    if (attribute.name !== 'xmlns' && !attribute.name.startsWith('xmlns:')) {
      model.setAttribute(attribute.name, attribute.value)
    }
  }

  const component = doc.createElementNS(CELLML_NS, 'component')
  const baseName = base?.getElementsByTagName('component')[0]?.getAttribute('name')
  component.setAttribute('name', componentName || baseName || 'component')
  model.appendChild(component)

  const math = doc.createElementNS(MATHML_NS, 'math')
  const errors = []
  mathml.forEach((equation, index) => {
    if (!equation.trim()) return
    const root = parseXml(equation)?.documentElement
    if (!root) {
      errors.push({ line: index + 1, message: 'The equation is not valid MathML.' })
      return
    }
    // Each equation arrives as its own <math>; the model keeps them all in one.
    const nodes = root.localName === 'math' ? Array.from(root.children) : [root]
    // CellML only allows equations at the top level of <math>.
    if (!nodes.every((node) => node.localName === 'apply' && node.firstElementChild?.localName === 'eq')) {
      errors.push({ line: index + 1, message: 'This is not an equation. Use = to give it a left and right side.' })
      return
    }
    for (const node of nodes) math.appendChild(doc.importNode(node, true))
  })
  if (errors.length) return { xml: null, errors }

  if (math.children.length) component.appendChild(declareCellmlPrefix(math))
  applyVariableDefinitions(doc, definitions)

  return { xml: XML_HEADER + serializer.serialize(model), errors }
}
