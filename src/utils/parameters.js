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
 * Splits `<instance>/<variable>` names (circulatory_autogen's form; `heart/lv/E_A` for a nested instance) into
 * values by node name, then by variable name. PhLynx's instances aren't nested, so a nested path names the node
 * of its last instance segment; paths that differ before that segment and name the same row are ambiguous.
 *
 * @returns {{byInstance: Map<string, Map<string, object>>, ambiguous: Array}} Values by node name then variable
 *   name, and the ambiguous rows of existing nodes as skipped entries.
 */
function slashParameters(instanceNames, rows) {
  const candidates = new Map()
  for (const entry of rows) {
    const path = entry.variable_name.trim()
    const split = path.lastIndexOf('/')
    const prefix = path.slice(0, split)
    const instance = instanceNames.has(prefix) ? prefix : prefix.split('/').pop()
    const key = `${instance}/${path.slice(split + 1)}`
    if (!candidates.has(key)) candidates.set(key, new Map())
    candidates.get(key).set(prefix, entry)
  }

  const byInstance = new Map()
  const ambiguous = []
  for (const [key, byPrefix] of candidates) {
    const split = key.lastIndexOf('/')
    const [instance, name] = [key.slice(0, split), key.slice(split + 1)]
    // A path naming the instance itself beats nested paths ending in it.
    const entry = byPrefix.get(instance) ?? (byPrefix.size === 1 ? [...byPrefix.values()][0] : undefined)
    if (!entry) {
      if (instanceNames.has(instance)) {
        ambiguous.push(...[...byPrefix.keys()].map((prefix) => ({ nodeName: prefix, name, ambiguous: true })))
      }
      continue
    }
    if (!byInstance.has(instance)) byInstance.set(instance, new Map())
    byInstance.get(instance).set(name, entry)
  }
  return { byInstance, ambiguous }
}

/**
 * Matches a parameters file's `<instance>/<variable>` and `<variable>_<instance>` rows to each node's rows and
 * applies them.
 *
 * @param {Array} nodes - Workspace nodes with `data.name` and `data.variables`; not changed.
 * @param {Array<{variable_name: string, units: string, value: string, data_reference: string}>} rows
 * @returns {{variablesById: Map<string, Array>, updated: number, skipped: Array}}
 *   Each changed node's new rows, how many rows took a value, and the rows left as they were: computed rows, and
 *   nested names that match more than one instance (`ambiguous`).
 */
export function applyParametersToNodes(nodes, rows) {
  const variablesById = new Map()
  let updated = 0

  const isSlashName = (entry) => entry.variable_name.includes('/')
  const underscoreRows = rows.filter((entry) => !isSlashName(entry))
  const instanceNames = new Set(nodes.map((node) => node.data.name))
  const { byInstance, ambiguous } = slashParameters(instanceNames, rows.filter(isSlashName))
  const skipped = [...ambiguous]

  for (const node of nodes) {
    const instance = node.data.name
    // A `<instance>/<variable>` row wins over a `<variable>_<instance>` row for the same variable.
    const paramsByName = new Map([
      ...underscoreRows
        .filter((entry) => entry.variable_name.trimEnd().endsWith(instance))
        .map((entry) => [entry.variable_name.trimEnd().slice(0, -instance.length).replace(/_+$/, '').trim(), entry]),
      ...(byInstance.get(instance) ?? []),
    ])
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
 * Describes the rows whose loaded values were not applied, naming at most three of each kind.
 *
 * @param {Array<{nodeName: string, name: string, ambiguous?: boolean}>} skipped
 * @returns {string}
 */
export function skippedParametersMessage(skipped) {
  const describe = (rows, one, many, separator) => {
    if (!rows.length) return ''
    const named = rows.slice(0, MAX_NAMED_SKIPPED).map(({ nodeName, name }) => `${nodeName}${separator}${name}`)
    const more = rows.length - named.length
    const list = more > 0 ? `${named.join(', ')} and ${more} more` : named.join(', ')
    if (rows.length === 1) return `1 value wasn't applied, as ${one}: ${list}.`
    return `${rows.length} values weren't applied, as ${many}: ${list}.`
  }
  return [
    describe(
      skipped.filter((row) => !row.ambiguous),
      "its variable is computed by its module's math",
      "their variables are computed by their modules' math",
      '.'
    ),
    describe(
      skipped.filter((row) => row.ambiguous),
      'its nested name matches more than one instance',
      'their nested names match more than one instance',
      '/'
    ),
  ]
    .filter(Boolean)
    .join(' ')
}
