/**
 * Decides which boundary condition values the flattened model uses. A boundary condition's value
 * is a fallback: it is used only when nothing else in its coupled group supplies one. Pure (no
 * libcellml), so the rule can be tested on its own.
 *
 * A coupled group is the variables that direct port couplings make equivalent. A group is already
 * supplied when one of its variables is computed (by its own math, or by a generated sum, multiply
 * or unit conversion component) or set by a constant row. Couplings pair variables by position, each
 * with its own multiport type (see utils/multiport.js).
 */
import { AFFINE_UNIT_CONVERSIONS, VALUE_REQUIRED_TYPES } from '../../utils/constants'
import { isBlank } from '../../utils/variables'
import { variableTypes } from '../../utils/multiport'

const keyOf = (nodeId, name) => `${nodeId}::${name}`
const isPlain = (type) => type === 'None' || type === 'True'

/**
 * Finds the variable an affine unit conversion computes between two coupled variables, mirroring
 * createAffineConversionComponent in utils/cellml.js.
 *
 * @param {{key: string, units: string}} source
 * @param {{key: string, units: string}} target
 * @returns {string|null|undefined} The computed key, null for a plain equivalence, or undefined
 *   when no conversion applies.
 */
function affineOutputKey(source, target) {
  const sourceConversion = AFFINE_UNIT_CONVERSIONS[source.units]
  const targetConversion = AFFINE_UNIT_CONVERSIONS[target.units]
  if (!sourceConversion && !targetConversion) return undefined
  if (sourceConversion && targetConversion) {
    const scale = sourceConversion.scale / targetConversion.scale
    const offset = (sourceConversion.offset - targetConversion.offset) / targetConversion.scale
    return scale === 1 && offset === 0 ? null : target.key
  }
  // The affine-unit side is derived from the base-unit side.
  return sourceConversion ? source.key : target.key
}

/**
 * Resolves which boundary condition rows initialise the flattened model.
 *
 * @param {Array} nodes - Workspace nodes with `data.name` and `data.variables` rows.
 * @param {Array} edges - Workspace edges with `data.couplings`.
 * @returns {{supplied: Map<string, Set<string>>, missing: Map<string, Set<string>>, conflicts: string[],
 *   emptySums: Map<string, Set<string>>}} `supplied` maps node id to the boundary condition names whose
 *   values to use, `missing` to those nothing supplies, and `emptySums` to the blank Sum variables
 *   nothing is connected to, which are set to 0; `conflicts` describes groups given several different values.
 */
export function resolveBoundaryValues(nodes, edges) {
  const rows = new Map()
  for (const node of nodes) {
    for (const row of node.data?.variables ?? []) {
      rows.set(keyOf(node.id, row.name), { nodeId: node.id, nodeName: node.data.name, row })
    }
  }

  const parent = new Map()
  const find = (key) => {
    if (!parent.has(key)) parent.set(key, key)
    let root = key
    while (parent.get(root) !== root) root = parent.get(root)
    parent.set(key, root)
    return root
  }
  const join = (a, b) => parent.set(find(a), find(b))
  const computed = new Set()

  for (const edge of edges) {
    for (const { sourcePort, targetPort } of edge.data?.couplings ?? []) {
      const sourceVariables = sourcePort?.variables ?? []
      const targetVariables = targetPort?.variables ?? []
      const sourceTypes = variableTypes(sourcePort ?? {})
      const targetTypes = variableTypes(targetPort ?? {})

      const count = Math.min(sourceTypes.length, targetTypes.length)
      for (let i = 0; i < count; i++) {
        if (!sourceVariables[i] || !targetVariables[i]) continue
        const source = { key: keyOf(edge.source, sourceVariables[i]) }
        const target = { key: keyOf(edge.target, targetVariables[i]) }

        // A sum's result and a multiply's output are computed by generated components.
        if (sourceTypes[i] === 'Sum') computed.add(source.key)
        if (targetTypes[i] === 'Sum') computed.add(target.key)
        if (sourceTypes[i] === 'Multiply') computed.add(target.key)
        if (targetTypes[i] === 'Multiply') computed.add(source.key)
        if (!isPlain(sourceTypes[i]) || !isPlain(targetTypes[i])) continue

        source.units = rows.get(source.key)?.row.units
        target.units = rows.get(target.key)?.row.units
        const affineOutput = affineOutputKey(source, target)
        if (affineOutput) computed.add(affineOutput)
        else join(source.key, target.key)
      }
    }
  }

  // Sum variables nothing is connected to; each sums over nothing.
  const unconnectedSums = new Set()
  for (const node of nodes) {
    for (const port of node.data?.ports ?? []) {
      let types
      try {
        types = variableTypes(port)
      } catch (error) {
        throw new Error(`"${node.data.name}" port "${port.label}": ${error.message}`)
      }
      types.forEach((type, i) => {
        const key = keyOf(node.id, port.variables[i])
        if (type === 'Sum' && !computed.has(key)) unconnectedSums.add(key)
      })
    }
  }

  const groups = new Map()
  for (const key of rows.keys()) {
    const root = find(key)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(key)
  }

  const supplied = new Map()
  const missing = new Map()
  const emptySums = new Map()
  const conflicts = []
  const addTo = (map, { nodeId, row }) => {
    if (!map.has(nodeId)) map.set(nodeId, new Set())
    map.get(nodeId).add(row.name)
  }

  for (const keys of groups.values()) {
    const members = keys.map((key) => ({ key, ...rows.get(key) }))
    const boundaries = members.filter(({ row }) => row.type === 'boundary_condition')
    if (!boundaries.length) continue

    const isSupplied = members.some(
      ({ key, row }) => computed.has(key) || row.type === 'variable' || VALUE_REQUIRED_TYPES.has(row.type)
    )
    if (isSupplied) continue

    const withValues = boundaries.filter(({ row }) => !isBlank(row.value))
    const label = ({ nodeName, row }) => `${nodeName}.${row.name}`
    if (!withValues.length) {
      // Nothing else supplies the group, so a Sum nothing is connected to sets it to 0.
      const emptySum = members.find(({ key }) => unconnectedSums.has(key))
      if (emptySum) addTo(emptySums, emptySum)
      else boundaries.forEach((member) => addTo(missing, member))
      continue
    }

    const distinct = new Set(withValues.map(({ row }) => String(row.value).trim()))
    if (distinct.size > 1) {
      conflicts.push(withValues.map((member) => `${label(member)}=${String(member.row.value).trim()}`).join(', '))
      continue
    }

    // The group's variables are equivalent, so one initial value settles them all.
    addTo(supplied, withValues[0])
  }

  return { supplied, missing, conflicts, emptySums }
}
