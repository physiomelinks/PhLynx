/**
 * Every variable in the workspace as an `instance/variable` path, for one search box across the whole model,
 * as web OpenCOR lists `component/variable`. Each entry says whether it can be plotted or given a slider.
 */
import { isPlottableRow } from './plotSelections'
import { isSlidableRow } from './parameterSliders'
import { mappingKey } from './variableMapping'

// The component global constants are flattened into, which names them in a path.
export const GLOBAL_COMPONENT = 'global_parameters'
// The component inspection modules' outputs are flattened into, likewise.
export const INSPECTION_COMPONENT = 'inspection_modules'
// A plotted inspection output stands in for a node by this id prefix and the module's id.
const INSPECTION_NODE_PREFIX = 'inspection:'

/**
 * Checks whether a plotted variable's node id stands for an inspection module.
 *
 * @param {string} nodeId
 * @returns {boolean}
 */
export const isInspectionNodeId = (nodeId) => typeof nodeId === 'string' && nodeId.startsWith(INSPECTION_NODE_PREFIX)

/**
 * Gets the id of the inspection module (and its output) a plotted variable's node id stands for.
 *
 * @param {string} nodeId
 * @returns {string|null} Null for an instance's node id.
 */
export const readInspectionOutputId = (nodeId) => (isInspectionNodeId(nodeId) ? nodeId.slice(INSPECTION_NODE_PREFIX.length) : null)

/**
 * Gets the inspection module a plotted variable's node id stands for.
 *
 * @param {string} nodeId
 * @param {Array<Object>} inspectionModules
 * @returns {Object|null}
 */
export const findInspectionModule = (nodeId, inspectionModules) =>
  isInspectionNodeId(nodeId) ? inspectionModules?.find((module) => module.id === nodeId.slice(INSPECTION_NODE_PREFIX.length)) ?? null : null

/**
 * Gets the node and row an inspection module's output is plotted as, standing in for an instance's.
 *
 * @param {Object} module - An inspection module.
 * @returns {{node: Object, row: Object}}
 */
export function inspectionPlotTarget(module) {
  const row = { name: module.name, units: module.units || '', type: 'variable' }
  return { node: { id: `${INSPECTION_NODE_PREFIX}${module.id}`, data: { name: INSPECTION_COMPONENT, variables: [row] } }, row }
}

/**
 * Gets the node and row an index entry plots: an instance's, or an inspection module's stand-in.
 *
 * @param {Object} entry - From buildVariableIndex.
 * @param {Array<Object>} nodes
 * @param {Array<Object>} [inspectionModules]
 * @returns {{node: Object, row: Object}|null}
 */
export function resolvePlotTarget(entry, nodes, inspectionModules = []) {
  const module = findInspectionModule(entry.nodeId, inspectionModules)
  if (module) return inspectionPlotTarget(module)
  const node = nodes.find((candidate) => candidate.id === entry.nodeId)
  const row = node?.data?.variables?.find((candidate) => candidate.name === entry.rowName)
  return node && row ? { node, row } : null
}

/**
 * Builds the index. A global constant is listed once, under GLOBAL_COMPONENT, however many instances use it.
 * Given a run's mapping, each entry also names the variables that are the same as it in the model.
 *
 * @param {Array<Object>} nodes - Workspace nodes.
 * @param {Object} [options]
 * @param {string[]|null} [options.scopeNodeIds] - The nodes the last run simulated, or null for all of them.
 * @param {Map<string, string>|null} [options.mapping] - `nodeId::name` to the name libOpenCOR reports.
 * @param {Array<Object>} [options.inspectionModules] - Listed as `inspection_modules/<name>`, to plot.
 * @param {Array<Object>|null} [options.inspectionOutputs] - The last run's, to say which it covered.
 * @returns {Array<{key: string, path: string, component: string, name: string, nodeId: string, rowName: string,
 *   kind: string, units: string, plottable: boolean, slidable: boolean, inScope: boolean, reportedName: string|null,
 *   equivalents: string[]}>}
 */
export function buildVariableIndex(nodes, { scopeNodeIds = null, mapping = null, inspectionModules = [], inspectionOutputs = null } = {}) {
  const inScope = (nodeId) => !scopeNodeIds || scopeNodeIds.includes(nodeId)
  const entries = []
  const globals = new Map()

  for (const node of nodes ?? []) {
    const component = node?.data?.name
    if (!component) continue
    for (const row of node.data.variables ?? []) {
      if (!row?.name) continue
      const key = mappingKey(node.id, row.name)
      if (row.type === 'global_constant') {
        // Listed once; the first instance using it stands for it, as a slider needs one.
        const existing = globals.get(row.name)
        if (existing) existing.inScope ||= inScope(node.id)
        else {
          globals.set(row.name, {
            key: `global::${row.name}`,
            path: `${GLOBAL_COMPONENT}/${row.name}`,
            component: GLOBAL_COMPONENT,
            name: row.name,
            nodeId: node.id,
            rowName: row.name,
            kind: row.type,
            units: row.units || '',
            plottable: false,
            slidable: isSlidableRow(row),
            inScope: inScope(node.id),
            reportedName: mapping?.get(key) ?? null,
            equivalents: [],
          })
        }
        continue
      }
      entries.push({
        key,
        path: `${component}/${row.name}`,
        component,
        name: row.name,
        nodeId: node.id,
        rowName: row.name,
        kind: row.type || 'variable',
        units: row.units || '',
        plottable: isPlottableRow(row),
        slidable: isSlidableRow(row),
        inScope: inScope(node.id),
        reportedName: mapping?.get(key) ?? null,
        equivalents: [],
      })
    }
  }

  // Inspection modules' outputs can be plotted like any variable, though no instance holds them.
  const inspections = (inspectionModules ?? []).map((module) => {
    const { node, row } = inspectionPlotTarget(module)
    return {
      key: `${node.id}::${row.name}`,
      path: `${INSPECTION_COMPONENT}/${module.name}`,
      component: INSPECTION_COMPONENT,
      name: module.name,
      nodeId: node.id,
      rowName: row.name,
      kind: 'inspection',
      units: row.units,
      plottable: true,
      slidable: false,
      inScope: !inspectionOutputs || inspectionOutputs.some((output) => output.id === module.id),
      reportedName: null,
      equivalents: [],
    }
  })

  const all = [...entries, ...globals.values(), ...inspections]
  // Variables the model makes one, as connections do, share the name libOpenCOR reports for them.
  const byReported = new Map()
  for (const entry of all) {
    if (!entry.reportedName) continue
    if (!byReported.has(entry.reportedName)) byReported.set(entry.reportedName, [])
    byReported.get(entry.reportedName).push(entry)
  }
  for (const group of byReported.values()) {
    if (group.length < 2) continue
    for (const entry of group) entry.equivalents = group.filter((other) => other !== entry).map((other) => other.path)
  }
  return all.sort((a, b) => a.path.localeCompare(b.path))
}

/**
 * Searches the index: every word of the query must appear in an entry's path, in any order ("na g" finds
 * `Na_channel/g_Na`). Exact variable names come first, then names starting with a word, then shorter paths.
 *
 * @param {ReturnType<typeof buildVariableIndex>} index
 * @param {string} query
 * @param {Object} [options]
 * @param {Function} [options.filter] - Keeps an entry, such as only plottable ones.
 * @param {number} [options.limit=200]
 * @returns {ReturnType<typeof buildVariableIndex>}
 */
export function searchVariableIndex(index, query, { filter = () => true, limit = 200 } = {}) {
  const words = (query ?? '').toLowerCase().split(/[\s/]+/).filter(Boolean)
  const scored = []
  for (const entry of index) {
    if (!filter(entry)) continue
    const path = entry.path.toLowerCase()
    if (!words.every((word) => path.includes(word))) continue
    const name = entry.name.toLowerCase()
    const rank = words.some((word) => name === word) ? 0 : words.some((word) => name.startsWith(word)) ? 1 : 2
    scored.push({ entry, rank })
  }
  scored.sort((a, b) => a.rank - b.rank || a.entry.path.length - b.entry.path.length || a.entry.path.localeCompare(b.entry.path))
  return scored.slice(0, limit).map(({ entry }) => entry)
}
