/**
 * The CellML export with imports: the host model, one CellML 2.0 file per super-module, one per module definition and
 * one of units, zipped; a workspace without super-modules is the host, its modules' files and the units'. A super-module's file holds a wrapper component, named after it, encapsulating its children, each named by
 * its local name; a nested super instance imports its super-module's wrapper. The host imports a root super instance's
 * wrapper once per super instance, as a component named after it. Every module instance, at the root or in a
 * super-module, imports its definition's component from `modules/<component>.cellml`, which holds that component alone,
 * every variable public and no value of its own: values, a state's initialiser included (the state's initial_value
 * names it), come from outside. `units.cellml` defines every units the model uses, standard ones aside, and every other
 * file imports from it those it uses. The flat CellML export is unchanged, and remains what simulation runs.
 *
 * Built by spike A's rules (libcellml 0.7.1, libOpenCOR), so that flattening the host (flattenHierarchicalModel) gives
 * the flat export's model:
 * - Every wrapper variable is public_and_private. fixVariableInterfaces is never run on a file: it can't see the
 *   connections of what imports it.
 * - An exposed port's variable is the wrapper variable `<variable>_<child>`, `<inner>_<child>` through a nested super
 *   instance. The variable of integration (VoI) and the global constants pass down through every level by their own
 *   names.
 * - A Sum variable sums its terms at the level they are coupled at: an exposed one takes, as one wrapper variable, the
 *   sum its super instance's neighbours make outside (0 with none), so no two sources ever meet at a wrapper input. A
 *   Multiply is generated beside the module owning its factor, so an exposed one passes its product on.
 * - A value is set once, in the host: every value a super-module's children take (a constant's, a supplied boundary
 *   condition's, a local constant's, one per declaration) is a wrapper variable with no value, which the host sets
 *   for each super instance as `<variable>_<super instance>` in instance_parameters. Which values are set, and to what,
 *   is decided on the expanded model as the flat export decides it (planParameterValues). A global or local constant
 *   that a connection overrides in only some super instances is set by the host too, where nothing connects to it.
 * - A super-module's leaf whose role is 'self' (#364 import) is its wrapper: its own variables are the wrapper's.
 * - A module's file is its math as stored, which keeps no values (separateParameters): a state's initial_value names its
 *   initialiser variable. So every instance, whatever its values, imports the one file, and takes each value from the
 *   level it is in, the host's parameters at the root, its wrapper's variables in a super-module.
 * - A super-module whose naming is 'preserve' names its children, and its self leaf's wrapper, by their own names (their
 *   originalName), as the flat export does, so flattening gives the flat export's names and not `<instance>__<child>`.
 *
 * A super-module no super instance uses is not part of the model, so it is not written.
 */
import JSZip from 'jszip'

import { expandHierarchy } from '../hierarchy/expand'
import { indexExposures } from '../hierarchy/exposure'
import { LEVEL_SEPARATOR, SELF_ROLE } from '../hierarchy/names'
import { analyzeMathXml } from '../math/analyzeMath'
import {
  connectVariables,
  createMultiplyComponent,
  createSummationComponent,
  ensurePublicInterface,
  extractUnitsFromMath,
  handleLoggerErrors,
  isAffineUnit,
  isStandardUnit,
  nextAvailableComponentName,
  nextAvailableVarName,
  planParameterValues,
  sanitiseCellMLIdentifier,
  throwMissingValues,
  whenLibCellMLReady,
} from '../../utils/cellml'
import {
  AFFINE_UNIT_CONVERSIONS,
  PHLYNX_GLOBAL_PARAMETERS_COMPONENT_NAME,
  PHLYNX_INSTANCE_PARAMETERS_COMPONENT_NAME,
} from '../../utils/constants'
import { couplingConflicts, multiplyFactor, variableTypes } from '../../utils/multiport'
import {
  indexByScope,
  isModelEdge,
  isSuperInstance,
  isSupermoduleInterface,
  localIdOf,
  MAX_NESTING_DEPTH,
  supermodulesById,
} from '../../utils/hierarchy'
import { findVoiNames } from '../../utils/variables'

// Set by the exported builders, once libCellML is ready.
let libcellml = null

/** The role of a super-module's leaf that holds the super-module's own maths (#364): it is written as the wrapper. */
export { SELF_ROLE }

/** @returns {boolean} Whether a node is its super-module's self leaf. */
export const isSelfLeaf = (node) => node?.data?.role === SELF_ROLE

const CELLML_EXTENSION = '.cellml'
/** The zip folder module definitions' files are in. */
export const MODULES_FOLDER = 'modules/'
/** The file every units is defined in, at the zip's root. */
export const UNITS_FILE = 'units.cellml'
const SUM = 'sum'
const MULTIPLY = 'mul'

/**
 * Keys what a wrapper variable stands for at its super-module's level: a child's variable (`var`, through `path`, the
 * local ids down to its module, as `mode` takes it: '' as it is, 'sum' the sum made outside, `mul:<factor>` its
 * product), a local constant (`local`, of the super-module `path` leads to), a global constant, or the VoI.
 *
 * @param {{kind: 'var'|'local'|'global'|'voi', path?: string[], name?: string, mode?: string}} key
 * @returns {string}
 */
const keyOf = ({ kind, path = [], name = '', mode = '' }) => [kind, path.join('/'), name, mode].join('\0')

/** @returns {string} A mode of a port's i-th variable (see keyOf). */
const modeOf = (port, i) => {
  const type = variableTypes(port)[i]
  if (type === 'Sum') return SUM
  if (type === 'Multiply') return `${MULTIPLY}:${multiplyFactor(port, i)}`
  return ''
}

/** @returns {string} A name safe as a file name, from a super-module's name or identity. */
const safeFileBase = (name) => (name ?? '').trim().replace(/[^A-Za-z0-9_-]/g, '_') || 'supermodule'

/**
 * Builds the CellML with imports of a workspace.
 *
 * @param {Array} nodes - The store's nodes, super-modules unexpanded.
 * @param {Array} edges - The store's edges.
 * @param {Object} libraryStore - Gives availableMath, availableUnits, getMathAnalysis and getGlobalConstant.
 * @param {Object} [options]
 * @param {string} [options.name='model'] - The host's name; its file is `<name>.cellml`.
 * @param {boolean} [options.check=true] - Validates every file, and validates and analyses the flattened model,
 *   throwing on errors.
 * @param {boolean} [options.allowBcOnly=false] - As generateFlattenedModel's.
 * @returns {Promise<{host: string, files: Map<string, string>, preserved: string[], selfNamed: string[]}>} The host's
 *   file name, every file's CellML by file name, the host's first, the files of super-modules whose naming is
 *   'preserve', and those of them whose wrapper is a self leaf keeping its own name (see flattenHierarchicalModel).
 * @throws {Error} For what the flat export refuses, or a super-module that can't be expanded.
 */
export async function buildHierarchicalCellML(nodes, edges, libraryStore, { name = 'model', check = true, allowBcOnly = false } = {}) {
  libcellml = await whenLibCellMLReady()
  const expansion = expandHierarchy(nodes, edges)
  const problems = expansion.errors.filter((error) => error.severity === 'error')
  if (problems.length) throw new Error(problems.map((error) => error.message).join('\n'))

  const garbage = []
  const keep = (object) => (object && garbage.push(object), object)
  const parser = keep(new libcellml.Parser(false))
  try {
    const plan = planParameterValues(expansion.nodes, expansion.edges, libraryStore, { allowBcOnly })
    const graph = indexGraph(nodes, edges, expansion)
    const maths = mathReader(libraryStore, parser, keep)
    const levels = planLevels(graph, expansion, plan, maths)
    const files = writeLevels(levels, graph, maths, plan, libraryStore, { name, parser, keep })
    const preserved = levels.order.filter((level) => level.preserve).map((level) => level.fileName)
    const selfNamed = levels.order.filter((level) => level.selfName).map((level) => level.fileName)
    if (check) checkFiles(files, levels.host.fileName, { parser, keep, preserved, selfNamed })
    return { host: levels.host.fileName, files, preserved, selfNamed }
  } finally {
    garbage.reverse().forEach((object) => object.delete())
  }
}

/**
 * Builds the CellML with imports export's zip (see buildHierarchicalCellML).
 *
 * @param {string} fileName - The host's name.
 * @param {Array} nodes - The store's nodes.
 * @param {Array} edges - The store's edges.
 * @param {Object} libraryStore
 * @returns {Promise<Blob>}
 */
export async function generateHierarchicalCellMLZip(fileName, nodes, edges, libraryStore) {
  const { files } = await buildHierarchicalCellML(nodes, edges, libraryStore, { name: fileName })
  const zip = new JSZip()
  for (const [file, text] of files) zip.file(file, text)
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } })
}

/**
 * Flattens a hierarchical model, its units and components imports resolved, and names each child of a super instance `<super instance>__<child>` down the
 * definitions it imports, as the flat export names it (spike A rec 5), rather than libcellml's `_N`. A module's import
 * (from MODULES_FOLDER) is a leaf, not a wrapper; a child of a super-module whose naming is 'preserve' keeps its own
 * name, as does a super instance whose wrapper is such a super-module's self leaf.
 *
 * @param {Map<string, string>|Object<string, string>} files - Every file's CellML, by file name.
 * @param {string} host - The host's file name.
 * @param {Object} [options]
 * @param {string[]} [options.preserved=[]] - The files whose children keep their own names (buildHierarchicalCellML's).
 * @param {string[]} [options.selfNamed=[]] - The files whose wrappers keep their own names (buildHierarchicalCellML's).
 * @returns {Promise<{cellml: string, wrappers: string[]}>} The flattened CellML, and the names its wrappers now have.
 */
export async function flattenHierarchicalModel(files, host, { preserved = [], selfNamed = [] } = {}) {
  libcellml = await whenLibCellMLReady()
  return flattenFiles(files, host, { preserved, selfNamed })
}

/** Flattens a hierarchical model, libCellML ready (see flattenHierarchicalModel). */
function flattenFiles(files, host, { preserved = [], selfNamed = [] } = {}) {
  const texts = files instanceof Map ? files : new Map(Object.entries(files))
  const garbage = []
  const keep = (object) => (object && garbage.push(object), object)
  try {
    const parser = keep(new libcellml.Parser(false))
    const { model, flat } = resolveFile(texts, host, { parser, keep })

    const wrappers = []
    const isModule = (component) => keep(component.importSource()).url().startsWith(MODULES_FOLDER)
    const keepsNames = new Set(preserved)
    const keepsOwnName = new Set(selfNamed)
    const definitionOf = (component) => {
      const source = keep(component.importSource())
      const url = source.url()
      return { definition: keep(keep(source.model()).componentByName(component.importReference(), false)), preserve: keepsNames.has(url), self: keepsOwnName.has(url) }
    }
    // The flattened children are the definition's, in its order.
    const rename = (flattened, { definition, preserve }, prefix) => {
      for (let i = 0; i < definition.componentCount(); i++) {
        const child = keep(definition.componentByIndex(i))
        const copy = keep(flattened.componentByIndex(i))
        const inner = child.isImport() && !isModule(child) ? definitionOf(child) : null
        const name = preserve || inner?.self ? child.name() : `${prefix}${LEVEL_SEPARATOR}${child.name()}`
        copy.setName(name)
        if (inner) {
          wrappers.push(name)
          rename(copy, inner, name)
        } else if (child.componentCount()) rename(copy, { definition: child, preserve }, name)
      }
    }
    for (let i = 0; i < model.componentCount(); i++) {
      const component = keep(model.componentByIndex(i))
      if (!component.isImport() || isModule(component)) continue
      wrappers.push(component.name())
      rename(keep(flat.componentByName(component.name(), false)), definitionOf(component), component.name())
    }
    return { cellml: keep(new libcellml.Printer()).printModel(flat, false), wrappers }
  } finally {
    garbage.reverse().forEach((object) => object.delete())
  }
}

/** @returns {string} The folder a file is in, as a prefix: '' at the zip's root. */
const folderOf = (file) => file.slice(0, file.lastIndexOf('/') + 1)

/**
 * Resolves a file's imports from the zip's files, and flattens it.
 *
 * @returns {{model: Object, flat: Object}} The file's model, imports resolved, and its flattened copy.
 * @throws {Error} When it imports a file the zip lacks, or libcellml can't flatten it.
 */
function resolveFile(texts, file, { parser, keep }) {
  // libcellml looks an import up by its href joined to the importing file's folder, as it is: under both spellings.
  const parsed = new Map()
  const modelOf = (name) => (parsed.has(name) || parsed.set(name, keep(parser.parseModel(texts.get(name)))), parsed.get(name))
  const importer = keep(new libcellml.Importer(false))
  const added = new Set()
  for (const [name, text] of texts) {
    const folder = folderOf(name)
    for (const [, href] of text.matchAll(/xlink:href="([^"]+)"/g)) {
      const target = normalisePath(`${folder}${href}`)
      if (!texts.has(target)) continue
      for (const key of [`${folder}${href}`, `./${folder}${href}`]) {
        if (added.has(key)) continue
        added.add(key)
        importer.addModel(modelOf(target), key)
      }
    }
  }
  const model = keep(parser.parseModel(texts.get(file)))
  const folder = folderOf(file).slice(0, -1)
  importer.resolveImports(model, folder ? `./${folder}` : '.')
  if (model.hasUnresolvedImports()) throw new Error(`${file} imports a file the export does not include.`)
  const flat = keep(importer.flattenModel(model))
  if (!flat || importer.errorCount()) handleLoggerErrors(importer, `${file}: importer error count: ${importer.errorCount()}`)
  return { model, flat }
}

/** @returns {string} A relative path, its '.' and '..' segments resolved. */
export function normalisePath(path) {
  const parts = []
  for (const part of path.split('/')) {
    if (part === '..') parts.pop()
    else if (part && part !== '.') parts.push(part)
  }
  return parts.join('/')
}

/**
 * Indexes the store's graph and its expansion for the levels.
 *
 * @returns {Object}
 */
function indexGraph(nodes, edges, expansion) {
  const byScope = indexByScope(nodes)
  const supermodules = supermodulesById(nodes)
  const nodeById = new Map(nodes.map((node) => [node.id, node]))
  const childrenOf = (scope) => {
    const members = (byScope.get(scope) ?? []).filter((node) => !isSupermoduleInterface(node))
    const byLocalId = new Map(members.map((node) => [localIdOf(node), node]))
    const order = scope ? (supermodules.get(scope)?.data?.supermodule?.submoduleOrder ?? []) : []
    return [...new Set([...order.map((localId) => byLocalId.get(localId)).filter(Boolean), ...members])]
  }
  const chainKey = (chain) => chain.join('\0')
  // Each expanded node by where it comes from, and the expanded edges by the super instances they were drawn in.
  const expandedAt = new Map(expansion.nodes.map((node) => [originKey(expansion.origin.get(node.id)), node]))
  const edgesAt = new Map()
  for (const edge of expansion.edges) {
    if (!isModelEdge(edge)) continue
    const key = chainKey(expansion.origin.get(edge.id)?.instanceChain ?? [])
    if (!edgesAt.has(key)) edgesAt.set(key, [])
    edgesAt.get(key).push(edge)
  }
  return {
    nodeById,
    supermodules,
    exposures: indexExposures(nodes, edges),
    childrenOf,
    expandedAt: (chain, mainId) => expandedAt.get(originKey({ instanceChain: chain, mainId })),
    edgesAt: (chain) => edgesAt.get(chainKey(chain)) ?? [],
    origin: (id) => expansion.origin.get(id),
    nameOf: (id) => expansion.nameOf(id) ?? id,
  }
}

/** @returns {string} An origin's key. */
const originKey = ({ instanceChain, mainId }) => [...instanceChain, mainId].join('\0')

/**
 * Reads modules' maths: each as its own parsed component's variables, and its analysis.
 *
 * @returns {(mathRef: string) => {text: string, units: Map<string, string>, analysis: Object}}
 */
function mathReader(libraryStore, parser, keep) {
  const cache = new Map()
  return (mathRef) => {
    if (cache.has(mathRef)) return cache.get(mathRef)
    const text = libraryStore.availableMath.get(mathRef)
    if (!text) throw new Error(`Missing math definition for '${mathRef}'`)
    const component = keep(keep(parser.parseModel(text)).componentByIndex(0))
    if (!component) throw new Error(`The math definition for '${mathRef}' holds no component`)
    const units = new Map()
    for (let i = 0; i < component.variableCount(); i++) {
      const variable = keep(component.variableByIndex(i))
      units.set(variable.name(), keep(variable.units())?.name() ?? '')
    }
    const info = { text, units, componentName: component.name(), analysis: libraryStore.getMathAnalysis?.(mathRef) ?? analyzeMathXml(text) }
    cache.set(mathRef, info)
    return info
  }
}

/**
 * Plans every level: the host's and each used super-module's, with its children, the wrapper variables it needs and
 * the values the host sets. A super-module is planned from its first super instance; the others differ only in the
 * values the host sets and in what the host couples to them.
 *
 * @returns {{host: Object, definitions: Map<string, Object>, order: Object[], voi: {name: string, units: string}|null,
 *   hostValues: Array}} order: the super-modules, each after those it nests.
 */
function planLevels(graph, expansion, plan, maths) {
  const { nodeById, supermodules, childrenOf } = graph
  const definitions = new Map()
  const order = []
  const levelOf = (smId, chain) => {
    const children = childrenOf(smId)
    return {
      smId,
      chain,
      children,
      byLocalId: new Map(children.map((child) => [localIdOf(child), child])),
      keys: new Map(),
      vars: new Map(),
      globals: new Set(),
      needsVoi: false,
    }
  }
  const visit = (scope, chain) => {
    for (const child of childrenOf(scope)) {
      if (!isSuperInstance(child) || definitions.has(child.data.smId)) continue
      const inner = [...chain, child.id]
      definitions.set(child.data.smId, levelOf(child.data.smId, inner))
      visit(child.data.smId, inner)
      order.push(definitions.get(child.data.smId))
    }
  }
  const host = levelOf(null, [])
  visit(null, [])

  const definitionOf = (instance) => definitions.get(instance.data.smId)
  /** Adds a key a level's wrapper needs, and what it needs of the super-module its path goes through. */
  const request = (level, key) => {
    const id = keyOf(key)
    if (!level.keys.has(id)) level.keys.set(id, key)
    const through = key.kind === 'var' ? key.path.length > 1 : key.kind === 'local' && key.path.length > 0
    if (!through) return
    const child = level.byLocalId.get(key.path[0])
    if (isSuperInstance(child)) request(definitionOf(child), { ...key, path: key.path.slice(1) })
  }
  const localIds = (ids) => ids.map((id) => localIdOf(nodeById.get(id)))

  // Exposed ports, in their order.
  for (const level of order) {
    for (const exposed of graph.exposures.get(level.smId) ?? []) {
      const alias = resolveAlias(level, exposed, graph, definitions)
      if (!alias) continue
      alias.port.variables.forEach((name, i) => request(level, { kind: 'var', path: alias.path, name, mode: modeOf(alias.port, i) }))
    }
  }

  // A global or local constant that a connection overrides in only some of its module's occurrences (an exposed port's,
  // connected outside some super instances) can't be linked inside the definition: each occurrence keeping it takes it
  // from the host, through the variable itself (routed).
  const ignoredIn = new Set()
  for (const node of expansion.nodes) {
    const { mainId } = graph.origin(node.id)
    for (const name of maths(node.data.mathRef).units.keys()) {
      if (plan.parameterOf(node, name)?.kind === 'ignored') ignoredIn.add(`${mainId}\0${name}`)
    }
  }
  const routed = new Set()

  // Values: each module's in a super instance, as the flat export sets them, set by the host for its root super instance.
  const hostValues = new Map()
  const missing = []
  for (const node of expansion.nodes) {
    const { instanceChain, mainId } = graph.origin(node.id)
    const { units } = maths(node.data.mathRef)
    for (const name of units.keys()) {
      const parameter = plan.parameterOf(node, name)
      if (parameter?.kind === 'missing') missing.push(`${node.data.name}.${name}`)
      if (!instanceChain.length || !parameter) continue
      const level = definitions.get(nodeById.get(instanceChain.at(-1)).data.smId)
      const isConstant = parameter.kind === 'global' || parameter.kind === 'local'
      const local = { kind: 'local', path: localIds(instanceChain.slice(1)), name }
      const own = { kind: 'var', path: [...localIds(instanceChain.slice(1)), localIdOf(nodeById.get(mainId))], name, mode: '' }
      let key = parameter.kind === 'local' ? local : own
      let via = null
      if (isConstant && ignoredIn.has(`${mainId}\0${name}`)) {
        routed.add(`${mainId}\0${name}`)
        via = { kind: parameter.kind, key: local }
        key = own
      } else if (parameter.kind === 'global') level.globals.add(name)
      if (!via && parameter.kind !== 'instance' && parameter.kind !== 'local') continue
      const root = definitionOf(nodeById.get(instanceChain[0]))
      request(root, key)
      hostValues.set(`${instanceChain[0]}\0${keyOf(key)}`, { instanceId: instanceChain[0], key, parameter: parameter.parameter, via })
    }
  }
  throwMissingValues(missing)

  // What the edges drawn at each level couple to inside its super instances.
  for (const level of [host, ...order]) {
    for (const edge of graph.edgesAt(level.chain)) {
      for (const { sourcePort, targetPort } of edge.data?.couplings ?? []) {
        for (const [end, port] of [[edge.source, sourcePort], [edge.target, targetPort]]) {
          const { instanceChain, mainId } = graph.origin(end)
          if (instanceChain.length === level.chain.length) continue
          const instance = nodeById.get(instanceChain[level.chain.length])
          const path = [...localIds(instanceChain.slice(level.chain.length + 1)), localIdOf(nodeById.get(mainId))]
          port.variables.forEach((name, i) => name && request(definitionOf(instance), { kind: 'var', path, name, mode: modeOf(port, i) }))
        }
      }
    }
  }

  // The VoI, as the flat export's environment takes it: the first module with an ODE whose VoI it has.
  const voiOf = (node) => {
    const { analysis } = maths(node.data.mathRef)
    const names = findVoiNames(analysis)
    for (const row of node.data.variables ?? []) {
      if (row.type === 'global_constant' || row.localConstant || plan.isSetAsConstant(node.id, row)) names.delete(row.name)
    }
    return { names: [...names].filter((name) => maths(node.data.mathRef).units.has(name)), hasOde: analysis?.voi?.length > 0 }
  }
  let voi = null
  for (const node of expansion.nodes) {
    const { names, hasOde } = voiOf(node)
    if (!hasOde || !names.length) continue
    voi = { name: names[0], units: maths(node.data.mathRef).units.get(names[0]) }
    break
  }

  // What each level passes down, deepest first.
  for (const level of [...order, host]) {
    level.voiOf = new Map()
    for (const child of level.children) {
      if (isSuperInstance(child)) {
        const inner = definitionOf(child)
        level.needsVoi ||= inner.needsVoi
        inner.globals.forEach((global) => level.globals.add(global))
        continue
      }
      const expanded = graph.expandedAt(level.chain, child.id)
      const { names } = voiOf(expanded)
      level.voiOf.set(localIdOf(child), names)
      level.needsVoi ||= !!voi && names.length > 0
    }
  }

  // File names: a super-module's after its circulatory_autogen identity, else its name; unique, whatever their case.
  const taken = new Set()
  const fileNameOf = (base) => {
    let candidate = base
    for (let i = 1; taken.has(candidate.toLowerCase()); i++) candidate = `${base}_${i}`
    taken.add(candidate.toLowerCase())
    return `${candidate}${CELLML_EXTENSION}`
  }
  for (const level of order) {
    const { name, ca, naming } = supermodules.get(level.smId).data.supermodule
    level.name = name
    level.preserve = naming === 'preserve'
    level.fileBase = safeFileBase(ca?.module_type && ca?.module_subtype ? `${ca.module_type}_${ca.module_subtype}` : name)
  }
  return { host, definitions, order, voi, hostValues: [...hostValues.values()], routed, fileNameOf, reserve: (base) => taken.add(base.toLowerCase()) }
}

/**
 * Resolves an exposed port to the module port it aliases, through `via`, as the local ids from its super-module down.
 *
 * @returns {{path: string[], port: Object}|null}
 */
function resolveAlias(level, exposed, graph, definitions, depth = 0) {
  const child = level.byLocalId.get(exposed?.alias?.child)
  if (!child || depth > MAX_NESTING_DEPTH) return null
  if (isSuperInstance(child)) {
    const inner = definitions.get(child.data.smId)
    const via = (graph.exposures.get(child.data.smId) ?? []).find((port) => port.id === exposed.alias.via)
    const resolved = inner && via && resolveAlias(inner, via, graph, definitions, depth + 1)
    return resolved && { path: [exposed.alias.child, ...resolved.path], port: resolved.port }
  }
  const group = (child.data?.ports ?? []).filter((port) => port.portType === exposed.alias.portType && port.label === exposed.alias.label)
  const port = group[exposed.alias.slot ?? 0]
  return port ? { path: [exposed.alias.child], port } : null
}

/**
 * Writes every level's file: the super-modules deepest first, then the host.
 *
 * @returns {Map<string, string>} The host's first.
 */
function writeLevels(levels, graph, maths, plan, libraryStore, { name, parser, keep }) {
  const { order, host } = levels
  const hostBase = safeFileBase(name)
  levels.reserve(UNITS_FILE.slice(0, -CELLML_EXTENSION.length))
  host.fileName = levels.fileNameOf(hostBase)
  for (const level of order) level.fileName = levels.fileNameOf(level.fileBase)
  const units = unitsLibrary(libraryStore, parser, keep)
  const shared = sharedUnits(units, keep)
  levels.modules = planModules([host, ...order], maths)
  const written = new Map()
  for (const level of order) written.set(level.fileName, writeLevel(level, levels, graph, maths, plan, libraryStore, { units, shared, parser, keep }))
  const modules = new Map([...levels.modules].map(([mathRef, module]) => [module.fileName, writeModule(mathRef, module, maths, { units, shared, parser, keep })]))
  const hostText = writeLevel(host, levels, graph, maths, plan, libraryStore, { units, shared, parser, keep, modelName: hostBase })
  const files = new Map([[host.fileName, hostText], ...written, ...modules])
  if (shared.model.unitsCount()) files.set(UNITS_FILE, keep(new libcellml.Printer()).printModel(shared.model, false))
  return files
}

/** @returns {Object|undefined} A level's self leaf: a super-module's leaf whose role is 'self'. */
const selfOf = (level) => (level.smId === null ? undefined : level.children.find(isSelfLeaf))

/**
 * Names each module definition's file: `modules/<component>.cellml`, after the component its math defines. Components of
 * one name from different library files are each named after their library file too, in mathRef order.
 *
 * @param {Object[]} levels
 * @param {Function} maths
 * @returns {Map<string, {fileName: string, componentName: string}>} By mathRef, in order of first use.
 */
function planModules(levels, maths) {
  const mathRefs = []
  for (const level of levels) {
    const self = selfOf(level)
    for (const child of level.children) {
      if (child === self || isSuperInstance(child) || mathRefs.includes(child.data.mathRef)) continue
      mathRefs.push(child.data.mathRef)
    }
  }
  const baseOf = (mathRef) => safeFileBase(maths(mathRef).componentName)
  const counts = new Map()
  for (const mathRef of mathRefs) counts.set(baseOf(mathRef).toLowerCase(), (counts.get(baseOf(mathRef).toLowerCase()) ?? 0) + 1)
  const taken = new Set()
  const bases = new Map()
  for (const mathRef of [...mathRefs].sort()) {
    const library = mathRef.includes(':') ? mathRef.slice(0, mathRef.lastIndexOf(':')).replace(/\.cellml$/i, '') : ''
    const base = counts.get(baseOf(mathRef).toLowerCase()) > 1 && library ? `${baseOf(mathRef)}_${safeFileBase(library)}` : baseOf(mathRef)
    let candidate = base
    for (let i = 1; taken.has(candidate.toLowerCase()); i++) candidate = `${base}_${i}`
    taken.add(candidate.toLowerCase())
    bases.set(mathRef, candidate)
  }
  return new Map(mathRefs.map((mathRef) => [mathRef, { fileName: `${MODULES_FOLDER}${bases.get(mathRef)}${CELLML_EXTENSION}`, componentName: maths(mathRef).componentName }]))
}

/**
 * Writes a module definition's file: its component alone, as stored (without values), every variable public, importing
 * the units it uses.
 *
 * @returns {string} Its CellML.
 */
function writeModule(mathRef, { componentName, fileName }, maths, { shared, parser, keep }) {
  const model = keep(new libcellml.Model())
  model.setName(sanitiseCellMLIdentifier(componentName))
  const component = keep(keep(parser.parseModel(maths(mathRef).text)).componentByIndex(0))
  for (let i = 0; i < component.variableCount(); i++) keep(component.variableByIndex(i)).setInterfaceTypeByString('public')
  model.addComponent(component)
  importUnits(model, shared, fileName, keep)
  return keep(new libcellml.Printer()).printModel(model, false)
}

/**
 * Writes one level's file: a super-module's wrapper and children, or the host.
 *
 * @returns {string} Its CellML.
 */
function writeLevel(level, levels, graph, maths, plan, libraryStore, { units, shared, parser, keep, modelName }) {
  const lib = libcellml
  const isHost = level.smId === null
  const { definitions, voi } = levels
  const model = keep(new lib.Model())
  model.setName(sanitiseCellMLIdentifier(modelName ?? level.fileBase))

  const self = selfOf(level)
  const componentOf = new Map() // local id to the child's component
  const childNames = new Set()
  const nameChild = (base) => {
    let candidate = sanitiseCellMLIdentifier(base)
    for (let i = 1; childNames.has(candidate); i++) candidate = `${sanitiseCellMLIdentifier(base)}_${i}`
    childNames.add(candidate)
    return candidate
  }
  const leafComponent = (child) => keep(keep(parser.parseModel(maths(child.data.mathRef).text)).componentByIndex(0))
  /**
   * A child's component name: its local name, its own under 'preserve' naming, and, for a super instance whose
   * super-module preserves names and has a self leaf, that leaf's, as the flat export names it.
   */
  const componentNameOf = (child) => {
    const inner = isSuperInstance(child) ? definitions.get(child.data.smId) : null
    if (inner?.selfName) return inner.selfName
    return level.preserve ? (child.data.originalName ?? child.data.name) : child.data.name
  }

  // The wrapper: the self leaf's own component, or one of its own, named apart from the children.
  let wrapper = null
  if (!isHost) {
    const reserved = new Set(level.children.filter((child) => child !== self).map((child) => sanitiseCellMLIdentifier(componentNameOf(child))))
    wrapper = self ? leafComponent(self) : keep(new lib.Component())
    const base = sanitiseCellMLIdentifier(level.preserve && self ? (self.data.originalName ?? level.name) : level.name)
    let wrapperName = base
    for (let i = 1; reserved.has(wrapperName); i++) wrapperName = `${base}_${i}`
    if (level.preserve && self) level.selfName = wrapperName
    wrapper.setName(wrapperName)
    childNames.add(wrapperName)
    level.wrapperName = wrapperName
    model.addComponent(wrapper)
    if (self) componentOf.set(localIdOf(self), wrapper)
  }
  const container = wrapper ?? model

  // Children, each named by its local name (its own name at the root); a super instance imports its super-module's wrapper.
  const importSources = new Map()
  const importSourceOf = (url) => {
    if (!importSources.has(url)) {
      const source = keep(new lib.ImportSource())
      source.setUrl(url)
      importSources.set(url, source)
    }
    return importSources.get(url)
  }
  for (const child of level.children) {
    if (child === self) continue
    let component
    if (isSuperInstance(child)) {
      const inner = definitions.get(child.data.smId)
      component = keep(new lib.Component())
      component.setImportSource(importSourceOf(inner.fileName))
      component.setImportReference(inner.wrapperName)
      // Placeholders to connect to: the wrapper's variables.
      for (const { name, units: unitsName } of inner.vars.values()) {
        const placeholder = keep(new lib.Variable())
        placeholder.setName(name)
        if (unitsName) placeholder.setUnitsByName(unitsName)
        component.addVariable(placeholder)
      }
    } else {
      // A module imports its definition's component; placeholders to connect to: its variables, without values.
      const { fileName, componentName } = levels.modules.get(child.data.mathRef)
      component = keep(new lib.Component())
      component.setImportSource(importSourceOf(fileName))
      component.setImportReference(componentName)
      const leaf = leafComponent(child)
      for (let i = 0; i < leaf.variableCount(); i++) {
        const variable = keep(leaf.variableByIndex(i))
        const placeholder = keep(new lib.Variable())
        placeholder.setName(variable.name())
        placeholder.setUnitsByName(keep(variable.units())?.name() || 'dimensionless')
        component.addVariable(placeholder)
      }
    }
    component.setName(nameChild(componentNameOf(child)))
    container.addComponent(component)
    componentOf.set(localIdOf(child), component)
  }

  const variableOf = (component, name) => keep(component.variableByName(name))
  /** The variable a key reaches on a child: a module's own, or a super instance's wrapper variable. */
  const innerOf = (key) => {
    const [localId, ...rest] = key.path
    const child = level.byLocalId.get(localId)
    if (!isSuperInstance(child)) return { component: componentOf.get(localId), name: key.name, units: maths(child.data.mathRef).units.get(key.name) }
    const inner = definitions.get(child.data.smId).vars.get(keyOf({ ...key, path: rest }))
    return inner && { component: componentOf.get(localId), name: inner.name, units: inner.units }
  }

  // Wrapper variables, named in this order: the VoI, the global constants, then the keys. A self leaf's own variables
  // keep their names, and stand for themselves.
  if (!isHost) {
    const selfRows = new Map((self?.data?.variables ?? []).map((row) => [row.name, row]))
    const selfUnits = self ? maths(self.data.mathRef).units : new Map()
    const names = new Set(selfUnits.keys())
    const allocate = (base) => {
      let candidate = base
      for (let i = 1; names.has(candidate); i++) candidate = `${base}_${i}`
      names.add(candidate)
      return candidate
    }
    const add = (id, { name, units: unitsName, own = false }) => {
      if (!own) {
        const variable = keep(new lib.Variable())
        variable.setName(name)
        if (unitsName) variable.setUnitsByName(unitsName)
        wrapper.addVariable(variable)
      }
      level.vars.set(id, { name, units: unitsName })
    }
    const selfVoi = self && (level.voiOf.get(localIdOf(self)) ?? [])[0]
    if (level.needsVoi) add(keyOf({ kind: 'voi' }), selfVoi ? { name: selfVoi, units: selfUnits.get(selfVoi), own: true } : { name: allocate(voi.name), units: voi.units })
    for (const global of level.globals) {
      const own = selfRows.get(global)?.type === 'global_constant'
      add(keyOf({ kind: 'global', name: global }), own ? { name: global, units: selfUnits.get(global), own } : { name: allocate(global), units: libraryStore.getGlobalConstant(global)?.units ?? '' })
    }
    for (const [id, key] of level.keys) {
      const isSelf = !!self && key.path.length === 1 && key.path[0] === localIdOf(self)
      if (key.kind === 'local') {
        const declared = key.path.length ? innerOf(key) : null
        const units = declared?.units ?? localConstantUnits(graph, level, key.name)
        const own = !key.path.length && selfRows.get(key.name)?.type === 'local_constant'
        add(id, own ? { name: key.name, units: selfUnits.get(key.name), own } : { name: allocate(key.path.length ? `${declared.name}_${childNameOf(level, key.path[0])}` : key.name), units })
        continue
      }
      if (key.kind !== 'var') continue
      if (isSelf && key.mode !== SUM && !key.mode.startsWith(MULTIPLY)) {
        add(id, { name: key.name, units: selfUnits.get(key.name), own: true })
        continue
      }
      const inner = innerOf(key)
      if (!inner) continue
      const base = isSelf ? `${key.name}_${level.wrapperName}` : `${inner.name}_${childNameOf(level, key.path[0])}`
      add(id, { name: allocate(base), units: inner.units })
    }
    // Every wrapper variable, a self leaf's own included, is public_and_private (spike A).
    for (let i = 0; i < wrapper.variableCount(); i++) keep(wrapper.variableByIndex(i)).setInterfaceTypeByString('public_and_private')
  }

  embedUnits(model, units, keep)
  model.linkUnits()

  const wrapperVar = (key) => level.vars.get(keyOf(key))
  /** Equivalences a wrapper variable and a child's, unless they are one variable of the self leaf. */
  const link = (fromComponent, fromName, toComponent, toName) => {
    if (fromComponent === toComponent && fromName === toName) return
    const from = variableOf(fromComponent, fromName)
    const to = variableOf(toComponent, toName)
    if (!from || !to) return
    if (toComponent !== wrapper) ensurePublicInterface(to)
    if (fromComponent !== wrapper) ensurePublicInterface(from)
    lib.Variable.addEquivalence(from, to)
  }

  // The VoI: the wrapper's, or the host's environment, to each child's.
  let voiSource = null
  if (isHost && voi) {
    const environment = keep(new lib.Component())
    environment.setName(nextAvailableComponentName(model, 'environment'))
    const variable = keep(new lib.Variable())
    variable.setName(voi.name)
    variable.setUnitsByName(voi.units)
    variable.setInterfaceTypeByString('public')
    environment.addVariable(variable)
    model.addComponent(environment)
    embedUnits(model, units, keep)
    model.linkUnits()
    voiSource = { component: environment, name: voi.name }
  } else if (!isHost && level.needsVoi) {
    voiSource = { component: wrapper, name: wrapperVar({ kind: 'voi' }).name }
  }
  if (voiSource) {
    const voiUnits = keep(variableOf(voiSource.component, voiSource.name).units())
    for (const child of level.children) {
      const component = componentOf.get(localIdOf(child))
      if (isSuperInstance(child)) {
        const inner = definitions.get(child.data.smId)
        if (inner.needsVoi) link(voiSource.component, voiSource.name, component, inner.vars.get(keyOf({ kind: 'voi' })).name)
        continue
      }
      for (const name of level.voiOf.get(localIdOf(child)) ?? []) {
        const variable = variableOf(component, name)
        if (variable && lib.Units.compatible(voiUnits, keep(variable.units()))) link(voiSource.component, voiSource.name, component, name)
      }
    }
  }

  // Values: in the host, the parameters components; in a super-module, its wrapper's variables.
  const globalParameters = isHost ? keep(new lib.Component()) : null
  const instanceParameters = isHost ? keep(new lib.Component()) : null
  if (isHost) {
    globalParameters.setName(PHLYNX_GLOBAL_PARAMETERS_COMPONENT_NAME)
    instanceParameters.setName(PHLYNX_INSTANCE_PARAMETERS_COMPONENT_NAME)
    model.addComponent(globalParameters)
    model.addComponent(instanceParameters)
  }
  /** A parameter of the host, created once by name or, `unique`, under a name of its own. */
  const parameterVar = (component, { name, value, units: unitsName }, { unique = false } = {}) => {
    const existing = unique ? null : variableOf(component, name)
    if (existing) return name
    const parameterName = unique ? nextAvailableVarName(component, name) : name
    const variable = keep(new lib.Variable())
    variable.setName(parameterName)
    variable.setInitialValueByString(String(value))
    variable.setUnitsByName(unitsName || 'dimensionless')
    variable.setInterfaceTypeByString('public')
    component.addVariable(variable)
    return parameterName
  }

  for (const child of level.children) {
    const localId = localIdOf(child)
    const component = componentOf.get(localId)
    if (isSuperInstance(child)) {
      const inner = definitions.get(child.data.smId)
      for (const global of inner.globals) {
        const to = inner.vars.get(keyOf({ kind: 'global', name: global })).name
        if (isHost) {
          const parameter = { ...libraryStore.getGlobalConstant(global), name: global }
          link(globalParameters, parameterVar(globalParameters, parameter), component, to)
        } else link(wrapper, wrapperVar({ kind: 'global', name: global }).name, component, to)
      }
      continue
    }
    if (child === self) continue
    const expanded = graph.expandedAt(level.chain, child.id)
    for (const name of maths(child.data.mathRef).units.keys()) {
      const parameter = plan.parameterOf(expanded, name)
      if (!parameter || parameter.kind === 'ignored' || parameter.kind === 'missing') continue
      if (!isHost && levels.routed.has(`${child.id}\0${name}`)) continue
      if (isHost) {
        const target = parameter.kind === 'global' ? globalParameters : instanceParameters
        link(target, parameterVar(target, parameter.parameter), component, name)
      } else if (parameter.kind === 'global') link(wrapper, wrapperVar({ kind: 'global', name }).name, component, name)
      else if (parameter.kind === 'local') link(wrapper, wrapperVar({ kind: 'local', path: [], name }).name, component, name)
    }
  }
  if (isHost) {
    // Each root super instance's values, `<variable>_<super instance>`; a routed constant takes the global parameter, or
    // its super instance's local constant, after the others.
    const made = new Map()
    for (const { instanceId, key, parameter, via } of [...levels.hostValues].sort((a, b) => !!a.via - !!b.via)) {
      const instance = graph.nodeById.get(instanceId)
      const inner = definitions.get(instance.data.smId)
      const to = inner.vars.get(keyOf(key))
      if (!to) continue
      const component = componentOf.get(localIdOf(instance))
      if (via?.kind === 'global') {
        link(globalParameters, parameterVar(globalParameters, parameter), component, to.name)
        continue
      }
      const shared = `${instanceId}\0${keyOf(via?.key ?? key)}`
      const name = made.get(shared) ?? parameterVar(instanceParameters, { ...parameter, name: `${to.name}_${instance.data.name}` }, { unique: true })
      made.set(shared, name)
      link(instanceParameters, name, component, to.name)
    }
  }

  // A key's variable on its child, for keys passed straight on: values, local constants through a super instance, and
  // exposed variables as they are or multiplied.
  const sumKeys = []
  if (!isHost) {
    for (const [id, key] of level.keys) {
      const own = level.vars.get(id)
      if (!own || (key.kind === 'local' && !key.path.length) || key.kind === 'global' || key.kind === 'voi') continue
      if (key.mode === SUM) {
        sumKeys.push(key)
        continue
      }
      const inner = innerOf(key)
      if (!inner) continue
      const isLeaf = !isSuperInstance(level.byLocalId.get(key.path[0]))
      if (key.mode?.startsWith(MULTIPLY) && isLeaf) {
        const factor = Number(key.mode.slice(MULTIPLY.length + 1))
        const { outputVarName } = createMultiplyComponent(model, inner.component, inner.name, factor, container)
        link(wrapper, own.name, keep(model.componentByName('generated_multiplications', true)), outputVarName)
      } else link(wrapper, own.name, inner.component, inner.name)
    }
  }

  // The edges drawn at this level, as the flat export makes them, an end in a super instance at its wrapper variable.
  const { nameOf } = graph
  const endOf = (id, port, i) => {
    const { instanceChain, mainId } = graph.origin(id)
    const type = variableTypes(port)[i]
    const leaf = graph.nodeById.get(mainId)
    if (instanceChain.length === level.chain.length) {
      return { component: componentOf.get(localIdOf(leaf)), varName: port.variables[i], type, port, i }
    }
    const instance = graph.nodeById.get(instanceChain[level.chain.length])
    const path = [...instanceChain.slice(level.chain.length + 1).map((chainId) => localIdOf(graph.nodeById.get(chainId))), localIdOf(leaf)]
    const inner = definitions.get(instance.data.smId).vars.get(keyOf({ kind: 'var', path, name: port.variables[i], mode: modeOf(port, i) }))
    // A Multiply is made inside, so its product is passed on as it is.
    return inner && { component: componentOf.get(localIdOf(instance)), varName: inner.name, type: type === 'Sum' ? 'Sum' : 'None', instance }
  }
  const sums = new Map() // `component::variable` to its terms
  const addSumTerm = (component, varName, term) => {
    const key = `${component.name()}::${varName}`
    if (!sums.has(key)) sums.set(key, { component, varName, terms: [] })
    if (term) sums.get(key).terms.push(term)
  }
  for (const edge of graph.edgesAt(level.chain)) {
    for (const { sourcePort, targetPort } of edge.data?.couplings ?? []) {
      const [conflict] = couplingConflicts(sourcePort, targetPort)
      if (conflict) throw new Error(`Cannot connect "${nameOf(edge.source)}" to "${nameOf(edge.target)}": ${conflict}`)
      const count = Math.min(variableTypes(sourcePort).length, variableTypes(targetPort).length)
      for (let i = 0; i < count; i++) {
        if (!sourcePort.variables[i] || !targetPort.variables[i]) continue
        const ends = [endOf(edge.source, sourcePort, i), endOf(edge.target, targetPort, i)]
        if (!ends[0] || !ends[1]) continue
        const summed = ends.find((end) => end.type === 'Sum')
        const scaled = ends.find((end) => end.type === 'Multiply')
        if (!summed && !scaled) {
          connectVariables(model, ends[0].component, ends[0].varName, ends[1].component, ends[1].varName, container)
          continue
        }
        let term = ends.find((end) => end !== summed)
        if (scaled) {
          const { outputVarName } = createMultiplyComponent(model, scaled.component, scaled.varName, multiplyFactor(scaled.port, scaled.i), container)
          term = { component: keep(model.componentByName('generated_multiplications', true)), varName: outputVarName }
        }
        if (summed) addSumTerm(summed.component, summed.varName, term)
        else {
          const neighbour = ends.find((end) => end !== scaled)
          link(term.component, term.varName, neighbour.component, neighbour.varName)
        }
      }
    }
  }

  // Sums: each Sum variable at this level, a module's or a super instance's, sums its terms here. Exposed, it takes the
  // sum made outside: straight on with no terms here, else as one more term.
  const summedInside = (level.summedInside ??= new Set())
  const exposedSum = (path, name) => level.vars.get(keyOf({ kind: 'var', path, name, mode: SUM }))
  const sumRefs = []
  for (const child of level.children) {
    const localId = localIdOf(child)
    const component = componentOf.get(localId)
    if (isSuperInstance(child)) {
      const inner = definitions.get(child.data.smId)
      for (const [id, key] of inner.keys) {
        if (key.kind !== 'var' || key.mode !== SUM || !inner.vars.has(id)) continue
        sumRefs.push({ component, varName: inner.vars.get(id).name, path: [localId, ...key.path], name: key.name, deep: inner.summedInside.has(id), computed: false })
      }
      continue
    }
    const rows = new Map((child.data.variables ?? []).map((row) => [row.name, row]))
    for (const port of child.data.ports ?? []) {
      variableTypes(port).forEach((type, i) => {
        const name = port.variables[i]
        if (type !== 'Sum' || !rows.has(name) || sumRefs.some((ref) => ref.component === component && ref.varName === name)) return
        sumRefs.push({ component, varName: name, path: [localId], name, deep: false, computed: rows.get(name).type === 'variable' })
      })
    }
  }
  for (const ref of sumRefs) {
    const { terms = [] } = sums.get(`${ref.component.name()}::${ref.varName}`) ?? {}
    sums.delete(`${ref.component.name()}::${ref.varName}`)
    const exposed = isHost ? null : exposedSum(ref.path, ref.name)
    // A self leaf's variable can't be equivalent to its wrapper's: it is the wrapper's own.
    if (exposed && !terms.length && ref.component !== wrapper) {
      link(wrapper, exposed.name, ref.component, ref.varName)
      if (ref.deep) summedInside.add(keyOf({ kind: 'var', path: ref.path, name: ref.name, mode: SUM }))
    } else if (exposed) {
      createSummationComponent(model, ref.component, ref.varName, [...terms, { component: wrapper, varName: exposed.name }], container)
      summedInside.add(keyOf({ kind: 'var', path: ref.path, name: ref.name, mode: SUM }))
    } else if (terms.length === 1 && ref.deep) {
      // Summed inside already: one term is a direct connection.
      link(terms[0].component, terms[0].varName, ref.component, ref.varName)
    } else if (terms.length || !ref.computed) {
      createSummationComponent(model, ref.component, ref.varName, terms, container)
    }
  }
  for (const { component, varName, terms } of sums.values()) createSummationComponent(model, component, varName, terms, container)

  if (isHost) {
    if (!globalParameters.variableCount()) model.removeComponentByName(PHLYNX_GLOBAL_PARAMETERS_COMPONENT_NAME, false)
    if (!instanceParameters.variableCount()) model.removeComponentByName(PHLYNX_INSTANCE_PARAMETERS_COMPONENT_NAME, false)
  }
  importUnits(model, shared, level.fileName, keep)
  return keep(new lib.Printer()).printModel(model, false)
}

/** @returns {string} The name a level gives the child of a local id. */
const childNameOf = (level, localId) => sanitiseCellMLIdentifier(level.byLocalId.get(localId)?.data?.name ?? localId)

/** @returns {string} A local constant's units, as its super-module declares it. */
function localConstantUnits(graph, level, name) {
  const declaration = (graph.supermodules.get(level.smId)?.data?.supermodule?.localConstants ?? []).find((entry) => entry.name === name)
  if (declaration?.units) return declaration.units
  for (const child of level.children) {
    const row = (child.data?.variables ?? []).find((candidate) => candidate.name === name && candidate.type === 'local_constant')
    if (row?.units) return row.units
  }
  return 'dimensionless'
}

/**
 * Finds units in the library's units files, to copy into the units file.
 *
 * @returns {(name: string) => Object|null} A library Units.
 */
function unitsLibrary(libraryStore, parser, keep) {
  const libraries = new Map()
  return (name) => {
    for (const entry of libraryStore.availableUnits ?? []) {
      if (!libraries.has(entry.componentFile)) libraries.set(entry.componentFile, keep(parser.parseModel(entry.model)))
      const library = libraries.get(entry.componentFile)
      if (library?.hasUnitsByName(name)) return keep(library.unitsByName(name))
    }
    return null
  }
}

/** Calls `add` with the name of every units a model's own components use, its imported ones aside. */
function walkUnits(model, add, keep) {
  const walk = (parent) => {
    for (let i = 0; i < parent.componentCount(); i++) {
      const component = keep(parent.componentByIndex(i))
      if (component.isImport()) continue
      for (let j = 0; j < component.variableCount(); j++) add(keep(keep(component.variableByIndex(j)).units())?.name())
      if (component.math()) extractUnitsFromMath(component.math()).forEach(add)
      walk(component)
    }
  }
  walk(model)
}

/**
 * Embeds a units, and those it is made of, in a model, unless standard or there already.
 *
 * @param {Object} model
 * @param {string} name
 * @param {Function} findUnits - From unitsLibrary.
 * @param {Function} keep
 */
function embedUnitsByName(model, name, findUnits, keep) {
  if (!name || model.hasUnitsByName(name) || isStandardUnit(name)) return
  if (isAffineUnit(name)) {
    // Masked from the validator by the base unit it is offset from, as the flat export does.
    const affine = keep(new libcellml.Units())
    affine.setName(name)
    affine.addUnitByReference(AFFINE_UNIT_CONVERSIONS[name].baseUnit)
    model.addUnits(affine)
    return
  }
  const found = findUnits(name)
  if (!found) {
    console.warn(`Could not find definition for unit '${name}'`)
    return
  }
  const copy = keep(found.clone())
  model.addUnits(copy)
  for (let i = 0; i < copy.unitCount(); i++) embedUnitsByName(model, copy.unitAttributeReference(i), findUnits, keep)
}

/**
 * Embeds in a model every units its components, outside the ones it imports, use, and those they are made of: while a
 * file is built, for libcellml to compare units.
 */
function embedUnits(model, findUnits, keep) {
  walkUnits(model, (name) => embedUnitsByName(model, name, findUnits, keep), keep)
}

/**
 * The units file's model, which every file's units are added to.
 *
 * @returns {{model: Object, add: (name: string) => boolean}} add: whether the units file defines a units, added if not.
 */
function sharedUnits(findUnits, keep) {
  const model = keep(new libcellml.Model())
  model.setName('units')
  return {
    model,
    add: (name) => {
      embedUnitsByName(model, name, findUnits, keep)
      return model.hasUnitsByName(name)
    },
  }
}

/**
 * Replaces a file's units by imports from the units file, of those its components use, which the units file gets.
 *
 * @param {Object} model
 * @param {Object} shared - From sharedUnits.
 * @param {string} fileName - The file's name in the zip, which the units file's href is relative to.
 * @param {Function} keep
 */
function importUnits(model, shared, fileName, keep) {
  const names = new Set()
  walkUnits(model, (name) => name && !isStandardUnit(name) && names.add(name), keep)
  model.removeAllUnits()
  const source = keep(new libcellml.ImportSource())
  source.setUrl(`${'../'.repeat(folderOf(fileName).split('/').length - 1)}${UNITS_FILE}`)
  for (const name of names) {
    if (!shared.add(name)) continue
    const units = keep(new libcellml.Units())
    units.setName(name)
    units.setImportSource(source)
    units.setImportReference(name)
    model.addUnits(units)
  }
  model.linkUnits()
}

/**
 * Validates every file, as it is and, but for the host, with its imports resolved from the zip and flattened; then
 * flattens the host, validating and analysing the flattened model: validating the host misses what is wrong inside the
 * files it imports (spike A).
 *
 * @throws {Error} On the first file or the flattened model with errors.
 */
function checkFiles(files, host, { parser, keep, preserved, selfNamed }) {
  const validator = keep(new libcellml.Validator())
  for (const [file, text] of files) {
    const model = keep(parser.parseModel(text))
    if (parser.errorCount()) handleLoggerErrors(parser, `${file}: parser error count: ${parser.errorCount()}`)
    validator.validateModel(model)
    if (validator.errorCount()) handleLoggerErrors(validator, `${file}: validator error count: ${validator.errorCount()}`)
    if (file === host || file === UNITS_FILE) continue
    validator.validateModel(resolveFile(files, file, { parser, keep }).flat)
    if (validator.errorCount()) handleLoggerErrors(validator, `${file}, imports resolved: validator error count: ${validator.errorCount()}`)
  }
  const flat = keep(parser.parseModel(flattenFiles(files, host, { preserved, selfNamed }).cellml))
  validator.validateModel(flat)
  if (validator.errorCount()) handleLoggerErrors(validator, `Flattened model: validator error count: ${validator.errorCount()}`)
  const analyser = keep(new libcellml.Analyser())
  analyser.analyseModel(flat)
  if (analyser.errorCount()) handleLoggerErrors(analyser, `Flattened model: analyser error count: ${analyser.errorCount()}`)
}
