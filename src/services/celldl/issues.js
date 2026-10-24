/** Issues listed in a message before the rest are counted. */
const MAX_LISTED_ISSUES = 5

/**
 * Lists a conversion's issues one per line, after the element each names.
 *
 * @param {Array<{ message: string, elementId?: string }>} issues - bg2cellml issues.
 * @returns {string[]}
 */
export function issueLines(issues) {
  const lines = issues
    .slice(0, MAX_LISTED_ISSUES)
    .map((issue) => `• ${issue.elementId ? `${issue.elementId}: ` : ''}${issue.message}`)
  if (issues.length > MAX_LISTED_ISSUES) lines.push(`…and ${issues.length - MAX_LISTED_ISSUES} more`)
  return lines
}

/**
 * Gets the label a diagram element is known by: its manifest entry's, else its viewer annotation's, else its id.
 *
 * @param {string} id - Its SVG id.
 * @param {Object} [sources]
 * @param {Object} [sources.elements] - bg2cellml's element manifest, by id.
 * @param {Object} [sources.annotations] - Viewer annotations, by SVG id (useCelldlEditorHost's `annotations`).
 * @returns {string}
 */
export function elementLabel(id, { elements = {}, annotations = {} } = {}) {
  const entry = elements?.[id]
  return entry?.label || entry?.symbol || annotations?.[id]?.label || id
}

/**
 * Lists every one of a conversion's issues, errors first, each with the label of the element it names, if any.
 *
 * @param {{errors?: Object[], warnings?: Object[]}} result - bg2cellml's issues, by severity.
 * @param {Object} [sources] - Where element labels come from (elementLabel).
 * @returns {{key: string, severity: 'error'|'warning', message: string, elementId: string|null, label: string|null}[]}
 */
export function issueItems({ errors = [], warnings = [] } = {}, sources = {}) {
  const item = (severity) => (issue, index) => ({
    key: `${severity}-${index}`,
    severity,
    message: issue.message,
    elementId: issue.elementId ?? null,
    label: issue.elementId ? elementLabel(issue.elementId, sources) : null,
  })
  return [...errors.map(item('error')), ...warnings.map(item('warning'))]
}

/**
 * Warns of each store or source whose location isn't that of the labelled compartment it is drawn in, e.g. as it was
 * set by hand: the CellDL editor lists that compartment's location as the element's `compartment`.
 *
 * @param {Array<{ id: string, location?: string, compartment?: string }>|null} elements - The editor's element list.
 * @returns {Array<{ message: string, elementId: string }>} Warnings of bg2cellml's shape.
 */
export function compartmentLocationWarnings(elements) {
  return (elements ?? [])
    .filter((element) => element.compartment && element.compartment !== element.location)
    .map((element) => ({
      message: `Its location is ${element.location ? `'${element.location}'` : 'unset'}, but it is inside compartment '${element.compartment}'`,
      elementId: element.id,
    }))
}
