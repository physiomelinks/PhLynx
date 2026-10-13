/**
 * Applies loaded parameter values to instance rows. A value never changes a row's type: a boundary
 * condition's value stays a fallback, used only while no connection supplies it (as in
 * circulatory_autogen), and a computed row's value is not applied.
 */

/** Most skipped rows a message names. */
const MAX_NAMED_SKIPPED = 3

/**
 * Applies values to a node's rows, keeping each row's type.
 *
 * @param {Array} variables - The node's rows.
 * @param {(name: string) => ({value?: string, data_reference?: string}|undefined)} valueFor - The value for a row name.
 * @returns {{variables: Array, updated: number, skipped: string[]}} New rows, how many took a value, and the names of
 *   computed rows whose value was not applied.
 */
export function applyParameterValues(variables, valueFor) {
  let updated = 0
  const skipped = []
  const rows = variables.map((variable) => {
    const match = valueFor(variable.name.trim())
    if (!match) return variable
    if (variable.type === 'variable') {
      skipped.push(variable.name)
      return variable
    }
    updated++
    return { ...variable, value: match.value?.trim() ?? '', data_reference: match.data_reference?.trim() ?? '' }
  })
  return { variables: rows, updated, skipped }
}

/**
 * Matches a parameters file's `<variable>_<instance>` rows to each node's rows and applies them.
 *
 * @param {Array} nodes - Workspace nodes with `data.name` and `data.variables`; not changed.
 * @param {Array<{variable_name: string, units: string, value: string, data_reference: string}>} rows
 * @returns {{variablesById: Map<string, Array>, updated: number, skipped: Array<{nodeName: string, name: string}>}}
 *   Each changed node's new rows, how many rows took a value, and the computed rows left as they were.
 */
export function applyParametersToNodes(nodes, rows) {
  const variablesById = new Map()
  const skipped = []
  let updated = 0

  for (const node of nodes) {
    const instance = node.data.name
    const paramsByName = new Map(
      rows
        .filter((entry) => entry.variable_name.trimEnd().endsWith(instance))
        .map((entry) => [entry.variable_name.trimEnd().slice(0, -instance.length).replace(/_+$/, '').trim(), entry])
    )
    if (!paramsByName.size) continue

    for (const variable of node.data.variables) {
      const match = paramsByName.get(variable.name.trim())
      if (match && match.units.trim() !== variable.units.trim()) {
        console.warn(
          `Unit mismatch for "${variable.name}": node has "${variable.units.trim()}", parameter has "${match.units.trim()}"`
        )
      }
    }

    const result = applyParameterValues(node.data.variables, (name) => paramsByName.get(name))
    if (result.updated || result.skipped.length) variablesById.set(node.id, result.variables)
    updated += result.updated
    skipped.push(...result.skipped.map((name) => ({ nodeName: instance, name })))
  }

  return { variablesById, updated, skipped }
}

/**
 * Describes the computed rows whose loaded values were not applied, naming at most three.
 *
 * @param {Array<{nodeName: string, name: string}>} skipped
 * @returns {string}
 */
export function skippedParametersMessage(skipped) {
  const named = skipped.slice(0, MAX_NAMED_SKIPPED).map(({ nodeName, name }) => `${nodeName}.${name}`)
  const more = skipped.length - named.length
  const list = more > 0 ? `${named.join(', ')} and ${more} more` : named.join(', ')
  if (skipped.length === 1) return `1 value wasn't applied, as its variable is computed by its module's math: ${list}.`
  return `${skipped.length} values weren't applied, as their variables are computed by their modules' math: ${list}.`
}
