/**
 * Checks a CellDL document has what the CellDL editor needs to open it, beyond the BG-RDF bg2cellml reads.
 */

/**
 * Finds the elements a CellDL document doesn't draw: those without an SVG element of their id, or whose group
 * is empty. The CellDL editor can't open such a document, though bg2cellml, which reads only its metadata,
 * converts it.
 *
 * @param {string} document - The CellDL SVG.
 * @param {string[]} ids - The SVG ids of its elements, e.g. the keys of bg2cellml's element manifest.
 * @returns {string[]} Those it doesn't draw, in the order given.
 */
export function undrawnElements(document, ids) {
  const svg = new DOMParser().parseFromString(document, 'image/svg+xml')
  return ids.filter((id) => {
    const element = svg.getElementById(id)
    if (!element) return true
    // The editor centres an element on its group's first child.
    const isGroup = element.localName === 'g'
    return isGroup && !Array.from(element.childNodes).some((child) => child.nodeType === 1)
  })
}

/**
 * Gives the error for elements a document doesn't draw.
 *
 * @param {string[]} ids - From undrawnElements; not empty.
 * @returns {{ message: string, severity: 'error', stage: 'diagram' }}
 */
export function undrawnError(ids) {
  const listed = ids.length > 1 ? `${ids.slice(0, -1).join(', ')} and ${ids.at(-1)}` : ids[0]
  return {
    message: `The diagram has no drawing of ${listed}, so the CellDL editor can't open it`,
    severity: 'error',
    stage: 'diagram',
  }
}
