/**
 * XML DOM helpers that work alike in the browser, happy-dom and @xmldom/xmldom, which a worker installs as
 * `globalThis.DOMParser` and `globalThis.XMLSerializer`. They use only DOM Level 2 methods, as xmldom has no
 * `querySelector`, `remove`, `append` and the like, and they read parse errors from either implementation: a browser
 * returns a document holding `<parsererror>`, while xmldom throws.
 */

/** xmldom options: an `error` stops the parse, as a browser fails on it; warnings go unlogged. Others ignore it. */
const PARSER_OPTIONS = {
  onError(level, message) {
    if (level !== 'warning') throw new Error(message)
  },
}

/**
 * Parses XML, reporting a parse error instead of throwing.
 *
 * @param {string} text
 * @param {string} [type]
 * @returns {{ doc: Document|null, error: string|null }} The document, or null and the parser's message.
 */
export function tryParseXml(text, type = 'application/xml') {
  let doc
  try {
    doc = new globalThis.DOMParser(PARSER_OPTIONS).parseFromString(text, type)
  } catch (error) {
    return { doc: null, error: error.message }
  }
  const parserError = doc.getElementsByTagName('parsererror')[0]
  return parserError ? { doc: null, error: parserError.textContent } : { doc, error: null }
}

/**
 * Parses XML.
 *
 * @param {string} text
 * @param {string} [type]
 * @returns {Document|null} Null when it doesn't parse.
 */
export function parseXml(text, type = 'application/xml') {
  return tryParseXml(text, type).doc
}

/**
 * An element's child elements, optionally only those of one local name.
 *
 * @param {Element|Document} parent
 * @param {string} [localName]
 * @returns {Element[]}
 */
export function childElements(parent, localName) {
  const elements = Array.from(parent.childNodes).filter((node) => node.nodeType === 1)
  return localName === undefined ? elements : elements.filter((element) => element.localName === localName)
}

/**
 * The descendants of a document or element that have an `id`, in document order, as `querySelectorAll('[id]')`.
 *
 * @param {Document|Element} root
 * @returns {Element[]}
 */
export function elementsWithId(root) {
  return Array.from(root.getElementsByTagName('*')).filter((element) => element.hasAttribute('id'))
}

/**
 * Removes a node from its parent, if it has one, as `node.remove()`.
 *
 * @param {Node} node
 */
export function removeNode(node) {
  node.parentNode?.removeChild(node)
}

/**
 * Appends nodes to a parent in order, as `parent.append(...nodes)`.
 *
 * @param {Node} parent
 * @param {Iterable<Node>} nodes
 */
export function appendChildren(parent, nodes) {
  for (const node of nodes) parent.appendChild(node)
}
