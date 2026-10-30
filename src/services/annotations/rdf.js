/**
 * The only importer of oxigraph. Node (vitest) loads its sync entry; the browser loads the web entry and
 * initialises its wasm once. Callers see one async API returning plain triples.
 */

const FORMATS = {
  turtle: 'text/turtle',
  ttl: 'text/turtle',
  rdfxml: 'application/rdf+xml',
  rdf: 'application/rdf+xml',
  xml: 'application/rdf+xml',
  ntriples: 'application/n-triples',
  nt: 'application/n-triples',
}

let oxigraphPromise = null

const isNode = () => typeof process !== 'undefined' && Boolean(process.versions?.node)

/**
 * Loads oxigraph once, initialising the web entry's wasm in the browser.
 *
 * @returns {Promise<object>} The oxigraph module.
 */
export function loadOxigraph() {
  if (!oxigraphPromise) {
    oxigraphPromise = (isNode() ? loadNodeEntry() : loadWebEntry()).catch((error) => {
      oxigraphPromise = null
      throw error
    })
  }
  return oxigraphPromise
}

async function loadNodeEntry() {
  // A variable specifier keeps the CommonJS node entry out of the browser bundle.
  const specifier = 'oxigraph/node.js'
  const module = await import(/* @vite-ignore */ specifier)
  return module.default ?? module
}

async function loadWebEntry() {
  const [web, wasm] = await Promise.all([import('oxigraph/web.js'), import('oxigraph/web_bg.wasm?url')])
  await web.default({ module_or_path: wasm.default })
  return web
}

/**
 * Resolves a format name, extension or media type to an oxigraph media type.
 *
 * @param {string} format - e.g. 'turtle', 'ttl', 'rdfxml' or 'text/turtle'.
 * @returns {string} The media type.
 */
export function resolveFormat(format = 'turtle') {
  const key = String(format).toLowerCase().replace(/^\./, '').replace(/[/_-]/g, '')
  if (FORMATS[key]) return FORMATS[key]
  if (String(format).includes('/')) return format
  throw new Error(`Unknown RDF format '${format}'.`)
}

/**
 * Converts an oxigraph term to a plain object.
 *
 * @param {object} term - An oxigraph NamedNode, BlankNode or Literal.
 * @returns {{ termType: string, value: string, datatype?: string, language?: string }}
 */
function toPlainTerm(term) {
  if (term.termType === 'Literal') {
    const plain = { termType: 'Literal', value: term.value, datatype: term.datatype?.value }
    if (term.language) plain.language = term.language
    return plain
  }
  return { termType: term.termType, value: term.value }
}

/**
 * Parses RDF text into plain triples, ignoring graph names.
 *
 * @param {string} text - The RDF document.
 * @param {{ format?: string, baseIri: string }} options - Relative IRIs resolve against baseIri.
 * @returns {Promise<Array<{ subject: object, predicate: object, object: object }>>}
 * @throws {Error} On a syntax error.
 */
export async function parseRdf(text, { format = 'turtle', baseIri } = {}) {
  if (!baseIri) throw new Error('parseRdf needs an explicit baseIri.')
  const oxigraph = await loadOxigraph()
  const quads = oxigraph.parse(text, { format: resolveFormat(format), base_iri: baseIri })
  return quads.map((quad) => ({
    subject: toPlainTerm(quad.subject),
    predicate: toPlainTerm(quad.predicate),
    object: toPlainTerm(quad.object),
  }))
}
