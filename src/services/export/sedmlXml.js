/**
 * Writing SED-ML (Level 1 Version 4) as PhLynx does: its elements, the XPaths of model variables, and line styles,
 * shared by a protocol's run and a time course's.
 */
import { buildAlgorithm, formatSedNumber } from '../simulation/sedParameters'

export const SEDML_NAMESPACE = 'http://sed-ml.org/sed-ml/level1/version4'
export const CELLML_NAMESPACE = 'http://www.cellml.org/cellml/2.0#'
export const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML'

const LINE_THICKNESS = '1.5'

/**
 * Makes an XML element.
 *
 * @param {string} name
 * @param {Object} [attributes] - Values written as text; null and undefined ones are left out.
 * @param {Array<Object|null|false>|string} [children] - Elements (falsy ones left out), or the element's text.
 * @returns {{name: string, attributes: Object, children: Array|string}}
 */
export const element = (name, attributes = {}, children = []) => ({ name, attributes, children })

/**
 * Escapes text for XML, between tags or in a double-quoted attribute (so XPaths keep their single quotes).
 *
 * @param {*} text
 * @returns {string}
 */
const escapeXml = (text) =>
  String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/**
 * Writes an element and its children, indented two spaces a level.
 *
 * @param {Object} node - From element.
 * @param {number} [depth]
 * @returns {string}
 */
export function writeElement({ name, attributes, children }, depth = 0) {
  const indent = '  '.repeat(depth)
  const written = Object.entries(attributes)
    .filter(([, value]) => value != null)
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join('')
  if (typeof children === 'string') return `${indent}<${name}${written}>${escapeXml(children)}</${name}>`
  const kept = children.filter(Boolean)
  if (!kept.length) return `${indent}<${name}${written}/>`
  return [`${indent}<${name}${written}>`, ...kept.map((child) => writeElement(child, depth + 1)), `${indent}</${name}>`].join('\n')
}

/**
 * Wraps MathML content in its `<math>` element.
 *
 * @param {Object} content
 * @returns {Object}
 */
export const math = (content) => element('math', { xmlns: MATHML_NAMESPACE }, [content])

/**
 * Makes MathML naming a variable.
 *
 * @param {string} id
 * @returns {Object}
 */
export const ci = (id) => element('ci', {}, id)

/**
 * Makes MathML for a number, written as the rest of the SED-ML writes them.
 *
 * @param {number} value
 * @returns {Object}
 */
export const cn = (value) => element('cn', {}, formatSedNumber(value))

/**
 * Writes the XPath of a model variable named `component/variable`, as libOpenCOR reports it.
 *
 * @param {string} name
 * @returns {string}
 */
export function writeTarget(name) {
  const separator = name.indexOf('/')
  return `/cellml:model/cellml:component[@name='${name.slice(0, separator)}']/cellml:variable[@name='${name.slice(separator + 1)}']`
}

/**
 * Writes a '#' hex colour as SED-ML has them: RRGGBB, or RRGGBBAA with its alpha, without '#'.
 *
 * @param {string} colour - '#rgb', '#rgba', '#rrggbb' or '#rrggbbaa', as resolveExperimentColour gives them.
 * @returns {string}
 */
export function writeColour(colour) {
  const digits = colour.slice(1)
  return (digits.length <= 4 ? [...digits].map((digit) => digit + digit).join('') : digits).toUpperCase()
}

/**
 * Adds a unit to a name, as the axes show them.
 *
 * @param {string} text
 * @param {string|null|undefined} unit
 * @returns {string}
 */
export const withUnit = (text, unit) => (unit ? `${text} (${unit})` : text)

/**
 * Makes a line style.
 *
 * @param {string} id
 * @param {{baseStyle?: string, line: {type: string, color: string}}} options
 * @returns {Object}
 */
export const style = (id, { baseStyle, line }) =>
  element('style', { id, baseStyle }, [element('line', { type: line.type, color: line.color, thickness: LINE_THICKNESS })])

/**
 * Makes a data generator's variable.
 *
 * @param {string} id
 * @param {string} name - The model variable, `component/variable`.
 * @param {string} taskReference
 * @returns {Object}
 */
export const variable = (id, name, taskReference) => element('variable', { id, target: writeTarget(name), taskReference })

/**
 * Makes a simulation's algorithm, its solver and parameters, from the run's settings.
 *
 * @param {Object} settings - Simulation settings.
 * @returns {Object}
 */
export function algorithmElement(settings) {
  const { solver, parameters } = buildAlgorithm(settings)
  return element('algorithm', { kisaoID: solver.kisaoId }, [
    element(
      'listOfAlgorithmParameters',
      {},
      parameters.map(({ kisaoId, value }) => element('algorithmParameter', { kisaoID: kisaoId, value }))
    ),
  ])
}

// libOpenCOR's namespace, for what SED-ML has no place for, such as a time course's NLA solver.
const LIBOPENCOR_NAMESPACE = 'https://opencor.ws/libopencor'
// KINSOL, which libOpenCOR solves a model's algebraic loops with, and its parameters as libOpenCOR writes them.
const KINSOL_KISAO_ID = 'KISAO:0000282'
const KINSOL_PARAMETERS = [
  { kisaoId: 'KISAO:0000477', value: 'Dense' },
  { kisaoId: 'KISAO:0000479', value: '0' },
  { kisaoId: 'KISAO:0000480', value: '0' },
  { kisaoId: 'KISAO:0000486', value: '200' },
]

/**
 * Makes KINSOL's algorithm: a steady state's, or as `nlaAlgorithm`, a time course's for its algebraic loops, as
 * libOpenCOR writes and reads it.
 *
 * @param {'algorithm'|'nlaAlgorithm'} [name]
 * @returns {Object}
 */
export const kinsolElement = (name = 'algorithm') =>
  element(name, { xmlns: name === 'nlaAlgorithm' ? LIBOPENCOR_NAMESPACE : null, kisaoID: KINSOL_KISAO_ID }, [
    element(
      'listOfAlgorithmParameters',
      {},
      KINSOL_PARAMETERS.map(({ kisaoId, value }) => element('algorithmParameter', { kisaoID: kisaoId, value }))
    ),
  ])

/**
 * Writes a SED-ML document.
 *
 * @param {Object} document - The sedML element, from element.
 * @returns {string}
 */
export const writeDocument = (document) => `<?xml version="1.0" encoding="UTF-8"?>\n${writeElement(document)}\n`
