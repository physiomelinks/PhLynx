/**
 * Applies parameter-file rows (`{ variable_name, units, value, data_reference }`)
 * to workspace nodes, as when a parameters file is loaded.
 *
 * - A row named `<variable>_<instance>` sets that variable on the node whose
 *   `data.name` is `<instance>`: its value and data_reference, and type 'constant'.
 * - A row named exactly like a variable of any node becomes a global constant
 *   (libraryStore.assignGlobalConstant).
 *
 * Node variables are updated in place (each node's `data.variables` is
 * replaced with updated copies). A variable that is later fed through a
 * connection keeps its value here; generateFlattenedModel does not emit it
 * while it is connected.
 *
 * @param {Array} nodes  workspace nodes ({ data: { name, variables } })
 * @param {Iterable} rows  parsed parameter rows (see parseParametersFile)
 * @param {Object} libraryStore  the library store (for global constants)
 * @returns {{ localCount: number, globalCount: number, totalUpdated: number }}
 */
export function applyParametersToNodes(nodes, rows, libraryStore) {
  const entries = Array.from(rows)
  const variableCatalogue = new Set()
  const nodeMap = new Map(nodes.map((n) => [n.data.name, n]))
  let localCount = 0

  for (const [instance, node] of nodeMap) {
    for (const variable of node.data.variables) {
      variableCatalogue.add(variable.name.trim())
    }

    const instanceParameters = entries
      .filter((entry) => entry.variable_name.trimEnd().endsWith(instance))
      .map((entry) => ({
        ...entry,
        name: entry.variable_name.trimEnd().slice(0, -instance.length).replace(/_+$/, ''),
      }))

    const paramsByName = new Map(instanceParameters.map((p) => [p.name.trim(), p]))
    let updatedCount = 0
    node.data.variables = node.data.variables.map((variable) => {
      const match = paramsByName.get(variable.name.trim())
      if (!match) return variable
      updatedCount++

      const matchedUnit = match.units.trim()
      const currentUnit = variable.units.trim()

      if (matchedUnit !== currentUnit) {
        console.warn(`Unit mismatch for "${variable.name}": node has "${currentUnit}", parameter has "${matchedUnit}"`)
      }

      return {
        ...variable,
        value: match.value.trim(),
        data_reference: match.data_reference.trim(),
        type: 'constant',
      }
    })
    localCount += updatedCount
  }

  const globalConstants = entries
    .filter((entry) => variableCatalogue.has(entry.variable_name.trimEnd()))
    .map((entry) => ({
      ...entry,
      name: entry.variable_name.trimEnd(),
    }))

  globalConstants.forEach((p) => {
    libraryStore.assignGlobalConstant(p.name, p.value, p.units, p.data_reference)
  })

  const globalCount = globalConstants.length
  return { localCount, globalCount, totalUpdated: localCount + globalCount }
}
