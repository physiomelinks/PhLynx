/**
 * Maps the variables of a scope's instances to the names libOpenCOR reports their values under. It reports
 * each set of equivalent variables once, under one member: a coupled port variable can appear under the
 * module that computes it, a constant under instance_parameters, and the variable of integration under environment.
 */

import { sanitiseCellMLIdentifier } from '../../utils/cellml'

/**
 * Builds the key of a node's variable in a mapping.
 *
 * @param {string} nodeId
 * @param {string} variableName
 * @returns {string}
 */
export const mappingKey = (nodeId, variableName) => `${nodeId}::${variableName}`

/**
 * Finds the member of a variable's equivalence set that libOpenCOR reported.
 *
 * @param {Object} variable - A libcellml Variable.
 * @param {Set<string>} reportedNames - `component/variable` names in the run's results.
 * @param {Map<string, string|null>} known - Members already resolved, with what their set reports; filled
 *   in here, so each set is walked once.
 * @param {Array<Object>} handles - Collects the libcellml handles made, for freeing.
 * @returns {string|null}
 */
function findReportedMember(variable, reportedNames, known, handles) {
  const seen = new Set()
  const queue = [variable]
  let reported = null
  while (queue.length && !reported) {
    const current = queue.pop()
    const parent = current.parent()
    handles.push(parent)
    const name = `${parent.name()}/${current.name()}`
    if (seen.has(name)) continue
    seen.add(name)
    if (known.has(name)) reported = known.get(name)
    else if (reportedNames.has(name)) reported = name
    else {
      for (let i = 0; i < current.equivalentVariableCount(); i++) {
        const equivalent = current.equivalentVariable(i)
        handles.push(equivalent)
        queue.push(equivalent)
      }
    }
  }
  // A set left unfinished has more members, so only a complete walk may record that nothing was reported.
  if (reported || !queue.length) seen.forEach((name) => known.set(name, reported))
  return reported
}

/**
 * Maps each variable row of the scope's instances to the name its values are reported under.
 *
 * @param {Object} options
 * @param {Object} options.libcellml - The libcellml module (see whenLibCellMLReady).
 * @param {string} options.cellml - The flattened CellML model that was run.
 * @param {Array<Object>} options.nodes - The scope's nodes, named as they were when the model was built.
 * @param {{voi: {name: string}, variables: Map<string, Object>}} options.results - The engine's results.
 * @returns {Map<string, string>} Reported name by mappingKey(nodeId, variableName); rows the model doesn't
 *   have, or whose values weren't reported, are left out.
 */
export function buildVariableMapping({ libcellml, cellml, nodes, results }) {
  const reportedNames = new Set([results.voi.name, ...results.variables.keys()])
  const parser = new libcellml.Parser(false)
  const model = parser.parseModel(cellml)
  const handles = [parser, model]
  const mapping = new Map()
  const known = new Map()
  try {
    for (const node of nodes) {
      const component = model.componentByName(node.data.name, true)
      if (!component) continue
      handles.push(component)
      for (const row of node.data.variables ?? []) {
        const variable = component.variableByName(row.name)
        if (!variable) continue
        handles.push(variable)
        const reported = findReportedMember(variable, reportedNames, known, handles)
        if (reported) mapping.set(mappingKey(node.id, row.name), reported)
      }
    }
  } finally {
    handles.reverse().forEach((handle) => handle?.delete?.())
  }
  return mapping
}

/**
 * Reads a node variable's values from a run.
 *
 * @param {{voi: Object, variables: Map<string, Object>}} results - The engine's results.
 * @param {Map<string, string>} mapping - From buildVariableMapping.
 * @param {string} nodeId
 * @param {string} variableName
 * @returns {{name: string, kind: string, unit: string, values: Float64Array}|null} The series, named as
 *   reported; null when the run has none for it.
 */
export function readNodeSeries(results, mapping, nodeId, variableName) {
  const name = mapping.get(mappingKey(nodeId, variableName))
  if (!name) return null
  if (name === results.voi.name) return { name, kind: 'voi', unit: results.voi.unit, values: results.voi.values }
  const series = results.variables.get(name)
  return series ? { name, ...series } : null
}

/**
 * Finds the output of each inspection module in a run. createInspectionModuleComponent names a module's
 * output after the module and each of its terms `op_<variable>`, adding a suffix to a name already taken,
 * so the names are worked out in the same order.
 *
 * @param {Array<Object>} modules - The scope's inspection modules, as flattened.
 * @param {Array<Object>} nodes - The scope's nodes.
 * @param {{variables: Map<string, Object>}} results - The engine's results.
 * @returns {Array<{id: string, name: string, units: string, reportedName: string}>} The modules whose output
 *   the run reported.
 */
export function mapInspectionModules(modules, nodes, results) {
  const taken = new Set()
  const takeName = (base) => {
    let name = base
    for (let index = 1; taken.has(name); index++) name = `${base}_${index}`
    taken.add(name)
    return name
  }
  const nodesById = new Map(nodes.map((node) => [node.id, node]))
  const outputs = []
  for (const module of modules ?? []) {
    const name = takeName(sanitiseCellMLIdentifier(module.name))
    for (const entry of module.variables ?? []) {
      const node = nodesById.get(entry.nodeId)
      if (node?.data?.variables?.some((row) => row.name === entry.variableName)) takeName(`op_${entry.variableName}`)
    }
    const reportedName = `inspection_modules/${name}`
    if (results.variables.has(reportedName)) {
      outputs.push({ id: module.id, name: module.name, units: module.units || 'dimensionless', reportedName })
    }
  }
  return outputs
}
