/**
 * Writes super-modules to circulatory_autogen (CA) natively (Mode B): one `module_format: "supermodule"` config entry
 * per super-module, and one record per root super instance, where CA can express them. Pure.
 *
 * The native module array is the flat (Mode A) one with each super instance's modules contracted back into it:
 * - A super-module's submodules are its children in submoduleOrder, by their local names, with sibling-only lists in
 *   the order the flat export gives them; a nested super instance is a record with its own per_submodule_* naming its
 *   siblings. Its children's values are its `default` parameterisation (`lv/E` rows); a nested super instance's
 *   overrides are rows below it (`soma/membrane/C`). CA has no local constants: a row bound to one is a row of its own,
 *   with the declared value, and an override of one is a row for each row bound to it.
 * - A root super instance is `{name, module_type, module_subtype, parameterisation, per_submodule_*}`, the hosts of each
 *   child in the flat lists' order, its keys in exposed-port order; its overrides are host rows (`heart/lv/E`).
 * - The layout (`phlynx_layout`) and exposed ports (`phlynx_interface`) are passthrough keys, which the import reads
 *   back (caFold.js). A super-module made from a CA library template, unchanged, keeps the template's own keys.
 *
 * The result is checked by expanding it as CA would (caSupermodules.js, PhLynx's '__' between levels): the same
 * modules, configs, pairs (as CA and the PhLynx import pair them) and values as the flat export. Where CA can't express
 * a super-module (no identity, an exposed port of a super instance inside, preserved names) or the check differs, it
 * is written flat with every super-module holding it, as is each of their super instances.
 */
import { CA_EMPTY_VALUE } from '../../utils/parameters'
import { isBlank } from '../../utils/variables'
import {
  indexByScope,
  isSuperInstance,
  isSupermoduleInterface,
  localIdOf,
  supermoduleDependencies,
  supermodulesById,
} from '../../utils/hierarchy'
import { instanceNames } from '../caRules'
import { isLocalConstantsKey, EXPANDED_ID_SEPARATOR } from '../hierarchy/expand'
import { asConstants, isLocalConstantRow, localConstantsOf } from '../hierarchy/localConstants'
import { indexExposures } from '../hierarchy/exposure'
import { LEVEL_SEPARATOR, PATH_SEPARATOR } from '../hierarchy/names'
import { supermoduleContentHash } from '../hierarchy/operations'
import { PHLYNX_INTERFACE_KEY, PHLYNX_LAYOUT_KEY, templateHash } from '../import/caFold'
import { normaliseModuleRecords } from '../import/caModuleArray'
import { moduleRefOf, supermoduleTemplate } from '../import/caModuleConfig'
import { CA_SEPARATOR, expandSupermodules, mergeDefaultParameters, SupermoduleExpansionError } from '../import/caSupermodules'
import { simulateCaPairing, simulateImportPairing } from './caSimulate'

/** The columns of a CA parameters file. */
export const PARAMETER_COLUMNS = ['variable_name', 'units', 'value', 'data_reference']
/** Where the export puts super-module configs, laid out as a CA module library (module_library_dirs). */
export const SUPERMODULES_DIR = 'supermodules'
/** The parameterisation a super-module's own values are written as. */
export const DEFAULT_PARAMETERISATION = 'default'
/** The subtype a new identity is offered with, its number raised past those taken. */
export const IDENTITY_SUBTYPE_BASE = 'phlynx_v'

// CA's names: no whitespace; PhLynx's also make directory names, and a subtype has no '__', which variants use.
const TYPE_PATTERN = /^[A-Za-z][A-Za-z0-9_]*$/
const SUBTYPE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_]*$/
// The keys a written super-module entry sets itself, so a template's aren't copied over them.
const OWN_KEYS = new Set([
  'moduleRef',
  'module_type',
  'module_subtype',
  'module_format',
  'default_parameterisation',
  'default_instance',
  'default_parameters',
  'submodules',
  'configFile',
])
// The port types through which a module receives (inputs) or gives (outputs), as expand.js splices them.
const INPUT_TYPES = new Set(['entrance_ports', 'general_ports'])
const OUTPUT_TYPES = new Set(['exit_ports', 'general_ports'])

const refOf = (identity) => moduleRefOf(identity.module_type, identity.module_subtype)
const keyOf = (path) => path.join(PATH_SEPARATOR)
const startsWith = (path, prefix) => prefix.every((name, i) => path[i] === name)

/**
 * @returns {string} The path of a parameterisation's parameters file, relative to its config's directory.
 */
export const parameterisationPath = (name) => `parameterisations/${name}/${name}_parameters.csv`

/**
 * @param {string} dir - The super-module's directory (see SUPERMODULES_DIR).
 * @param {{module_type: string, module_subtype: string}} entry
 * @returns {string} The path of a super-module's config file.
 */
export const supermoduleConfigPath = (dir, entry) => `${dir}/${entry.module_type}_${entry.module_subtype}_modules_config.json`

/**
 * The parameter rows of a module's constants and boundary conditions. CA needs a row for every boundary condition,
 * and uses it only while nothing is connected to it.
 *
 * @param {Array} variables - The module's rows.
 * @param {(variable: string) => string} nameOf - Each row's parameter name.
 * @returns {Array<{variable_name: string, units: string, value: string, data_reference: string}>}
 */
export function parameterRows(variables, nameOf) {
  return (variables ?? [])
    .filter((variable) => variable.type === 'constant' || variable.type === 'boundary_condition')
    .map((variable) => ({
      variable_name: nameOf(variable.name),
      units: variable.units || '',
      value: isBlank(variable.value) ? (variable.type === 'constant' ? '' : CA_EMPTY_VALUE) : variable.value,
      data_reference: variable.data_reference || 'phlynx',
    }))
}

/**
 * Makes the reader of super-modules' circulatory_autogen identities.
 *
 * A super-module has its own identity once named (`supermodule.ca`), and keeps it. One made from a CA library template
 * has the template's while it holds what it was made with (what it exposes aside, which CA doesn't hold), every one
 * nested in it does too, and the library's template is the one it was made from; changed, it needs one of its own.
 *
 * @param {Array} nodes - Every node in the store.
 * @param {Array} edges - Every edge in the store.
 * @param {Object} library - The library store (availableSupermodules).
 * @returns {(smId: string) => {identity: Object|null, needs: 'new'|'changed'|null, template: boolean, from?: string}}
 */
export function caIdentityReader(nodes, edges, library) {
  const supermodules = supermodulesById(nodes)
  const byScope = indexByScope(nodes)
  const templates = library?.availableSupermodules ?? new Map()
  const memo = new Map()
  const statusOf = (smId) => {
    if (memo.has(smId)) return memo.get(smId)
    memo.set(smId, { identity: null, needs: 'new', template: false })
    const { ca = null, source = null } = supermodules.get(smId)?.data?.supermodule ?? {}
    const identity = ca?.module_type && ca?.module_subtype ? { module_type: ca.module_type, module_subtype: ca.module_subtype } : null
    let status
    if (!identity) status = { identity: null, needs: 'new', template: false }
    else if (source?.format !== 'circulatory_autogen' || refOf(identity) !== source.moduleRef) status = { identity, needs: null, template: false }
    else {
      const replaced = templates.has(source.moduleRef) && !!source.hash && templateHash(source.moduleRef, templates) !== source.hash
      const own = source.caHash
        ? supermoduleContentHash(smId, nodes, edges, { exposure: false }) !== source.caHash
        : !!source.contentHash && supermoduleContentHash(smId, nodes, edges) !== source.contentHash
      const inner = (byScope.get(smId) ?? []).filter(isSuperInstance).some((node) => !statusOf(node.data.smId).template)
      status = source.fork || replaced || own || inner
        ? { identity: null, needs: 'changed', template: false, from: source.moduleRef }
        : { identity, needs: null, template: true }
    }
    memo.set(smId, status)
    return status
  }
  return statusOf
}

/**
 * The super-modules the root's super instances reach, each once, outer before inner.
 *
 * @param {Array} nodes
 * @returns {string[]}
 */
function reachedSupermodules(nodes) {
  const graph = supermoduleDependencies(nodes)
  const reached = []
  const visit = (smId) => {
    if (reached.includes(smId) || !graph.has(smId)) return
    reached.push(smId)
    graph.get(smId).forEach(visit)
  }
  nodes.filter((node) => isSuperInstance(node) && !node.data?.scope).forEach((node) => visit(node.data.smId))
  return reached
}

/**
 * Why an identity can't be a super-module's, or null when it can: CA's name rules, and no component, library
 * super-module or other super-module here has it.
 *
 * @param {{module_type: string, module_subtype: string}} identity
 * @param {Object} options
 * @param {string} options.smId - The super-module named.
 * @param {Object} options.library - The library store.
 * @param {Map<string, string>} [options.taken] - Each identity's ref other super-modules have, to their id.
 * @param {string} [options.from] - The library super-module's ref it was changed from, which can't name it.
 * @returns {string|null}
 */
export function caIdentityProblem({ module_type, module_subtype }, { smId, library, taken = new Map(), from = null }) {
  if (!TYPE_PATTERN.test(module_type ?? '')) return 'A module_type starts with a letter and has only letters, digits and "_".'
  if (!SUBTYPE_PATTERN.test(module_subtype ?? '') || module_subtype.includes('__')) {
    return 'A module_subtype has only letters, digits and single "_"s.'
  }
  const ref = moduleRefOf(module_type, module_subtype)
  if (library?.availableModules?.has(ref)) return `${ref} is a component module's.`
  if (library?.availableSupermodules?.has(ref) || ref === from) return `${ref} is a library super-module's; it can't name other content.`
  if (taken.has(ref) && taken.get(ref) !== smId) return `Another super-module here is ${ref}.`
  return null
}

/**
 * The super-modules a native export needs an identity for: each one the root reaches that has none, or that changed
 * from the CA template whose identity it has. Each comes with an identity to offer: its name and the first
 * `phlynx_v<n>` free.
 *
 * @param {Array} nodes
 * @param {Array} edges
 * @param {Object} library
 * @returns {Array<{smId: string, name: string, reason: 'new'|'changed', from?: string, suggestion: Object}>}
 */
export function caIdentityRequests(nodes, edges, library) {
  const statusOf = caIdentityReader(nodes, edges, library)
  const supermodules = supermodulesById(nodes)
  const taken = takenIdentities(nodes, edges, library)
  return reachedSupermodules(nodes)
    .filter((smId) => statusOf(smId).needs)
    .map((smId) => {
      const { needs, from } = statusOf(smId)
      const name = supermodules.get(smId).data.supermodule?.name ?? smId
      const module_type = TYPE_PATTERN.test(name) ? name : `sm_${name.replace(/[^A-Za-z0-9_]/g, '_')}`
      let n = 1
      while (caIdentityProblem({ module_type, module_subtype: `${IDENTITY_SUBTYPE_BASE}${n}` }, { smId, library, taken, from })) n++
      const suggestion = { module_type, module_subtype: `${IDENTITY_SUBTYPE_BASE}${n}` }
      taken.set(refOf(suggestion), smId)
      return { smId, name, reason: needs, ...(from && { from }), suggestion }
    })
}

/**
 * Why each identity asked for at once can't be its super-module's (see caIdentityProblem): each also can't be another
 * one's asked for with it.
 *
 * @param {Array<{smId: string, from?: string}>} requests - From caIdentityRequests.
 * @param {Map<string, {module_type: string, module_subtype: string}>} identities - The identities given, by smId.
 * @param {Object} options
 * @param {Object} options.library - The library store.
 * @param {Map<string, string>} options.taken - From takenIdentities.
 * @returns {Map<string, string|null>} Each request's problem, or null, by smId.
 */
export function caIdentityProblems(requests, identities, { library, taken }) {
  const givers = new Map()
  for (const { smId } of requests) {
    const identity = identities.get(smId)
    if (identity) givers.set(refOf(identity), [...(givers.get(refOf(identity)) ?? []), smId])
  }
  return new Map(
    requests.map(({ smId, from }) => {
      const identity = identities.get(smId) ?? {}
      const problem = caIdentityProblem(identity, { smId, library, taken, from })
      const shared = !problem && givers.get(refOf(identity))?.length > 1
      return [smId, shared ? `Another super-module here is ${refOf(identity)}.` : problem]
    })
  )
}

/**
 * The store's nodes with some super-modules given circulatory_autogen identities, the rest as they are: for an export
 * with identities not yet stored.
 *
 * @param {Array} nodes - Every node in the store.
 * @param {Map<string, {module_type: string, module_subtype: string}>|null} identities - By super-module id.
 * @returns {Array}
 */
export function withCaIdentities(nodes, identities) {
  if (!identities?.size) return nodes
  return nodes.map((node) =>
    isSupermoduleInterface(node) && identities.has(node.id)
      ? { ...node, data: { ...node.data, supermodule: { ...node.data.supermodule, ca: { ...identities.get(node.id) } } } }
      : node
  )
}

/**
 * The identities super-modules here have, to their ids.
 *
 * @returns {Map<string, string>}
 */
export function takenIdentities(nodes, edges, library) {
  const statusOf = caIdentityReader(nodes, edges, library)
  const taken = new Map()
  for (const node of nodes.filter(isSupermoduleInterface)) {
    const { identity } = statusOf(node.id)
    if (identity && !taken.has(refOf(identity))) taken.set(refOf(identity), node.id)
  }
  return taken
}

/**
 * Plans the native export of a workspace's super-modules.
 *
 * @param {Object} input
 * @param {Array} input.nodes - Every node in the store.
 * @param {Array} input.edges - Every edge in the store.
 * @param {Object} input.expansion - expandHierarchy's of them.
 * @param {Object} input.flat - export/ca.js buildFlatExport's of the expansion.
 * @param {Object} input.library - The library store.
 * @returns {{records: Object[]|null, parameterRows: Object[], supermodules: Array<{dir: string, entry: Object,
 *   rows: Object[]}>, fallbacks: Array<{smId: string, name: string, reason: string}>}|null} Null without super
 *   instances; `records` null when none is written natively. `parameterRows` the host file's rows (globals aside).
 */
export function planNativeExport({ nodes, edges, expansion, flat, library }) {
  const roots = nodes.filter((node) => isSuperInstance(node) && !node.data?.scope)
  if (!roots.length) return null
  const store = storeTree(nodes, edges)
  const statusOf = caIdentityReader(nodes, edges, library)
  const reached = reachedSupermodules(nodes)
  const dependencies = supermoduleDependencies(nodes)
  const reasons = new Map()
  const fail = (smId, reason) => !reasons.has(smId) && reasons.set(smId, reason)
  for (const smId of reached) {
    const reason = staticReason(smId, store, statusOf(smId), library, flat)
    if (reason) fail(smId, reason)
  }

  const rows = flat.rows.map((row) => {
    const path = (expansion.pathOf?.(row.id) ?? row.name).split(PATH_SEPARATOR)
    return { ...row, path, inp: instanceNames(row.inp_instances), out: instanceNames(row.out_instances) }
  })
  const context = { store, statusOf, flat, library, rows, rowByName: new Map(rows.map((row) => [row.name, row])), rowByPath: new Map(rows.map((row) => [keyOf(row.path), row])) }

  for (let round = 0; round <= reached.length; round++) {
    const flatDefs = closure(reasons, dependencies)
    const native = roots.filter((node) => !flatDefs.has(node.data.smId))
    const fallbacks = describeFallbacks(reached, flatDefs, reasons, store)
    if (!native.length) return { records: null, parameterRows: [], supermodules: [], fallbacks }
    const built = contract(native, context)
    if (built.problems.length) {
      built.problems.forEach(({ smId, reason }) => fail(smId, reason))
      continue
    }
    const mismatches = verify(built, native, context)
    if (mismatches.length) {
      mismatches.forEach(({ smId, reason }) => fail(smId, reason))
      continue
    }
    return { records: built.records, parameterRows: built.parameterRows, supermodules: built.supermodules, fallbacks }
  }
  return { records: null, parameterRows: [], supermodules: [], fallbacks: describeFallbacks(reached, closure(reasons, dependencies), reasons, store) }
}

/**
 * The store's super-modules as a tree: each one's children in expansion order, its interface and its exposed ports.
 *
 * @returns {{supermodules: Map, childrenOf: (smId: string) => Array, exposedOf: (smId: string) => Array,
 *   nameOf: (smId: string) => string}}
 */
function storeTree(nodes, edges) {
  const byScope = indexByScope(nodes)
  const supermodules = supermodulesById(nodes)
  const exposures = indexExposures(nodes, edges)
  const children = new Map()
  const childrenOf = (smId) => {
    if (!children.has(smId)) {
      const members = (byScope.get(smId) ?? []).filter((node) => !isSupermoduleInterface(node))
      const byLocalId = new Map(members.map((node) => [localIdOf(node), node]))
      const order = supermodules.get(smId)?.data?.supermodule?.submoduleOrder ?? []
      children.set(smId, [...new Set([...order.map((id) => byLocalId.get(id)).filter(Boolean), ...members])])
    }
    return children.get(smId)
  }
  return {
    supermodules,
    childrenOf,
    exposedOf: (smId) => exposures.get(smId) ?? [],
    nameOf: (smId) => supermodules.get(smId)?.data?.supermodule?.name ?? smId,
  }
}

/** Why CA can't hold a super-module as it is, before its module array is built, or null. */
function staticReason(smId, store, status, library, flat) {
  const definition = store.supermodules.get(smId)?.data?.supermodule ?? {}
  if (status.needs === 'changed') return `was changed from library super-module ${status.from} and has no circulatory_autogen identity of its own`
  if (status.needs) return 'has no circulatory_autogen identity'
  const ref = refOf(status.identity)
  if (!status.template && (library?.availableModules?.has(ref) || flat.moduleConfigs.has(ref))) return `has the identity ${ref}, which a component module has`
  if (!status.template && library?.availableSupermodules?.has(ref)) return `has the identity ${ref}, which a library super-module has`
  if (!store.childrenOf(smId).length) return 'is empty'
  if (definition.naming === 'preserve') return "keeps its children's own names, where CA prefixes them with the super instance's"
  if (store.exposedOf(smId).some((port) => port.alias?.via != null)) {
    return "exposes a port of a super instance inside it, which CA can only reach through that super instance's own per_submodule_* (it needs path addressing)"
  }
  return null
}

/** The super-modules written flat: those with a reason, and every one holding one of them. */
function closure(reasons, dependencies) {
  const flat = new Set(reasons.keys())
  for (let grew = true; grew; ) {
    grew = false
    for (const [smId, inner] of dependencies) {
      if (!flat.has(smId) && [...inner].some((id) => flat.has(id))) {
        flat.add(smId)
        grew = true
      }
    }
  }
  return flat
}

/** The super-modules the root reaches that are written flat, each with why. */
function describeFallbacks(reached, flatDefs, reasons, store) {
  return reached
    .filter((smId) => flatDefs.has(smId))
    .map((smId) => {
      const inner = [...flatDefs].find((id) => id !== smId && reasons.has(id) && holds(store, smId, id))
      const reason = reasons.get(smId) ?? (inner ? `holds super-module "${store.nameOf(inner)}", which is written flat` : 'holds a super-module written flat')
      return { smId, name: store.nameOf(smId), reason }
    })
}

/** Whether one super-module holds another, at any depth. */
function holds(store, outer, inner, seen = new Set()) {
  if (seen.has(outer)) return false
  seen.add(outer)
  return store.childrenOf(outer).some((child) => isSuperInstance(child) && (child.data.smId === inner || holds(store, child.data.smId, inner, seen)))
}

/**
 * Contracts the flat module array: each native root super instance's modules back into one record, and each
 * super-module they reach into a config entry.
 *
 * @returns {{records: Object[], parameterRows: Object[], supermodules: Array, entries: Map<string, Object>,
 *   problems: Array<{smId: string, reason: string}>}}
 */
function contract(native, context) {
  const { rows, flat } = context
  const nativeByName = new Map(native.map((node) => [node.data.name, node]))
  const state = { ...context, nativeByName, entries: new Map(), problems: [] }
  const records = []
  const parameterRows = []
  const emitted = new Set()
  const rootName = (name) => {
    const path = context.rowByName.get(name)?.path
    return path && path.length > 1 && nativeByName.has(path[0]) ? path[0] : name
  }
  const contractList = (names) => {
    const listed = new Set()
    return names.map(rootName).filter((name) => !nativeByName.has(name) || (!listed.has(name) && listed.add(name)))
  }
  for (const row of rows) {
    const top = row.path.length > 1 && nativeByName.get(row.path[0])
    if (top) {
      if (emitted.has(top.id)) continue
      emitted.add(top.id)
      const occurrence = contractOccurrence([top.data.name], top.data.smId, null, state)
      records.push(instanceRecord(top.data.name, context.statusOf(top.data.smId).identity, occurrence))
      parameterRows.push(...overrideRows(top, [top.data.name], state))
      continue
    }
    records.push({ name: row.name, module_type: row.module_type, module_subtype: row.module_subtype, inp_instances: contractList(row.inp), out_instances: contractList(row.out) })
    parameterRows.push(...(flat.parametersOf.get(row.id) ?? []))
  }
  const supermodules = [...state.entries.values()].map(({ entry, rows: defaults }) => ({
    dir: `${SUPERMODULES_DIR}/${entry.module_type}/versions/${entry.module_subtype}`,
    entry,
    rows: defaults,
  }))
  return { records, parameterRows, supermodules, entries: state.entries, problems: state.problems }
}

/**
 * An instance record of a super-module, in CA's record layout (dump_vessel_records): its own lists name the hosts that
 * are super instances too, which CA needs to link them; its parameterisation; its hosts as per_submodule_*.
 */
function instanceRecord(name, identity, { perIn, perOut, instanceHosts }) {
  const record = {
    name,
    module_type: identity.module_type,
    module_subtype: identity.module_subtype,
    inp_instances: instanceHosts.in,
    out_instances: instanceHosts.out,
    parameterisation: DEFAULT_PARAMETERISATION,
  }
  if (Object.keys(perIn).length) record.per_submodule_inputs = perIn
  if (Object.keys(perOut).length) record.per_submodule_outputs = perOut
  return record
}

/**
 * Contracts one occurrence of a super-module: its children's lists split into siblings and hosts, the hosts named as
 * they are where its super instance is. Adds its config entry the first time.
 *
 * @param {string[]} path - The occurrence's names from the root.
 * @param {string} smId
 * @param {string|null} parentSmId - The super-module it is inside, null at the root.
 * @param {Object} state
 * @returns {{perIn: Object, perOut: Object, instanceHosts: {in: string[], out: string[]}}}
 */
function contractOccurrence(path, smId, parentSmId, state) {
  const { store, rowByPath, nativeByName, statusOf, problems } = state
  const prefix = path.slice(0, -1)
  const where = `"${path.join(PATH_SEPARATOR)}"`
  const hostAt = (q) => {
    if (!startsWith(q, prefix) || q.length <= prefix.length) return null
    const name = q[prefix.length]
    // At the root, a module of a super instance written flat is a record of its own.
    if (!prefix.length && q.length > 1 && !nativeByName.has(name)) return rowByPath.get(keyOf(q))?.name ?? null
    return name
  }
  const pathOfName = (name) => state.rowByName.get(name)?.path ?? [name]
  const submodules = []
  const per = { in: new Map(), out: new Map() }
  for (const child of store.childrenOf(smId)) {
    const name = child.data.name
    const childPath = [...path, name]
    if (isSuperInstance(child)) {
      const inner = contractOccurrence(childPath, child.data.smId, smId, state)
      submodules.push(instanceRecord(name, statusOf(child.data.smId).identity, inner))
      continue
    }
    const row = rowByPath.get(keyOf(childPath))
    if (!row) {
      problems.push({ smId, reason: `has a module, "${name}", that isn't in ${where}'s flat export` })
      continue
    }
    const lists = { in: [], out: [] }
    for (const [dir, names] of [['in', row.inp], ['out', row.out]]) {
      const hosts = []
      for (const neighbour of names) {
        const q = pathOfName(neighbour)
        if (startsWith(q, path) && q.length > path.length) {
          if (!lists[dir].includes(q[path.length])) lists[dir].push(q[path.length])
          continue
        }
        const host = hostAt(q)
        if (host === null) {
          problems.push({ smId: parentSmId ?? smId, reason: `connects "${neighbour}" to "${childPath.join(PATH_SEPARATOR)}" inside a super instance in it, which CA's per_submodule_* can't name (it needs path addressing)` })
        } else if (hosts.includes(host)) {
          problems.push({ smId, reason: `couples "${host}" to "${name}" in ${where} more than once, which CA's per_submodule_* lists once` })
        } else hosts.push(host)
      }
      if (hosts.length) per[dir].set(name, hosts)
    }
    submodules.push({ name, module_type: row.module_type, module_subtype: row.module_subtype, inp_instances: lists.in, out_instances: lists.out })
  }

  addEntry(smId, submodules, where, state)
  const ranks = exposedRanks(smId, store)
  const order = store.childrenOf(smId).map((child) => child.data.name)
  const ordered = (map, rank) =>
    Object.fromEntries(
      [...map].sort(([a], [b]) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity) || order.indexOf(a) - order.indexOf(b))
    )
  const perIn = ordered(per.in, ranks.in)
  const perOut = ordered(per.out, ranks.out)
  // The hosts that are super instances where this one is, which list it back.
  const isInstance = (name) =>
    parentSmId ? store.childrenOf(parentSmId).some((node) => isSuperInstance(node) && node.data.name === name) : nativeByName.has(name)
  const hostsOf = (map) => [...new Set(Object.values(map).flat())].filter(isInstance)
  return { perIn, perOut, instanceHosts: { in: hostsOf(perIn), out: hostsOf(perOut) } }
}

/** Where each child's first exposed port facing in, and out, is among a super-module's exposed ports. */
function exposedRanks(smId, store) {
  const names = new Map(store.childrenOf(smId).map((child) => [localIdOf(child), child.data.name]))
  const ranks = { in: new Map(), out: new Map() }
  store.exposedOf(smId).forEach((port, index) => {
    const name = names.get(port.alias?.child)
    if (name === undefined) return
    if (INPUT_TYPES.has(port.alias.portType) && !ranks.in.has(name)) ranks.in.set(name, index)
    if (OUTPUT_TYPES.has(port.alias.portType) && !ranks.out.has(name)) ranks.out.set(name, index)
  })
  return ranks
}

/**
 * Adds a super-module's config entry and default rows the first time one of its occurrences is contracted; a later
 * one whose children's configs or siblings differ can't share it.
 */
function addEntry(smId, submodules, where, state) {
  const { entries, statusOf, store, library, problems } = state
  const identity = statusOf(smId).identity
  const ref = refOf(identity)
  const shape = (subs) => JSON.stringify(subs.map((sub) => ({ ...sub, inp_instances: [...(sub.inp_instances ?? [])].sort(), out_instances: [...(sub.out_instances ?? [])].sort() })))
  const existing = entries.get(ref)
  if (existing) {
    if (existing.smId !== smId) {
      if (existing.shape !== shape(submodules)) problems.push({ smId, reason: `has the identity ${ref} of super-module "${store.nameOf(existing.smId)}", which holds other content` })
    } else if (existing.shape !== shape(submodules)) {
      problems.push({ smId, reason: `is wired otherwise inside ${where} than inside "${existing.where}" (a module's config or its siblings differ), which one CA definition can't hold` })
    }
    return
  }
  const template = statusOf(smId).template ? library?.availableSupermodules?.get(ref) : null
  const extras = template ? Object.fromEntries(Object.entries(template).filter(([key]) => !OWN_KEYS.has(key) && !key.startsWith('phlynx_'))) : {}
  const interfaceNode = store.supermodules.get(smId)
  const children = store.childrenOf(smId)
  const nameOfLocal = new Map(children.map((child) => [localIdOf(child), child.data.name]))
  const point = (node) => ({ x: node?.position?.x ?? 0, y: node?.position?.y ?? 0 })
  const entry = {
    module_type: identity.module_type,
    module_subtype: identity.module_subtype,
    module_format: 'supermodule',
    default_parameterisation: DEFAULT_PARAMETERISATION,
    ...extras,
    submodules,
    [PHLYNX_LAYOUT_KEY]: {
      interface: point(interfaceNode),
      submodules: Object.fromEntries(children.map((child) => [child.data.name, point(child)])),
    },
    [PHLYNX_INTERFACE_KEY]: store.exposedOf(smId).map((port) => ({
      submodule: nameOfLocal.get(port.alias.child),
      ports: port.alias.portType,
      port_type: port.alias.label,
      slot: port.alias.slot ?? 0,
      name: port.label ?? port.alias.label,
    })),
  }
  entries.set(ref, { smId, where: where.slice(1, -1), shape: shape(submodules), entry, rows: definitionRows(smId, state) })
}

/**
 * A super-module's own values, as its parameterisation's rows: its modules' as `sub/var`, local constants with their
 * declared values, a super instance's overrides below it.
 */
function definitionRows(smId, state) {
  const declared = new Map(localConstantsOf(state.store.supermodules.get(smId)).map((declaration) => [declaration.name, declaration.value]))
  return state.store.childrenOf(smId).flatMap((child) =>
    isSuperInstance(child)
      ? overrideRows(child, [child.data.name], state)
      : rowsOf(asConstants(child.data.variables, (row) => declared.get(row.name)), [child.data.name])
  )
}

/** The parameter rows of a module's constants and boundary conditions, named by a path (see parameterRows). */
const rowsOf = (variables, path) => parameterRows(variables, (name) => [...path, name].join(PATH_SEPARATOR))

/** A super instance's overrides as rows named by path below it (`heart/lv/E`); those that set nothing are left out. */
function overrideRows(instance, path, state) {
  const rows = []
  for (const [key, patches] of Object.entries(instance.data?.overrides ?? {})) {
    if (isLocalConstantsKey(key)) {
      rows.push(...localConstantRows(instance, key, patches, path, state))
      continue
    }
    let smId = instance.data.smId
    let leaf = null
    const names = []
    for (const localId of key.split(EXPANDED_ID_SEPARATOR)) {
      const child = state.store.childrenOf(smId).find((node) => localIdOf(node) === localId)
      if (!child) break
      names.push(child.data.name)
      if (isSuperInstance(child)) smId = child.data.smId
      else leaf = child
    }
    if (!leaf || names.length !== key.split(EXPANDED_ID_SEPARATOR).length) continue
    const patched = (leaf.data.variables ?? []).filter((row) => patches?.[row.name]).map((row) => ({ ...row, ...patches[row.name] }))
    rows.push(...rowsOf(patched, [...path, ...names]))
  }
  return rows
}

/** A super instance's override of local constants as a row for each row bound to them (`heart/lv/E`). */
function localConstantRows(instance, key, patches, path, state) {
  let smId = instance.data.smId
  const names = []
  for (const localId of key.split(EXPANDED_ID_SEPARATOR).slice(0, -1)) {
    const child = state.store.childrenOf(smId).find((node) => localIdOf(node) === localId)
    if (!isSuperInstance(child)) return []
    names.push(child.data.name)
    smId = child.data.smId
  }
  const declared = new Set(localConstantsOf(state.store.supermodules.get(smId)).map((declaration) => declaration.name))
  return state.store.childrenOf(smId).flatMap((child) => {
    if (isSuperInstance(child)) return []
    const set = (child.data.variables ?? [])
      .filter((row) => isLocalConstantRow(row) && declared.has(row.name) && patches?.[row.name] && 'value' in patches[row.name])
      .map((row) => ({ ...row, type: 'constant', value: patches[row.name].value }))
    return rowsOf(set, [...path, ...names, child.data.name])
  })
}

/**
 * Checks the native module array by expanding it as CA would, against the flat export: its modules and configs, the
 * pairs CA and the PhLynx import give each connection, its values, and CA's own flat names.
 *
 * @returns {Array<{smId: string, reason: string}>} The super-modules to write flat, and why.
 */
function verify(built, native, context) {
  const { flat, rows, rowByName } = context
  const nativeByName = new Map(native.map((node) => [node.data.name, node]))
  const registry = new Map()
  const defaults = new Map()
  for (const { dir, entry, rows: values } of built.supermodules) {
    const template = supermoduleTemplate(entry, supermoduleConfigPath(dir, entry))
    registry.set(template.moduleRef, template)
    defaults.set(template.moduleRef, values)
  }
  const load = (entry, { parameterisation }) =>
    parameterisation === DEFAULT_PARAMETERISATION ? (defaults.get(moduleRefOf(entry.module_type, entry.module_subtype)) ?? null) : null
  let expanded = null
  const expandedPath = (name) => expanded?.paths.get(name) ?? rowByName.get(name)?.path
  const byRoot = new Map()
  const blame = (names, reason) => {
    const tops = [...new Set(names.map((name) => (expandedPath(name) ?? [name])[0]).filter((name) => nativeByName.has(name)))]
    for (const top of tops.length ? tops : [...nativeByName.keys()]) {
      const smId = nativeByName.get(top).data.smId
      if (!byRoot.has(smId)) byRoot.set(smId, reason(top))
    }
  }
  try {
    expanded = expandSupermodules(normaliseModuleRecords(built.records, 'export'), registry, { separator: LEVEL_SEPARATOR, load, settings: [] })
  } catch (error) {
    // One instance's problem blames its root super instance; any other, every one.
    const named = error instanceof SupermoduleExpansionError ? error.instance : null
    blame(named ? [named] : [], () => `would stop CA expanding it: ${error.message}`)
    return [...byRoot].map(([smId, reason]) => ({ smId, reason }))
  }

  // The same modules, each with the same config.
  const got = new Map(expanded.records.map((record) => [record.name, record]))
  const differing = [
    ...rows.filter((row) => !got.has(row.name) || got.get(row.name).module_subtype !== row.module_subtype || got.get(row.name).module_type !== row.module_type).map((row) => row.name),
    ...expanded.records.filter((record) => !rowByName.has(record.name)).map((record) => record.name),
  ]
  if (differing.length) blame(differing, (top) => `expands in CA to other modules than here (${listOf(differing.filter((name) => name.startsWith(`${top}${LEVEL_SEPARATOR}`) || name === top))})`)

  // CA's own flat names, joined with '_', are each one module's.
  const caNames = new Map()
  for (const record of expanded.records) {
    const caName = (expanded.paths.get(record.name) ?? [record.name]).join(CA_SEPARATOR)
    caNames.set(caName, [...(caNames.get(caName) ?? []), record.name])
  }
  const clashing = [...caNames.values()].filter((names) => names.length > 1).flat()
  if (clashing.length) blame(clashing, () => `gives modules CA names that clash with others' (${listOf(clashing)})`)

  if (!differing.length) {
    const wanted = pairing(rows.map((row) => ({ name: row.name, inp: row.inp, out: row.out })), context)
    const actual = pairing(expanded.records.map((record) => ({ name: record.name, inp: record.inp_instances, out: record.out_instances })), context)
    const changed = symmetricDifference(wanted, actual)
    if (changed.length) {
      const names = changed.flatMap((key) => key.split('\0').slice(1, 3))
      blame(names, (top) => `would have CA pair its connections otherwise than here (${listOf([...new Set(names.filter((name) => name === top || name.startsWith(`${top}${LEVEL_SEPARATOR}`)))])})`)
    }
  }

  // The values CA gives every parameter: the host file's, then the super-modules' parameterisations.
  const values = new Map(mergeDefaultParameters(built.parameterRows, expanded.parameterRows, { separator: LEVEL_SEPARATOR }).map((row) => [row.variable_name, row.value]))
  const otherValues = rows.filter((row) =>
    (flat.parametersOf.get(row.id) ?? []).some((parameter) => !sameValue(values.get(parameter.variable_name), parameter.value))
  )
  if (otherValues.length) blame(otherValues.map((row) => row.name), (top) => `would have CA give ${listOf(otherValues.map((row) => row.name).filter((name) => name.startsWith(`${top}${LEVEL_SEPARATOR}`)))} other values than here`)

  return [...byRoot].map(([smId, reason]) => ({ smId, reason }))
}

/**
 * The pairs CA and the PhLynx import give a module array's connections, and where they stop, as keys.
 *
 * @param {Array<{name: string, inp: string[], out: string[]}>} records
 * @returns {string[]} Sorted keys `kind\0source\0target\0detail`.
 */
function pairing(records, { flat, rowByName }) {
  const idOf = (name) => rowByName.get(name)?.id ?? name
  const nameOf = new Map(flat.rows.map((row) => [row.id, row.name]))
  const nodeById = new Map(flat.plan.rows.map((node) => [node.id, node]))
  const present = records.filter((record) => nodeById.has(idOf(record.name)))
  const array = {
    rows: present.map((record) => nodeById.get(idOf(record.name))),
    outEdges: new Map(present.map((record) => [idOf(record.name), record.out.map((target) => ({ source: idOf(record.name), target: idOf(target) }))])),
    inpEdges: new Map(present.map((record) => [idOf(record.name), record.inp.map((source) => ({ source: idOf(source), target: idOf(record.name) }))])),
    portsOf: (id) => flat.plan.ports.get(id) ?? [],
  }
  const key = (kind, edge, detail) => [kind, nameOf.get(edge.source) ?? edge.source, nameOf.get(edge.target) ?? edge.target, detail].join('\0')
  const ca = simulateCaPairing(array)
  const imported = simulateImportPairing(array)
  return [
    ...ca.pairs.map((pair) => key('ca', pair.edge, `${pair.source}>${pair.target}:${pair.rule ?? ''}`)),
    ...ca.errors.map((error) => key('caError', error.edge, error.kind)),
    ...imported.pairs.map((pair) => key('import', pair.edge, `${pair.source}>${pair.target}`)),
    ...imported.errors.map((error) => key('importError', error.edge, error.kind)),
  ].sort()
}

/** The keys in one sorted list but not the other, counting repeats. */
function symmetricDifference(a, b) {
  const counts = new Map()
  for (const key of a) counts.set(key, (counts.get(key) ?? 0) + 1)
  for (const key of b) counts.set(key, (counts.get(key) ?? 0) - 1)
  return [...counts].filter(([, count]) => count !== 0).map(([key]) => key)
}

const sameValue = (a, b) => {
  const [x, y] = [String(a ?? '').trim(), String(b ?? '').trim()]
  return x === y || (x !== '' && y !== '' && !Number.isNaN(Number(x)) && Number(x) === Number(y))
}

const listOf = (names) => {
  const unique = [...new Set(names)]
  return unique.length > 4 ? `${unique.slice(0, 4).join(', ')} and ${unique.length - 4} more` : unique.join(', ')
}
