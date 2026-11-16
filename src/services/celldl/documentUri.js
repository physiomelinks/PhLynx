/**
 * The IRI a CellDL document is read under. The editor saves relative IRIs, so a diagram reads
 * the same under any IRI, but it opens a document with absolute IRIs only under that document's own.
 */

/** PhLynx's folder under bg2cellml's base for local models (LOCAL_MODEL_BASE), so messages name them briefly. */
export const LOCAL_DOCUMENT_BASE = 'https://bg-rdf.org/models/local/phlynx/'

/**
 * Mints a document IRI for a module's diagram. The slug keeps only characters encodeURI leaves
 * alone, so the editor, which encodes the name it opens a file under, gives back the same IRI.
 *
 * @param {string} mathRef - The module's math, e.g. `my file.cellml:pump`.
 * @returns {string} e.g. `https://bg-rdf.org/models/local/phlynx/my_file.cellml_pump.celldl`.
 */
export function mintDocumentUri(mathRef) {
  const slug = String(mathRef ?? '').replace(/[^A-Za-z0-9._-]+/g, '_') || 'module'
  return `${LOCAL_DOCUMENT_BASE}${slug}.celldl`
}

/**
 * Gets the IRI to store for a converted document: the one it was read under, unless its Turtle
 * names the model with an absolute IRI in another document, which it must then be opened under.
 *
 * @param {{ baseUri: string, modelIri?: string }} result - A bg2cellml conversion result.
 * @returns {string}
 */
export function documentUriFor({ baseUri, modelIri }) {
  const document = modelIri?.split('#')[0]
  return document && document !== baseUri ? document : baseUri
}
