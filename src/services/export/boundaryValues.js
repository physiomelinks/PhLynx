/**
 * Decides which boundary condition values the flattened model uses, as circulatory_autogen does. A boundary
 * condition's value is a fallback: it is used only when nothing else in its coupled group supplies one. Pure (no
 * libcellml), so the rule can be tested on its own.
 *
 * A coupled group is the variables that direct port couplings make equivalent. A group is supplied when one of its
 * variables is computed (by its own math, or by a generated sum, multiply or unit conversion component), else when
 * a constant row sets it. A value the group doesn't use is ignored on export. A Sum variable nothing is connected to
 * sums over nothing: it is 0. Couplings pair variables by position, each with its own multiport type (see
 * utils/multiport.js).
 */
import { AFFINE_UNIT_CONVERSIONS, VALUE_REQUIRED_TYPES } from '../../utils/constants'
import { isBlank } from '../../utils/variables'
import { variableTypes } from '../../utils/multiport'
import { portDisplayName } from '../../utils/portIdentity'

const keyOf = (nodeId, name) => `${nodeId}::${name}`
const isPlain = (type) => type === 'None' || type === 'True'
// Row types whose value export may emit.
const VALUE_TYPES = new Set([...VALUE_REQUIRED_TYPES, 'boundary_condition'])

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
 * Resolves which boundary condition rows initialise the flattened model, and which values it ignores.
 *
 * @param {Array} nodes - Workspace nodes with `data.name` and `data.variables` rows.
 * @param {Array} edges - Workspace edges with `data.couplings`.
 * @returns {{supplied: Map<string, Set<string>>, missing: Map<string, Set<string>>, conflicts: string[],
 *   emptySums: Map<string, Set<string>>, unsupplied: Set<string>, ignored: Map<string, Set<string>>,
 *   bcOnly: Array<{keys: string[], label: string}>, status: Map<string, Map<string, {state: string, from: string[]}>>}}
 *   Each map but `status` goes from node id to row names:
 *   - `supplied`: boundary conditions whose values to use; `missing`: those nothing supplies;
 *   - `emptySums`: Sum variables nothing is connected to, which are set to 0;
 *   - `ignored`: rows whose value export drops, because something else supplies the variable;
 *   - `conflicts`: groups given several different values; `unsupplied`: the `nodeId::name` of every boundary
 *     condition in a group nothing else supplies;
 *   - `bcOnly`: groups of boundary conditions coupled only to each other, which nothing computes;
 *   - `status`: node id to row name to where the row's variable gets its value, with `from` the `instance.name` labels
 *     of the variables involved. `connected`: a connection supplies it, from those variables; `shares`: the row
 *     supplies the variables it's coupled to; `own`: a boundary condition nothing is connected to uses its own value;
 *     `missing`: such a boundary condition has none; `bcOnly`: coupled only to other boundary conditions;
 *     `conflict`: in a group given different values. Rows coupled to nothing, other than boundary conditions, and empty
 *     sums have no status.
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
  // Each variable a generated component computes, to the variables it computes it from.
  const computedFrom = new Map()
  const compute = (key, fromKey) => {
    computed.add(key)
    if (!computedFrom.has(key)) computedFrom.set(key, new Set())
    computedFrom.get(key).add(fromKey)
  }

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
        if (sourceTypes[i] === 'Sum') compute(source.key, target.key)
        if (targetTypes[i] === 'Sum') compute(target.key, source.key)
        if (sourceTypes[i] === 'Multiply') compute(target.key, source.key)
        if (targetTypes[i] === 'Multiply') compute(source.key, target.key)
        if (!isPlain(sourceTypes[i]) || !isPlain(targetTypes[i])) continue

        source.units = rows.get(source.key)?.row.units
        target.units = rows.get(target.key)?.row.units
        const affineOutput = affineOutputKey(source, target)
        if (affineOutput) compute(affineOutput, affineOutput === source.key ? target.key : source.key)
        else join(source.key, target.key)
      }
    }
  }

  // Sum variables nothing is connected to; each sums over nothing, so is computed as 0.
  const emptySums = new Map()
  const addTo = (map, { nodeId, row }) => {
    if (!map.has(nodeId)) map.set(nodeId, new Set())
    map.get(nodeId).add(row.name)
  }
  for (const node of nodes) {
    for (const port of node.data?.ports ?? []) {
      let types
      try {
        types = variableTypes(port)
      } catch (error) {
        throw new Error(`"${node.data.name}" port "${portDisplayName(port)}": ${error.message}`)
      }
      types.forEach((type, i) => {
        const key = keyOf(node.id, port.variables[i])
        const member = rows.get(key)
        // A computed row's own math already sets it.
        if (type !== 'Sum' || computed.has(key) || !member || member.row.type === 'variable') return
        computed.add(key)
        addTo(emptySums, member)
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
  const ignored = new Map()
  const conflicts = []
  const unsupplied = new Set()
  const bcOnly = []
  const status = new Map()
  const nodeNames = new Map(nodes.map((node) => [node.id, node.data?.name ?? node.id]))
  const label = ({ nodeName, row }) => `${nodeName}.${row.name}`
  const labelOf = (key) => {
    const [nodeId, name] = key.split('::')
    return `${nodeNames.get(nodeId) ?? nodeId}.${name}`
  }
  const hasValue = ({ row }) => row.type === 'global_constant' || !isBlank(row.value)
  const ignoreValues = (members) =>
    members.filter((member) => VALUE_TYPES.has(member.row.type) && hasValue(member)).forEach((member) => addTo(ignored, member))
  const setStatus = ({ nodeId, row }, state, from = []) => {
    if (!status.has(nodeId)) status.set(nodeId, new Map())
    status.get(nodeId).set(row.name, { state, from })
  }

  for (const keys of groups.values()) {
    const members = keys.map((key) => ({ key, ...rows.get(key) }))
    const othersOf = (member, among = members) => among.filter((other) => other !== member).map(label)
    const shareWithOthers = (member) => {
      const others = othersOf(member)
      if (others.length) setStatus(member, 'shares', others)
    }

    // Something computes the group, so no value is used.
    const suppliers = members.filter(({ key, row }) => computed.has(key) || row.type === 'variable')
    if (suppliers.length) {
      ignoreValues(members)
      for (const member of members) {
        if (member.row.type === 'variable') shareWithOthers(member)
        else if (computedFrom.has(member.key)) setStatus(member, 'connected', [...computedFrom.get(member.key)].map(labelOf))
        // An empty sum is set to 0, which emptySums reports.
        else if (!computed.has(member.key)) setStatus(member, 'connected', othersOf(member, suppliers))
      }
      continue
    }

    const boundaries = members.filter(({ row }) => row.type === 'boundary_condition')
    const setters = members.filter(({ row }) => VALUE_REQUIRED_TYPES.has(row.type))
    setters.forEach(shareWithOthers)
    if (!boundaries.length) continue

    // A constant row sets the group.
    if (setters.length) {
      ignoreValues(boundaries)
      boundaries.forEach((member) => setStatus(member, 'connected', setters.map(label)))
      continue
    }

    boundaries.forEach(({ key }) => unsupplied.add(key))
    if (boundaries.length > 1) {
      bcOnly.push({ keys: boundaries.map(({ key }) => key), label: boundaries.map(label).join(', ') })
    }

    const withValues = boundaries.filter(hasValue)
    if (!withValues.length) {
      boundaries.forEach((member) => {
        addTo(missing, member)
        setStatus(member, boundaries.length > 1 ? 'bcOnly' : 'missing', othersOf(member))
      })
      continue
    }

    const distinct = new Set(withValues.map(({ row }) => String(row.value).trim()))
    if (distinct.size > 1) {
      conflicts.push(withValues.map((member) => `${label(member)}=${String(member.row.value).trim()}`).join(', '))
      boundaries.forEach((member) => setStatus(member, 'conflict', othersOf(member)))
      continue
    }

    // The group's variables are equivalent, so one initial value settles them all.
    addTo(supplied, withValues[0])
    ignoreValues(withValues.slice(1))
    boundaries.forEach((member) => setStatus(member, boundaries.length > 1 ? 'bcOnly' : 'own', othersOf(member)))
  }

  return { supplied, missing, conflicts, emptySums, unsupplied, ignored, bcOnly, status }
}
