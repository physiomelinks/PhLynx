/**
 * Plotted variables, stored in simulationSettingsStore.plotConfig as `{ groups, groupedSelections, selections }`.
 * Shared by SimSettingsDialog and the instance editor's Plot tab, so both save the same shape.
 */

/**
 * Builds a plot group id from its position.
 *
 * @param {number} index
 * @returns {string}
 */
export function makeGroupId(index) {
  return `plot-${index + 1}`
}

/**
 * Fills in group ids and names, starting with one "Plot 1" group when there are none. A plot that plots
 * against a variable rather than time keeps it as `xAxis` (see setPlotXAxis).
 *
 * @param {Array<{id?: string, name?: string, xAxis?: Object}>} [existingGroups]
 * @returns {Array<{id: string, name: string, xAxis?: Object}>}
 */
export function normaliseGroups(existingGroups) {
  if (!Array.isArray(existingGroups) || existingGroups.length === 0) {
    return [{ id: makeGroupId(0), name: 'Plot 1' }]
  }

  return existingGroups.map((group, index) => ({
    id: group.id || makeGroupId(index),
    name: group.name || `Plot ${index + 1}`,
    ...(group.xAxis && { xAxis: { ...group.xAxis } }),
  }))
}

/**
 * Builds a plotted-variable selection for a node's variable row.
 *
 * @param {Object} node - A workspace node with `data.name`.
 * @param {Object} row - One of the node's `data.variables` rows.
 * @param {string|null} groupId
 * @returns {Object} A `plotConfig.selections` entry.
 */
export function createPlotSelection(node, row, groupId) {
  return {
    key: `${node.id}::${row.name}`,
    nodeId: node.id,
    nodeName: node.data.name,
    variableName: row.name,
    units: row.units || '',
    type: row.type || 'variable',
    plot: true,
    groupId,
  }
}

/**
 * Builds a plot config from its groups and plotted selections. Selections whose group is missing are
 * kept ungrouped, after the grouped ones.
 *
 * @param {Array<{id: string, name: string}>} groups
 * @param {Array<Object>} selections - `plotConfig.selections` entries.
 * @returns {{groups: Array, groupedSelections: Array, selections: Array}}
 */
export function buildPlotConfig(groups, selections) {
  const groupIds = new Set(groups.map((group) => group.id))

  const groupedSelections = groups
    .map((group) => ({
      id: group.id,
      name: group.name,
      selections: selections.filter((selection) => selection.groupId === group.id),
    }))
    .filter((group) => group.selections.length > 0)

  const ungroupedSelections = selections
    .filter((selection) => !groupIds.has(selection.groupId))
    .map((selection) => ({ ...selection, groupId: null }))

  return {
    groups: groups.map((group) => ({ ...group })),
    groupedSelections,
    selections: [...groupedSelections.flatMap((group) => group.selections), ...ungroupedSelections],
  }
}

/**
 * Checks whether a node's row can be plotted: only variables the simulation computes.
 *
 * @param {Object} row
 * @returns {boolean}
 */
export function isPlottableRow(row) {
  return Boolean(row?.name) && (row.type || 'variable') === 'variable'
}

/**
 * Builds one row per plottable variable across the nodes, carrying any existing selection's group.
 *
 * @param {Array<Object>} nodes - Workspace nodes.
 * @param {Map<string, Object>} selectedByKey - Existing selections by key.
 * @returns {Array<Object>} Rows sorted by node name, then variable name.
 */
export function buildPlotVariableRows(nodes, selectedByKey) {
  const rows = []

  for (const node of nodes || []) {
    if (!node?.data?.name) continue
    for (const variable of node.data.variables || []) {
      if (!isPlottableRow(variable)) continue

      const key = `${node.id}::${variable.name}`
      const existing = selectedByKey.get(key)

      rows.push({
        key,
        nodeId: node.id,
        nodeName: node.data.name,
        variableName: variable.name,
        units: variable.units || '',
        type: variable.type || 'variable',
        plot: existing?.plot ?? false,
        groupId: existing?.groupId ?? null,
        selected: false,
      })
    }
  }

  return rows.sort((a, b) => {
    const nodeDiff = a.nodeName.localeCompare(b.nodeName)
    if (nodeDiff !== 0) return nodeDiff
    return a.variableName.localeCompare(b.variableName)
  })
}

/**
 * Gets the variables a node plots, with their groups.
 *
 * @param {Object} plotConfig
 * @param {string} nodeId
 * @returns {Array<{name: string, groupId: string|null}>}
 */
export function getNodePlotEntries(plotConfig, nodeId) {
  return (plotConfig?.selections || [])
    .filter((selection) => selection.nodeId === nodeId)
    .map((selection) => ({ name: selection.variableName, groupId: selection.groupId ?? null }))
}

/**
 * Gets the plot groups to use. A config without groups (as an imported archive gives) gets one per group
 * its selections use, so none of them is ungrouped.
 *
 * @param {Object} plotConfig
 * @returns {Array<{id: string, name: string}>}
 */
export function resolveGroups(plotConfig) {
  if (Array.isArray(plotConfig?.groups) && plotConfig.groups.length) return normaliseGroups(plotConfig.groups)
  const usedIds = [...new Set((plotConfig?.selections || []).map((selection) => selection.groupId).filter(Boolean))]
  return normaliseGroups(usedIds.map((id, index) => ({ id, name: `Plot ${index + 1}` })))
}

/**
 * Sets a config's selections, keeping each one's group as it is and regrouping `groupedSelections` to match.
 * Selections are put in plot order, as buildPlotConfig does, so whatever lists them follows the plots.
 *
 * @param {Object} plotConfig
 * @param {Array<{id: string, name: string}>} groups
 * @param {Array<Object>} unordered
 * @returns {{groups: Array, groupedSelections: Array, selections: Array}}
 */
function withSelections(plotConfig, groups, unordered) {
  const groupIds = new Set(groups.map((group) => group.id))
  const selections = [
    ...groups.flatMap((group) => unordered.filter((selection) => selection.groupId === group.id)),
    ...unordered.filter((selection) => !groupIds.has(selection.groupId)),
  ]
  return {
    ...plotConfig,
    groups: groups.map((group) => ({ ...group })),
    groupedSelections: groups
      .map((group) => ({
        id: group.id,
        name: group.name,
        selections: selections.filter((selection) => selection.groupId === group.id),
      }))
      .filter((group) => group.selections.length > 0),
    selections,
  }
}

/**
 * Gets one node's selections, ordered by key so two lists can be compared.
 *
 * @param {Object} plotConfig
 * @param {string} nodeId
 * @returns {Array<Object>}
 */
export function getNodeSelections(plotConfig, nodeId) {
  return (plotConfig?.selections || [])
    .filter((selection) => selection.nodeId === nodeId)
    .sort((a, b) => a.key.localeCompare(b.key))
}

/**
 * Replaces one node's selections, leaving every other node's as they are.
 *
 * @param {Object} plotConfig
 * @param {string} nodeId
 * @param {Array<Object>} nodeSelections
 * @returns {Object} The new plot config.
 */
export function replaceNodeSelections(plotConfig, nodeId, nodeSelections) {
  const otherSelections = (plotConfig?.selections || []).filter((selection) => selection.nodeId !== nodeId)
  return withSelections(plotConfig, resolveGroups(plotConfig), [...otherSelections, ...nodeSelections])
}

/**
 * Replaces the variables one node plots. An entry without a `groupId` key joins the first group; one
 * whose group no longer exists is kept ungrouped. Other nodes' selections are left as they are.
 *
 * @param {Object} plotConfig
 * @param {Object} node - The node as saved, with `data.name` and `data.variables`.
 * @param {Array<{name: string, groupId?: string|null}>} entries
 * @returns {Object} The new plot config, or `plotConfig` itself when nothing changed.
 */
export function setNodePlotVariables(plotConfig, node, entries) {
  const groups = resolveGroups(plotConfig)
  const groupIds = new Set(groups.map((group) => group.id))
  const rowsByName = new Map((node.data.variables || []).filter(isPlottableRow).map((row) => [row.name, row]))

  const nodeSelections = []
  const seen = new Set()
  for (const entry of entries) {
    const row = rowsByName.get(entry.name)
    if (!row || seen.has(entry.name)) continue
    seen.add(entry.name)

    const requested = 'groupId' in entry ? entry.groupId : groups[0].id
    nodeSelections.push(createPlotSelection(node, row, groupIds.has(requested) ? requested : null))
  }

  const sortedNew = [...nodeSelections].sort((a, b) => a.key.localeCompare(b.key))
  if (JSON.stringify(getNodeSelections(plotConfig, node.id)) === JSON.stringify(sortedNew)) return plotConfig

  return replaceNodeSelections(plotConfig, node.id, nodeSelections)
}

/**
 * Resolves selections against the current nodes: drops those whose node or variable is gone, and
 * takes node names and units from the nodes, since a rename elsewhere doesn't update them. Groups are
 * kept as they are, so an export makes the same plots.
 *
 * @param {Object} plotConfig
 * @param {Array<Object>} nodes - Workspace nodes.
 * @returns {Object} A plot config to export; not saved.
 */
export function resolvePlotConfig(plotConfig, nodes) {
  const nodesById = new Map((nodes || []).map((node) => [node.id, node]))
  const resolve = (reference) => {
    const node = nodesById.get(reference.nodeId)
    const row = node?.data?.variables?.find((variable) => variable.name === reference.variableName)
    return node?.data?.name && isPlottableRow(row) ? { node, row } : null
  }

  const selections = (plotConfig?.selections || []).flatMap((selection) => {
    const found = resolve(selection)
    return found ? [createPlotSelection(found.node, found.row, selection.groupId ?? null)] : []
  })
  // A plot against a variable that is gone plots against time.
  const groups = (plotConfig?.groups || []).map(({ xAxis, ...group }) => {
    const found = xAxis && resolve(xAxis)
    return found ? { ...group, xAxis: createPlotXAxis(found.node, found.row) } : group
  })

  return withSelections(plotConfig, groups, selections)
}

/**
 * Builds the reference to the variable a plot plots against, in place of time.
 *
 * @param {Object} node - A workspace node, or an inspection module's stand-in.
 * @param {Object} row
 * @returns {{key: string, nodeId: string, nodeName: string, variableName: string, units: string}}
 */
export function createPlotXAxis(node, row) {
  return { key: `${node.id}::${row.name}`, nodeId: node.id, nodeName: node.data.name, variableName: row.name, units: row.units || '' }
}

/**
 * Plots a plot against a variable from the same run, as a phase plot does, or against time again.
 *
 * @param {Object} plotConfig
 * @param {string} id
 * @param {Object|null} xAxis - From createPlotXAxis, or null for time.
 * @returns {Object}
 */
export function setPlotXAxis(plotConfig, id, xAxis) {
  const groups = resolveGroups(plotConfig)
  if (!groups.some((group) => group.id === id)) return plotConfig
  const nextGroups = groups.map(({ xAxis: previous, ...group }) => {
    if (group.id !== id) return previous ? { ...group, xAxis: previous } : group
    return xAxis ? { ...group, xAxis: { ...xAxis } } : group
  })
  return withSelections(plotConfig, nextGroups, plotConfig?.selections || [])
}

/**
 * Makes an id for a new plot that no other plot has, whatever was removed before.
 *
 * @returns {string}
 */
const newPlotId = () => `plot-${crypto.randomUUID()}`

/**
 * Adds an empty plot, named after the highest-numbered "Plot n" so far.
 *
 * @param {Object} plotConfig
 * @param {string} [name]
 * @returns {{plotConfig: Object, id: string}} The new config and the new plot's id.
 */
export function addPlot(plotConfig, name) {
  const groups = resolveGroups(plotConfig)
  const highest = Math.max(0, ...groups.map((group) => Number(/^Plot (\d+)$/.exec(group.name)?.[1] ?? 0)))
  const id = newPlotId()
  const nextGroups = [...groups, { id, name: name?.trim() || `Plot ${highest + 1}` }]
  return { plotConfig: withSelections(plotConfig, nextGroups, plotConfig?.selections || []), id }
}

/**
 * Renames a plot; a blank name leaves it as it is.
 *
 * @param {Object} plotConfig
 * @param {string} id
 * @param {string} name
 * @returns {Object}
 */
export function renamePlot(plotConfig, id, name) {
  if (!name?.trim()) return plotConfig
  const groups = resolveGroups(plotConfig).map((group) => (group.id === id ? { ...group, name: name.trim() } : group))
  return withSelections(plotConfig, groups, plotConfig?.selections || [])
}

/**
 * Removes a plot and the variables on it. The last plot stays, so there is always one to add to.
 *
 * @param {Object} plotConfig
 * @param {string} id
 * @returns {Object}
 */
export function removePlot(plotConfig, id) {
  const groups = resolveGroups(plotConfig)
  if (groups.length <= 1 || !groups.some((group) => group.id === id)) return plotConfig
  return withSelections(
    plotConfig,
    groups.filter((group) => group.id !== id),
    (plotConfig?.selections || []).filter((selection) => selection.groupId !== id)
  )
}

/**
 * Moves a plot up (negative) or down (positive) the list, stopping at either end.
 *
 * @param {Object} plotConfig
 * @param {string} id
 * @param {number} delta
 * @returns {Object}
 */
export function movePlot(plotConfig, id, delta) {
  const groups = resolveGroups(plotConfig)
  const from = groups.findIndex((group) => group.id === id)
  const to = Math.min(groups.length - 1, Math.max(0, from + delta))
  if (from < 0 || from === to) return plotConfig
  const nextGroups = [...groups]
  nextGroups.splice(to, 0, ...nextGroups.splice(from, 1))
  return withSelections(plotConfig, nextGroups, plotConfig?.selections || [])
}

/**
 * Plots a node's variable on a plot. A variable is on one plot at most, so one already plotted moves.
 *
 * @param {Object} plotConfig
 * @param {Object} node
 * @param {Object} row - One of the node's plottable rows.
 * @param {string} groupId
 * @returns {Object}
 */
export function addPlotSelection(plotConfig, node, row, groupId) {
  const groups = resolveGroups(plotConfig)
  const target = groups.some((group) => group.id === groupId) ? groupId : groups[0].id
  const selection = createPlotSelection(node, row, target)
  const selections = plotConfig?.selections || []
  const index = selections.findIndex((existing) => existing.key === selection.key)
  const next = index < 0 ? [...selections, selection] : selections.map((existing, i) => (i === index ? selection : existing))
  return withSelections(plotConfig, groups, next)
}

/**
 * Stops plotting a variable.
 *
 * @param {Object} plotConfig
 * @param {string} key - The selection's `nodeId::name`.
 * @returns {Object}
 */
export function removePlotSelection(plotConfig, key) {
  const selections = plotConfig?.selections || []
  if (!selections.some((selection) => selection.key === key)) return plotConfig
  return withSelections(
    plotConfig,
    resolveGroups(plotConfig),
    selections.filter((selection) => selection.key !== key)
  )
}

/**
 * Moves a plotted variable to another plot.
 *
 * @param {Object} plotConfig
 * @param {string} key
 * @param {string} groupId
 * @returns {Object}
 */
export function assignSelection(plotConfig, key, groupId) {
  const groups = resolveGroups(plotConfig)
  if (!groups.some((group) => group.id === groupId)) return plotConfig
  const selections = (plotConfig?.selections || []).map((selection) => (selection.key === key ? { ...selection, groupId } : selection))
  return withSelections(plotConfig, groups, selections)
}

/**
 * Gets the units a plot's variables are in. A plot has one y-axis, as in web OpenCOR, so it holds one
 * unit; plots from older workspaces may hold several.
 *
 * @param {Object} plotConfig
 * @param {string} groupId
 * @returns {Set<string>}
 */
export function getPlotUnits(plotConfig, groupId) {
  return new Set((plotConfig?.selections || []).filter((selection) => selection.groupId === groupId).map((selection) => selection.units || ''))
}

/**
 * Checks whether a variable in some units can go on a plot: one that is empty or holds only those units.
 *
 * @param {Object} plotConfig
 * @param {string} groupId
 * @param {string} units
 * @param {string} [ignoredKey] - A selection to leave out, such as the one being moved.
 * @returns {boolean}
 */
export function acceptsUnits(plotConfig, groupId, units, ignoredKey = null) {
  const others = (plotConfig?.selections || []).filter((selection) => selection.groupId === groupId && selection.key !== ignoredKey)
  return others.every((selection) => (selection.units || '') === (units || ''))
}

/**
 * Picks the plot for a variable in some units: the preferred plot when it accepts them, else the first
 * plot that does, else none.
 *
 * @param {Object} plotConfig
 * @param {string} units
 * @param {string|null} preferredId
 * @param {string} [ignoredKey]
 * @returns {string|null}
 */
export function choosePlotForUnits(plotConfig, units, preferredId, ignoredKey = null) {
  const groups = resolveGroups(plotConfig)
  if (groups.some((group) => group.id === preferredId) && acceptsUnits(plotConfig, preferredId, units, ignoredKey)) return preferredId
  return groups.find((group) => acceptsUnits(plotConfig, group.id, units, ignoredKey))?.id ?? null
}

/**
 * Plots a variable on the preferred plot, keeping one unit per plot: a variable in other units goes to
 * the first plot in its units, or to a new plot.
 *
 * @param {Object} plotConfig
 * @param {Object} node
 * @param {Object} row - One of the node's plottable rows.
 * @param {string|null} preferredId
 * @returns {{plotConfig: Object, plotId: string}} The new config and the plot the variable went on.
 */
export function plotVariable(plotConfig, node, row, preferredId) {
  let config = plotConfig
  let plotId = choosePlotForUnits(config, row.units || '', preferredId, `${node.id}::${row.name}`)
  if (!plotId) {
    const added = addPlot(config)
    config = added.plotConfig
    plotId = added.id
  }
  return { plotConfig: addPlotSelection(config, node, row, plotId), plotId }
}
