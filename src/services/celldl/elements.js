/**
 * Gets the variable a clicked diagram element plots: its primary variable (a junction's flow or
 * potential, an element's own variable) if the module has a row for it, else its first variable
 * that has one.
 *
 * @param {{ primary?: string, variables?: Array<{ name: string }|string> }|null|undefined} entry - The
 *   element's entry in bg2cellml's element manifest, or its viewer annotation, which lists variables by name.
 * @param {Array<{ name: string }>} rows - The instance's variable rows.
 * @returns {string|null} The variable's name, or null if no variable of the element has a row.
 */
export function variableForElement(entry, rows) {
  if (!entry) return null
  const names = new Set((rows ?? []).map((row) => row.name))
  if (entry.primary && names.has(entry.primary)) return entry.primary
  const variables = (entry.variables ?? []).map((variable) => (typeof variable === 'string' ? variable : variable.name))
  return variables.find((name) => names.has(name)) ?? null
}
