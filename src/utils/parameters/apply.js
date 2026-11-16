/**
 * Applies parsed parameter files to workspace nodes and global constants, and reports what an import did. Pure: each
 * function gives the changes for its caller to make.
 *
 * @typedef {import('./parse').Param} Param
 * @typedef {{nodeId: string, nodeName: string, name: string, from: string, to: string}} ValueChange
 * @typedef {{variablesById: Map<string, Array>, updated: number, changed: ValueChange[],
 *   skipped: Array<{nodeName: string, name: string}>, warnings: string[]}} NodeChanges - `updated` counts the values
 *   that change, listed in `changed`.
 * @typedef {{name: string, value: string, units: string, data_reference: string}} GlobalValue
 */
import { escapeHtml } from '../importBatch'
import { applyParameterValues } from '../parameters'
import { seedVariables } from './seed'
import { otherSetUsers } from './instanceSet'

/** Most names a report line lists. */
const MAX_LISTED = 5

/**
 * Gives a Param as `applyParameterValues` takes it, or undefined while it needs a value.
 *
 * @param {Param|undefined} param
 * @returns {{value: string, data_reference: string}|undefined}
 */
const valueOf = (param) => (param && param.value !== null ? param : undefined)

/**
 * Applies parameter values to one node's rows, warning where units differ.
 *
 * @param {Object} node
 * @param {Map<string, Param>} params
 * @param {NodeChanges} changes - Added to.
 */
function applyToNode(node, params, changes) {
  for (const row of node.data.variables) {
    const param = valueOf(params.get(row.name.trim()))
    if (param && param.units && row.units && param.units !== row.units.trim()) {
      changes.warnings.push(`${node.data.name}.${row.name.trim()} units ${param.units} ≠ ${row.units.trim()}`)
    }
  }
  const result = applyParameterValues(node.data.variables, (name) => valueOf(params.get(name)))
  if (result.updated || result.skipped.length) changes.variablesById.set(node.id, result.variables)
  node.data.variables.forEach((row, index) => {
    const from = String(row.value ?? '').trim()
    const to = result.variables[index].value
    if (to !== from) changes.changed.push({ nodeId: node.id, nodeName: node.data.name, name: row.name.trim(), from, to })
  })
  changes.updated = changes.changed.length
  changes.skipped.push(...result.skipped.map((name) => ({ nodeName: node.data.name, name })))
}

const noChanges = () => ({ variablesById: new Map(), updated: 0, changed: [], skipped: [], warnings: [] })

/**
 * @typedef {{mathRef: string, set: {ref: string, values: Map<string, Param>}, byName?: boolean}} SetTarget - A stored
 *   set, and whether it also goes to the instances named after it.
 * @typedef {{ref: string, mathRef: string, nodeId: string, nodeName: string, count: number}} SetUse - A set applied to
 *   an instance, with the number of values it changes there.
 */

/**
 * Plans applying stored sets to the instances of their math: those tagged with the set's ref and, for a target
 * `byName`, those whose name is the ref (`lumen_parameters.json` to the instance `lumen`), which are then tagged with
 * it. Sets apply in order, so where two reach one instance the later wins.
 *
 * @param {Array} nodes - Not changed.
 * @param {SetTarget[]} targets
 * @returns {NodeChanges & {nodeIds: string[], tags: Map<string, string>, uses: SetUse[]}} `tags` gives the ref each
 *   instance is to record where that changes; `uses` lists each set's instances.
 */
export function planSetsForNodes(nodes, targets) {
  const changes = noChanges()
  const uses = []
  const working = new Map(
    nodes.map((node) => [node.id, { variables: node.data.variables, parameterisation: node.data.parameterisation }])
  )
  for (const { mathRef, set, byName = false } of targets) {
    for (const node of nodes) {
      const state = working.get(node.id)
      const named = byName && String(node.data?.name ?? '').trim() === set.ref
      if (node.data?.mathRef !== mathRef || (!named && state.parameterisation !== set.ref)) continue
      const step = noChanges()
      applyToNode({ id: node.id, data: { ...node.data, variables: state.variables } }, set.values, step)
      if (step.variablesById.has(node.id)) state.variables = step.variablesById.get(node.id)
      state.parameterisation = set.ref
      changes.skipped.push(...step.skipped)
      changes.warnings.push(...step.warnings)
      uses.push({ ref: set.ref, mathRef, nodeId: node.id, nodeName: node.data.name, count: step.updated })
    }
  }

  const tags = new Map()
  for (const node of nodes) {
    const { variables, parameterisation } = working.get(node.id)
    if (parameterisation !== node.data.parameterisation) tags.set(node.id, parameterisation)
    if (variables === node.data.variables) continue
    changes.variablesById.set(node.id, variables)
    node.data.variables.forEach((row, index) => {
      const from = String(row.value ?? '').trim()
      const to = String(variables[index].value ?? '').trim()
      if (to !== from) changes.changed.push({ nodeId: node.id, nodeName: node.data.name, name: row.name.trim(), from, to })
    })
  }
  changes.updated = changes.changed.length
  const nodeIds = nodes.filter((node) => changes.variablesById.has(node.id) || tags.has(node.id)).map((node) => node.id)
  return { ...changes, nodeIds, tags, uses }
}

/**
 * Applies a model file's values to the nodes named by its instances.
 *
 * @param {Array} nodes - Not changed.
 * @param {Map<string, Map<string, Param>>} instances - By instance name.
 * @returns {NodeChanges & {nodeIds: string[], missing: string[]}} `missing` lists instances no node is named.
 */
export function applyInstancesToNodes(nodes, instances) {
  const changes = noChanges()
  const byName = new Map(nodes.map((node) => [node.data?.name, node]))
  const nodeIds = []
  const missing = []
  for (const [instance, params] of instances) {
    const node = byName.get(instance)
    if (!node) {
      missing.push(instance)
      continue
    }
    nodeIds.push(node.id)
    applyToNode(node, params, changes)
  }
  if (missing.length) changes.warnings.push(`no instance named ${listed(missing)} in the workspace`)
  return { ...changes, nodeIds, missing }
}

/**
 * Sorts a file's globals into those to add and those that would change a constant already set. Globals that need a
 * value, or that no workspace variable uses (when `usedNames` is given), are left out.
 *
 * @param {Map<string, Param>} globals
 * @param {(name: string) => ({value: string}|undefined)} getGlobalConstant
 * @param {Set<string>} [usedNames]
 * @returns {{added: GlobalValue[], changed: Array<GlobalValue & {from: string}>}}
 */
export function planGlobals(globals, getGlobalConstant, usedNames = null) {
  const added = []
  const changed = []
  for (const [name, param] of globals) {
    if (param.value === null || (usedNames && !usedNames.has(name))) continue
    const global = { name, value: param.value, units: param.units, data_reference: param.data_reference }
    const current = getGlobalConstant(name)
    if (!current) added.push(global)
    else if (String(current.value ?? '').trim() !== param.value) changed.push({ ...global, from: String(current.value ?? '') })
  }
  return { added, changed }
}

/**
 * Plans re-applying a set to an instance's rows: every value the set holds overwrites the row's, except that a global
 * constant already set keeps its shared value.
 *
 * @param {Array} rows - The instance's rows; not changed.
 * @param {{globals: Map<string, Param>, values: Map<string, Param>}} set
 * @returns {{rows: Array, changes: Array<{name: string, from: string, to: string}>}} The new rows, and the values they
 *   change.
 */
export function planSetApply(rows, set) {
  const seeded = seedVariables(rows, set)
  const changes = []
  const next = rows.map((row, index) => {
    const after = seeded[index]
    const from = String(row.value ?? '').trim()
    if (after === row || (row.type === 'global_constant' && from !== '')) return row
    if (after.value !== from) changes.push({ name: row.name.trim(), from, to: after.value })
    return after
  })
  return { rows: next, changes }
}

/**
 * Plans giving the other nodes tagged with a set the values a save writes into it. A global constant already set
 * keeps its shared value, which the save itself changes.
 *
 * @param {Array} nodes - Not changed.
 * @param {{nodeId: string, mathRef: string, paramRef: string}} target - The node saved, which is left out.
 * @param {{globals: Map<string, Param>, values: Map<string, Param>}} entries - The values written (changedSetEntries).
 * @returns {{variablesById: Map<string, Array>, changes: ValueChange[]}}
 */
export function planSharedSetUpdate(nodes, target, entries) {
  const variablesById = new Map()
  const changes = []
  for (const node of otherSetUsers(nodes, target)) {
    const planned = planSetApply(node.data.variables ?? [], entries)
    if (!planned.changes.length) continue
    variablesById.set(node.id, planned.rows)
    changes.push(...planned.changes.map((change) => ({ nodeId: node.id, nodeName: node.data.name, ...change })))
  }
  return { variablesById, changes }
}

/**
 * Gives the confirmation that lists the values re-applying a set changes, for `useConfirmDialog().confirm`.
 *
 * @param {string} paramRef
 * @param {Array<{name: string, from: string, to: string}>} changes - From `planSetApply`.
 * @returns {Object}
 */
export const setApplyConfirmation = (paramRef, changes) => ({
  header: 'Apply Parameter Set?',
  message: `Applying ${paramRef} changes ${changes.length} ${changes.length === 1 ? 'value' : 'values'}:`,
  issues: changes.map(({ name, from, to }) => ({ key: name, message: `${name}: ${from || '(blank)'} → ${to || '(blank)'}` })),
  acceptLabel: 'Apply',
  rejectLabel: 'Cancel',
})

/**
 * Lists names, at most five.
 *
 * @param {string[]} names
 * @returns {string}
 */
function listed(names) {
  const shown = names.slice(0, MAX_LISTED).join(', ')
  return names.length > MAX_LISTED ? `${shown} and ${names.length - MAX_LISTED} more` : shown
}

/**
 * Says a set's use on an instance: the instance, the set when it is named otherwise, and the values changed.
 *
 * @param {SetUse} use
 * @returns {string}
 */
const useLabel = ({ ref, nodeName, count }) =>
  `${nodeName}${nodeName === ref ? '' : ` from ${ref}`} (${count} value${count === 1 ? '' : 's'})`

/**
 * Says how many sets wait for the configs that link them to their math, and which.
 *
 * @param {string[]} refs
 * @returns {string}
 */
function waitingLine(refs) {
  const one = refs.length === 1
  return (
    `${refs.length} parameter set${one ? ' is' : 's are'} waiting for ${one ? 'its config' : 'their configs'}: ` +
    `${listed(refs)}. A set links to its math, and applies to the instance named after it, once a configuration ` +
    'naming it as its default_parameterisation is loaded.'
  )
}

/**
 * Builds one notification for a parameters import.
 *
 * @param {Array<{fileName: string, ok: boolean, count?: number, stored?: Array<{mathRef: string|null, ref: string,
 *   replaced: boolean}>, uses?: SetUse[], defaultOnly?: string[], kept?: string[], warnings?: string[],
 *   error?: string}>} results - One per file. `defaultOnly` lists the sets no instance took; `kept` those the user
 *   chose not to apply.
 * @param {Array<{mathRef: string, ref: string, warnings: string[]}>} [links] - Sets linked as configs arrived.
 * @param {{count?: number, uses?: SetUse[], defaultOnly?: string[], kept?: string[]}|null} [applied] - What applying
 *   the linked sets to their instances did.
 * @returns {{type: string, title: string, message: string, duration: number}|null} Null for no files.
 */
export function buildParametersReport(results, links = [], applied = null) {
  const lines = []
  const stored = results.flatMap((result) => result.stored ?? [])
  const linked = [...stored.filter((each) => each.mathRef), ...links]
  const unlinked = stored.filter((each) => !each.mathRef).map((each) => each.ref)
  const all = [...results, ...(applied ? [applied] : [])]
  const count = all.reduce((sum, result) => sum + (result.count ?? 0), 0)
  const uses = all.flatMap((result) => result.uses ?? []).filter((use) => use.count)
  const defaultOnly = [...new Set(all.flatMap((result) => result.defaultOnly ?? []))]
  const kept = [...new Set(all.flatMap((result) => result.kept ?? []))]

  if (linked.length) lines.push(`Parameter sets: ${listed(linked.map(({ mathRef, ref }) => `${ref} (${mathRef})`))}`)
  if (count) {
    const to = uses.length ? ` to ${listed(uses.map(useLabel))}` : ''
    lines.push(`Applied ${count} value${count === 1 ? '' : 's'}${to}.`)
  }
  if (defaultOnly.length) {
    lines.push(`Library defaults only, as no instance of their math is named after them: ${listed(defaultOnly)}.`)
  }
  if (kept.length) lines.push(`Instance values kept, as chosen; library defaults only: ${listed(kept)}.`)
  if (unlinked.length) lines.push(waitingLine(unlinked))

  const warnings = [
    ...results.flatMap(({ fileName, warnings = [] }) => warnings.map((warning) => `${fileName}: ${warning}`)),
    ...links.flatMap(({ ref, warnings = [] }) => warnings.map((warning) => `${ref}: ${warning}`)),
  ]
  const failed = results.filter((result) => result.error)
  for (const { fileName, error } of failed) lines.push(`${fileName}: ${error}`)
  lines.push(...warnings.slice(0, MAX_LISTED * 2))
  if (warnings.length > MAX_LISTED * 2) lines.push(`…and ${warnings.length - MAX_LISTED * 2} more warnings`)
  if (!lines.length) {
    const names = listed(results.map((result) => result.fileName))
    return names ? { type: 'info', title: 'Parameters Not Loaded', message: escapeHtml(`No new parameters were added from ${names}.`), duration: 3000 } : null
  }

  const anyOk = results.some((result) => result.ok)
  const type = !anyOk && failed.length ? 'error' : failed.length || warnings.length || unlinked.length ? 'warning' : 'success'
  // Sets linked by configs alone, with no parameter files read.
  const done = results.length ? 'Parameters Loaded' : 'Parameter Sets Linked'
  // Files all skipped or cancelled loaded nothing, though they failed no check.
  const notLoaded = type === 'error' || (results.length && !anyOk)
  // Sets read with nothing else to say but that they wait for their configs.
  const waiting = unlinked.length && !linked.length && !warnings.length && !failed.length && !count
  const title = notLoaded
    ? 'Parameters Not Loaded'
    : waiting
      ? 'Parameter Sets Waiting for Configs'
      : type === 'warning'
        ? `${done} with Warnings`
        : done
  return { type, title, message: lines.map(escapeHtml).join('<br>'), duration: type === 'success' ? 3000 : 8000 }
}
