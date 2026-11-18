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
 *
 * Only one thing may set a group: two computed variables, or two constants with different values, overdetermine it.
 * libCellML would reject such a model, or accept it as a DAE and drop one of the equations.
 *
 * A CellDL store's amount (a state of CellDL math) may instead be driven by what it is coupled to: a coupling marked
 * `drivesState` drops that instance's own equation and initial value for the state, so the connection sets it.
 */
import { AFFINE_UNIT_CONVERSIONS, VALUE_REQUIRED_TYPES } from '../../utils/constants'
import { cleanName } from '../../utils/identifiers'
import { isBlank, isNumericLiteral } from '../../utils/variables'
import { variableTypes } from '../../utils/multiport'
import { portDisplayName } from '../../utils/portIdentity'
import { resolveUnits, sameDimensions } from '../../utils/units'

const keyOf = (nodeId, name) => `${nodeId}::${name}`
// How a generated component computes a variable from its inputs, for messages.
const GENERATED = { sum: 'the sum of', multiply: 'scaled from', conversion: 'converted from' }
const isPlain = (type) => type === 'None' || type === 'True'
// Row types whose value export may emit.
const VALUE_TYPES = new Set([...VALUE_REQUIRED_TYPES, 'boundary_condition'])

// How close two numbers, relative to the larger, must be to count as one value: 0.14 M × 1000 isn't exactly 140 mM.
const RELATIVE_TOLERANCE = 1e-9
const listedNames = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0])

/**
 * Checks whether values given to equivalent variables agree. Numbers are compared as numbers, so 1 and 1.0 agree, and
 * values in different units are first converted to SI base units, so 140 mM and 0.14 M agree but 140 mM and 140 M
 * don't. Units that can't be resolved, or that measure different things, can't be compared, so the values don't
 * agree. A value that isn't a number agrees only with the same text in the same units, and a global constant only
 * with one of the same name.
 *
 * @param {Array<{value: *, units?: string, global?: string}>} entries
 * @param {Map<string, Array<Object>>} definitions - The library's units, as libraryStore.unitDefinitions.
 * @returns {{agree: boolean, mixedUnits: boolean, reason: string|null}} `mixedUnits` when the entries' units
 *   differ, so messages should show them; `reason` when the units are why the values can't be compared.
 */
export function compareValues(entries, definitions = new Map()) {
  const units = [...new Set(entries.map(({ units }) => cleanName(units)))]
  const mixedUnits = units.length > 1
  const result = (agree, reason = null) => ({ agree, mixedUnits, reason })

  if (entries.some(({ global }) => global)) return result(new Set(entries.map(({ global }) => global ?? '')).size === 1)
  const values = entries.map(({ value }) => String(value ?? '').trim())
  if (!values.every(isNumericLiteral)) {
    if (new Set(values).size > 1) return result(false)
    return mixedUnits ? result(false, `${listedNames(units.map((name) => name || 'no units'))} differ`) : result(true)
  }

  let numbers = values.map(Number)
  if (mixedUnits) {
    const cache = new Map()
    const expansions = entries.map(({ units }) => resolveUnits(cleanName(units), definitions, cache))
    const shown = listedNames(units.map((name) => name || 'no units'))
    if (expansions.some((expansion) => !expansion || expansion.affine)) return result(false, `${shown} can't be compared`)
    if (!expansions.every((expansion) => sameDimensions(expansion, expansions[0]))) {
      return result(false, `${shown} measure different things`)
    }
    numbers = numbers.map((number, i) => number * expansions[i].coefficient * 10 ** expansions[i].power)
  }
  const [first] = numbers
  const close = (number) => Math.abs(number - first) <= RELATIVE_TOLERANCE * Math.max(Math.abs(number), Math.abs(first))
  return result(numbers.every(close))
}

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
 * @param {(mathRef: string, node?: Object) => (Object|null)} [getMathAnalysis] - libraryStore.getNodeMathAnalysis, or getMathAnalysis. With it, a `variable`
 *   row counts towards `overdetermined` only when its math computes it, since a saved row may still call an input
 *   `variable` (see reconcileRows). Without it, or for math it can't analyse, every `variable` row counts.
 * @param {Object} [options]
 * @param {(mathRef: string) => boolean} [options.isCelldlMath] - Whether math is drawn in CellDL, so its states are
 *   stores a connection may drive. Without it, any state on a `drivesState` coupling is driven, and none is offered.
 * @param {Map<string, Array<Object>>} [options.unitDefinitions] - The library's units, so values coupled in different
 *   units can be compared (see compareValues). Without them, only CellML's built-in units are known.
 * @returns {{supplied: Map<string, Set<string>>, missing: Map<string, Set<string>>, conflicts: string[],
 *   emptySums: Map<string, Set<string>>, unsupplied: Set<string>, ignored: Map<string, Set<string>>,
 *   bcOnly: Array<{keys: string[], label: string}>, overdetermined: Array<{keys: string[], message: string}>,
 *   driven: Map<string, Map<string, {initialiser: string|null, from: string[]}>>,
 *   drivable: Array<{key: string, nodeId: string, name: string, label: string, from: string[]}>,
 *   status: Map<string, Map<string, {state: string, from: string[]}>>}}
 *   Each map but `status` goes from node id to row names:
 *   - `supplied`: boundary conditions whose values to use; `missing`: those nothing supplies;
 *   - `emptySums`: Sum variables nothing is connected to, which are set to 0;
 *   - `ignored`: rows whose value export drops, because something else supplies the variable;
 *   - `conflicts`: groups given several different values; `unsupplied`: the `nodeId::name` of every boundary
 *     condition in a group nothing else supplies;
 *   - `bcOnly`: groups of boundary conditions coupled only to each other, which nothing computes;
 *   - `overdetermined`: groups set more than once, by several computed variables or constants with different values,
 *     each with the keys of all its variables;
 *   - `driven`: node id to the CellDL states a `drivesState` coupling sets, each with its initial value's row, which
 *     is ignored, and what sets it. A flag is honoured only while something else computes the state's group;
 *   - `drivable`: CellDL states whose group only their own equation overdetermines, so driving them would settle it,
 *     each with what else sets it. Found only with `isCelldlMath`;
 *   - `status`: node id to row name to where the row's variable gets its value, with `from` the `instance.name` labels
 *     of the variables involved. `connected`: a connection supplies it, from those variables; `shares`: the row
 *     supplies the variables it's coupled to; `own`: a boundary condition nothing is connected to uses its own value;
 *     `missing`: such a boundary condition has none; `bcOnly`: coupled only to other boundary conditions;
 *     `conflict`: in a group given different values; `overdetermined`: in a group set more than once, with `from` what
 *     else sets it; `drivenInitial`: the initial value of a driven state, with `from` what sets the state. Rows coupled to nothing, other than boundary conditions, and empty
 *     sums have no status.
 */
export function resolveBoundaryValues(nodes, edges, getMathAnalysis = null, { isCelldlMath = null, unitDefinitions = new Map() } = {}) {
  const rows = new Map()
  const mathRefs = new Map(nodes.map((node) => [node.id, node.data?.mathRef]))
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
  // Each variable a generated component computes, to the variables it computes it from, and how.
  const computedFrom = new Map()
  const computedBy = new Map()
  // The equations generated components give each variable: one summation, even over nothing, but one per Multiply or
  // conversion.
  const equations = new Map()
  const rejected = new Set()
  const compute = (key, fromKey, kind) => {
    computed.add(key)
    if (!computedFrom.has(key)) computedFrom.set(key, new Set())
    computedFrom.get(key).add(fromKey)
    if (!computedBy.has(key)) computedBy.set(key, kind)
    if (!equations.has(key)) equations.set(key, new Set())
    equations.get(key).add(kind === 'sum' ? kind : `${kind}:${fromKey}`)
  }

  // A state a connection may drive: a CellDL store's amount, or any state when the math's format isn't known.
  const isDrivableRow = (key) => {
    const member = rows.get(key)
    if (member?.row.stateRole !== 'state' || member.row.type !== 'variable') return false
    return isCelldlMath ? !!isCelldlMath(mathRefs.get(member.nodeId)) : true
  }
  // States `drivesState` couplings mark, honoured below only where something else computes their group.
  const drivenCandidates = new Set()

  for (const edge of edges) {
    for (const { sourcePort, targetPort, drivesState } of edge.data?.couplings ?? []) {
      const sourceVariables = sourcePort?.variables ?? []
      const targetVariables = targetPort?.variables ?? []
      const sourceTypes = variableTypes(sourcePort ?? {})
      const targetTypes = variableTypes(targetPort ?? {})

      const count = Math.min(sourceTypes.length, targetTypes.length)
      for (let i = 0; i < count; i++) {
        if (!sourceVariables[i] || !targetVariables[i]) continue
        const source = { key: keyOf(edge.source, sourceVariables[i]) }
        const target = { key: keyOf(edge.target, targetVariables[i]) }
        // Export rejects a pair summed or multiplied on both ends (see couplingConflicts), and says so itself.
        if (sourceTypes[i] === targetTypes[i] && !isPlain(sourceTypes[i])) rejected.add(source.key).add(target.key)

        // A sum's result and a multiply's output are computed by generated components.
        if (sourceTypes[i] === 'Sum') compute(source.key, target.key, 'sum')
        if (targetTypes[i] === 'Sum') compute(target.key, source.key, 'sum')
        // A Multiply output feeding a Sum is one of its terms, not a second equation.
        if (sourceTypes[i] === 'Multiply' && targetTypes[i] !== 'Sum') compute(target.key, source.key, 'multiply')
        if (targetTypes[i] === 'Multiply' && sourceTypes[i] !== 'Sum') compute(source.key, target.key, 'multiply')
        if (!isPlain(sourceTypes[i]) || !isPlain(targetTypes[i])) continue

        source.units = rows.get(source.key)?.row.units
        target.units = rows.get(target.key)?.row.units
        const affineOutput = affineOutputKey(source, target)
        if (affineOutput) compute(affineOutput, affineOutput === source.key ? target.key : source.key, 'conversion')
        else join(source.key, target.key)
        if (drivesState) {
          const driven = drivenEnd(source.key, target.key, isDrivableRow)
          if (driven) drivenCandidates.add(driven)
        }
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
        equations.set(key, new Set(['sum']))
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
  const overdetermined = []
  const driven = new Map()
  const drivable = []
  // Driven states whose own equation is dropped.
  const drivenKeys = new Set()
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
  // What each node's math computes as a state or by assignment, or null when that isn't known.
  const mathComputed = new Map(
    nodes.map((node) => {
      const analysis = getMathAnalysis && node.data?.mathRef ? getMathAnalysis(node.data.mathRef, node) : null
      return [node.id, analysis ? new Set([...(analysis.stateVariables ?? []), ...(analysis.assigned ?? [])]) : null]
    })
  )
  /** Whether a member's own math sets it, unless a connection drives it. */
  const ownMath = ({ key, nodeId, row }) =>
    !drivenKeys.has(key) && row.type === 'variable' && (mathComputed.get(nodeId)?.has(row.name) ?? true)
  /** How many equations set a member: its own math's, and each generated component's. */
  const equationsOf = (member) => (equations.get(member.key)?.size ?? 0) + ownMath(member)
  const listed = listedNames
  /** Compares members' values as numbers, in a common unit where their units differ. */
  const compare = (members) =>
    compareValues(
      members.map(({ row }) => ({ value: row.value, units: row.units, global: row.type === 'global_constant' ? row.name : undefined })),
      unitDefinitions
    )
  /** Describes a member's value for a message, with its units when the values compared had different ones. */
  const describeValue = (member, { mixedUnits }) => {
    const value = String(member.row.value).trim()
    const units = mixedUnits && cleanName(member.row.units)
    return `${label(member)}=${value}${units ? ` ${units}` : ''}`
  }
  /** Describes how a computed member is set: by its own math, a generated component, or both. */
  const describeComputed = (member) => {
    const ways = []
    if (ownMath(member)) ways.push('its own math')
    if (computedBy.has(member.key)) {
      ways.push(`${GENERATED[computedBy.get(member.key)]} ${[...computedFrom.get(member.key)].map(labelOf).join(', ')}`)
    } else if (emptySums.get(member.nodeId)?.has(member.row.name)) {
      ways.push('a sum with nothing connected, so 0')
    }
    return ways.length > 1 || !ownMath(member) ? `${label(member)} (${ways.join(' and ')})` : label(member)
  }

  for (const keys of groups.values()) {
    const members = keys.map((key) => ({ key, ...rows.get(key) }))
    const othersOf = (member, among = members) => among.filter((other) => other !== member).map(label)
    /** Reports a group set more than once, marking each member that sets it. */
    const overdetermine = (setters, message) => {
      overdetermined.push({ keys, message })
      setters.forEach((member) => setStatus(member, 'overdetermined', othersOf(member, setters)))
    }

    // A driven state lets the rest of its group set it, so long as something there does.
    const drivenHere = members.filter(({ key }) => drivenCandidates.has(key))
    if (drivenHere.length) {
      const othersSet = members.some((member) => !drivenCandidates.has(member.key) && equationsOf(member) > 0)
      if (othersSet) drivenHere.forEach(({ key }) => drivenKeys.add(key))
    }
    const shareWithOthers = (member) => {
      const others = othersOf(member)
      if (others.length) setStatus(member, 'shares', others)
    }

    // Something computes the group, so no value is used.
    const suppliers = members.filter(({ key, row }) => !drivenKeys.has(key) && (computed.has(key) || row.type === 'variable'))
    if (suppliers.length) {
      ignoreValues(members)
      // A member its own math and generated components compute counts once for each.
      const setters = suppliers.filter((member) => equationsOf(member) > 0)
      const equationCount = setters.reduce((count, member) => count + equationsOf(member), 0)
      if (equationCount > 1 && !suppliers.some(({ key }) => rejected.has(key))) {
        const described = setters.map(describeComputed)
        const times = equationCount > 2 ? 'more than once' : 'twice'
        const verb = described.length === 1 ? `is computed ${times}` : `are ${described.length > 2 ? 'all' : 'both'} computed`
        // A CellDL store set only by its own equation may give way to the rest, which must then set it once.
        const stores = isCelldlMath
          ? setters.filter((member) => isDrivableRow(member.key) && equationsOf(member) === 1 && equationCount === 2)
          : []
        stores.forEach((member) =>
          drivable.push({ key: member.key, nodeId: member.nodeId, name: member.row.name, label: label(member), from: othersOf(member, setters) })
        )
        const hint = stores.length
          ? ` Confirming the connection can let it drive the store ${listed(stores.map(label))} instead.`
          : ''
        overdetermine(setters, `${listed(described)} ${verb}; only one module can set a connected variable.${hint}`)
        continue
      }
      for (const member of members) {
        if (drivenKeys.has(member.key)) {
          const from = othersOf(member, setters)
          setStatus(member, 'connected', from)
          if (!driven.has(member.nodeId)) driven.set(member.nodeId, new Map())
          driven.get(member.nodeId).set(member.row.name, { initialiser: member.row.initialiser ?? null, from })
        } else if (member.row.type === 'variable') shareWithOthers(member)
        else if (computedFrom.has(member.key)) setStatus(member, 'connected', [...computedFrom.get(member.key)].map(labelOf))
        // An empty sum is set to 0, which emptySums reports.
        else if (!computed.has(member.key)) setStatus(member, 'connected', othersOf(member, suppliers))
      }
      continue
    }

    const boundaries = members.filter(({ row }) => row.type === 'boundary_condition')
    const valued = members.filter((member) => VALUE_REQUIRED_TYPES.has(member.row.type) && hasValue(member))
    // Constants each initialise the group; as with boundary conditions, those agreeing on a value settle it once. A
    // global constant's value is the library's, so only one of the same name agrees with it.
    const valuedComparison = compare(valued)
    if (!valuedComparison.agree) {
      const described = valued.map((member) =>
        member.row.type === 'global_constant' ? `${label(member)} (global)` : describeValue(member, valuedComparison)
      )
      const why = valuedComparison.reason ? ` (${valuedComparison.reason})` : ''
      overdetermine(
        valued,
        `${listed(described)} are connected but set to different values${why}; give them one value, or let one module compute it.`
      )
      continue
    }
    const [kept, ...duplicates] = valued
    ignoreValues(duplicates)
    duplicates.forEach((member) => setStatus(member, 'connected', [label(kept)]))

    const setters = members.filter((member) => VALUE_REQUIRED_TYPES.has(member.row.type) && !duplicates.includes(member))
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

    const comparison = compare(withValues)
    if (!comparison.agree) {
      const why = comparison.reason ? ` (${comparison.reason})` : ''
      conflicts.push(withValues.map((member) => describeValue(member, comparison)).join(', ') + why)
      boundaries.forEach((member) => setStatus(member, 'conflict', othersOf(member)))
      continue
    }

    // The group's variables are equivalent, so one initial value settles them all.
    addTo(supplied, withValues[0])
    ignoreValues(withValues.slice(1))
    boundaries.forEach((member) => setStatus(member, boundaries.length > 1 ? 'bcOnly' : 'own', othersOf(member)))
  }

  // A driven state's initial value goes unused, unless a state the connection doesn't drive shares it.
  for (const [nodeId, states] of driven) {
    for (const [name, { initialiser, from }] of states) {
      const member = initialiser && rows.get(keyOf(nodeId, initialiser))
      if (!member) continue
      const sharedWithUndriven = [...rows.values()].some(
        (other) =>
          other.nodeId === nodeId &&
          other.row.stateRole === 'state' &&
          other.row.initialiser === initialiser &&
          !states.has(other.row.name)
      )
      if (sharedWithUndriven) {
        states.get(name).initialiser = null
        continue
      }
      if (hasValue(member)) addTo(ignored, member)
      setStatus(member, 'drivenInitial', from)
    }
  }

  return { supplied, missing, conflicts, emptySums, unsupplied, ignored, bcOnly, overdetermined, driven, drivable, status }
}

/**
 * Gets resolveBoundaryValues' options from the library: which math is drawn in CellDL, so its states are stores, and
 * the units values may be given in.
 *
 * @param {Object} [libraryStore] - With getMathSource and unitDefinitions; a store without them gives no options.
 * @returns {{isCelldlMath?: (mathRef: string) => boolean, unitDefinitions?: Map<string, Array<Object>>}}
 */
export function storeOptions(libraryStore) {
  const options = unitOptions(libraryStore)
  if (typeof libraryStore?.getMathSource === 'function') {
    options.isCelldlMath = (mathRef) => libraryStore.getMathSource(mathRef)?.format === 'celldl'
  }
  return options
}

/**
 * Gets just the library's units for resolveBoundaryValues, so values coupled in different units compare, for callers
 * that don't otherwise pass the library's options.
 *
 * @param {Object} [libraryStore] - With unitDefinitions; a store without them gives no options.
 * @returns {{unitDefinitions?: Map<string, Array<Object>>}}
 */
export function unitOptions(libraryStore) {
  return libraryStore?.unitDefinitions instanceof Map ? { unitDefinitions: libraryStore.unitDefinitions } : {}
}

/**
 * Picks which end of a plain coupled pair a `drivesState` coupling drives: the target's state if it is one, as the
 * connection runs from source to target, else the source's.
 *
 * @param {string} sourceKey
 * @param {string} targetKey
 * @param {(key: string) => boolean} isDrivable
 * @returns {string|null}
 */
export function drivenEnd(sourceKey, targetKey, isDrivable) {
  if (isDrivable(targetKey)) return targetKey
  if (isDrivable(sourceKey)) return sourceKey
  return null
}
