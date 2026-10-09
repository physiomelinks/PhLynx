import { extractComponentsFromCellmlString } from '../utils/cellml'
import {
  MAIN_NODE_TYPE,
  HANDLE_VARIANT,
  PHLYNX_PROJECT_VERSION,
  PHLYNX_PROJECT_IDENTIFIER,
} from '../utils/constants'
import { normalisePorts, normaliseVariables } from '../utils/config'
import { buildGhostHandles, findMostCentralGhostHandle } from '../utils/handles'
import { isBlank, isNumericLiteral } from '../utils/variables'
import { analyzeMathXml } from './math/analyzeMath'
import { getPortVariables, reconcileRows } from './math/reconcileRows'
import { separateParameters } from './math/separateParameters'

function mergeVariables(oldData, nodeName, globalConstantNames, paramLookup) {
  const typeLookup = {}
  ;(oldData.variables || []).forEach((v) => {
    typeLookup[v.name] = v
  })

  return (oldData.portOptions || []).map((opt) => {
    const name = opt.name
    const units = opt.units
    const legacyVar = typeLookup[name]
    const varType = legacyVar ? legacyVar.type : 'variable'
    const legacyValue = legacyVar && legacyVar.value !== undefined ? legacyVar.value : null

    let value = null
    let dataReference = null

    if (varType === 'global_constant') {
      value = null
      dataReference = null
    } else {
      const key = `${name}_${nodeName}`
      const match = paramLookup[key]
      if (match) {
        value = match.value !== undefined ? match.value : null
        dataReference = match.data_reference !== undefined ? match.data_reference : null
      } else {
        value = legacyValue
        dataReference = null
      }
    }

    return {
      name,
      value,
      units,
      access: 'access',
      type: varType,
      data_reference: dataReference,
    }
  })
}

function convertPorts(oldData) {
  return (oldData.portLabels || []).map((p) => ({
    portType: p.portType,
    label: p.label,
    variables: p.option || [],
    multiportType: p.multiport,
  }))
}

function convertHandles(oldData, uidMap) {
  const migratedHandles = buildGhostHandles()
  for (const port of oldData.ports) {
    const oldUid = port.uid
    const centralGhost = findMostCentralGhostHandle(port.side, migratedHandles)
    if (!centralGhost) return
    uidMap[oldUid] = centralGhost.uid
    const handle = migratedHandles.find((h) => h.uid === centralGhost.uid)
    if (handle) {
      handle.variant = HANDLE_VARIANT.DEFAULT
      handle.type = port.type
    }
  }
  return migratedHandles
}

function convertNode(node, newId, globalConstantNames, paramLookup, uidMap) {
  const oldData = node.data || {}
  const nodeName = oldData.name

  const sourceFile = oldData.sourceFile || ''
  const componentName = oldData.componentName || ''
  const moduleType = oldData.module_type || ''
  const bcType = oldData.BC_type || ''

  const newData = {
    name: nodeName,
    mathRef: `${sourceFile}:${componentName}`,
    moduleRef: `${moduleType}:${bcType}`,
    variables: mergeVariables(oldData, nodeName, globalConstantNames, paramLookup),
    ports: convertPorts(oldData),
    handles: convertHandles(oldData, uidMap),
  }
  // The MVP's node colour category; the colour theme now maps it to a colour.
  if (oldData.domainType) newData.domainType = oldData.domainType

  const newNode = {
    id: newId,
    type: MAIN_NODE_TYPE,
    position: node.position,
    data: newData,
  }

  if ('style' in node) newNode.style = node.style
  return newNode
}

function convertPortRef(portRef) {
  if (!portRef) return null
  return {
    portType: portRef.portType,
    label: portRef.label,
    variables: portRef.option || [],
    multiportType: portRef.multiport,
  }
}

function convertEdge(edge, idMap, uidMap) {
  const oldSource = edge.source
  const oldTarget = edge.target
  let newSource = idMap[oldSource]
  let newTarget = idMap[oldTarget]

  if (!newSource || !newTarget) {
    console.warn(
      `Edge '${edge.id}': source/target (${oldSource}/${oldTarget}) not found in node id map; edge may be broken.`
    )
    newSource = newSource || oldSource
    newTarget = newTarget || oldTarget
  }

  function remapHandle(h, label) {
    if (!h) return null
    let oldUid = h
    if (!h.startsWith('port_')) {
      console.warn(`Edge '${edge.id}': unexpected ${label} format '${h}' (expected 'port_<uid>'); left prefix as-is.`)
    } else {
      oldUid = h.slice(5)
    }

    let newUid = uidMap[oldUid]
    if (!newUid) {
      console.warn(
        `Edge '${edge.id}': ${label} uid '${oldUid}' not found among converted node handles; keeping original uid.`
      )
      newUid = oldUid
    }
    return `handle_${newUid}`
  }

  const oldCouplings = edge.data && edge.data.couplings ? edge.data.couplings : []
  const newCouplings = oldCouplings.map((c) => ({
    sourcePort: convertPortRef(c.sourcePortLabel),
    targetPort: convertPortRef(c.targetPortLabel),
  }))

  return {
    id: `${newSource}--${newTarget}`,
    type: edge.type,
    source: newSource,
    target: newTarget,
    sourceHandle: remapHandle(edge.sourceHandle, 'sourceHandle'),
    targetHandle: remapHandle(edge.targetHandle, 'targetHandle'),
    data: { couplings: newCouplings },
    label: edge.label || '',
    markerEnd: edge.markerEnd,
    style: edge.style,
    sourceX: edge.sourceX,
    sourceY: edge.sourceY,
    targetX: edge.targetX,
    targetY: edge.targetY,
  }
}

function collectGlobalConstantNames(nodes) {
  const names = new Set()
  nodes.forEach((node) => {
    const vars = node.data && node.data.variables ? node.data.variables : []
    vars.forEach((v) => {
      if (v.type === 'global_constant') names.add(v.name)
    })
  })
  return names
}

function buildParamLookup(availableParameters) {
  const lookup = {}
  availableParameters.forEach(([key, entry]) => {
    const vname = entry.variable_name
    if (vname != null && !(vname in lookup)) {
      lookup[vname] = entry
    }
  })
  return lookup
}

function buildGlobalConstants(availableParameters, globalConstantNames, legacyGlobalConstants = []) {
  const result = []
  const seen = new Set()
  availableParameters.forEach(([key, entry]) => {
    const vname = entry.variable_name
    if (globalConstantNames.has(vname) && !seen.has(vname)) {
      seen.add(vname)
      result.push([
        vname,
        {
          value: entry.value,
          units: entry.units,
          data_reference: entry.data_reference,
        },
      ])
    }
  })
  // Constants set in the app are only in the old store's globalConstants, not in its parameters.
  legacyGlobalConstants.forEach(([vname, entry]) => {
    if (!seen.has(vname)) {
      seen.add(vname)
      result.push([vname, { value: entry.value, units: entry.units, data_reference: entry.data_reference ?? null }])
    }
  })
  return result
}

function extractComponentsToMathRefs(availableModules) {
  const newAvailableMath = {}
  if (!availableModules) return newAvailableMath

  for (const collection of availableModules) {
    if (!collection.model) continue

    const result = extractComponentsFromCellmlString(collection.model)

    if (result.errors && result.errors.length > 0) {
      console.warn(`Errors extracting components from ${collection.filename}:`, result.errors)
    }

    if (result.xml && Array.isArray(result.xml)) {
      for (const component of result.xml) {
        const mathRefKey = `${collection.filename}:${component.name}`
        newAvailableMath[mathRefKey] = component.math
      }
    }
  }

  return newAvailableMath
}

function extractModulesToModuleRefs(availableModules) {
  const newAvailableModules = {}
  if (!availableModules) return newAvailableModules

  for (const collection of availableModules) {
    const modulesList = collection.modules
    for (const modules of modulesList) {
      if (!modules.configs) continue
      modules.configs.forEach((config) => {
        const moduleType = config.vessel_type
        const moduleSubtype = config.BC_type
        const componentFile = config.module_file
        const componentName = config.module_type

        const moduleRef = `${moduleType}:${moduleSubtype}`
        const mathRef = `${componentFile}:${componentName}`

        newAvailableModules[moduleRef] = {
          moduleRef,
          mathRef,
          ports: normalisePorts(config),
          variables: normaliseVariables(config.variables_and_units),
        }
      })
    }
  }
  return newAvailableModules
}

function convertStore(oldStore, globalConstantNames) {
  const availableParameters = oldStore.availableParameters || []

  const newUnits = oldStore.availableUnits.map((u) => ({
    componentFile: u.filename,
    model: u.model,
  }))

  const newAvailableMath = extractComponentsToMathRefs(oldStore.availableModules)
  const newAvailableModules = extractModulesToModuleRefs(oldStore.availableModules)

  const newAvailableCollections = {}
  Object.values(newAvailableModules).forEach((mod) => {
    if (!newAvailableCollections[mod.mathRef]) {
      newAvailableCollections[mod.mathRef] = new Set()
    }
    newAvailableCollections[mod.mathRef].add(mod.moduleRef)
  })

  return {
    availableCollections: Object.entries(newAvailableCollections).map(([mathRef, moduleRefsSet]) => [
      mathRef,
      Array.from(moduleRefsSet),
    ]),
    availableModules: Object.entries(newAvailableModules),
    availableMath: Object.entries(newAvailableMath),
    availableUnits: newUnits,
    globalConstants: buildGlobalConstants(availableParameters, globalConstantNames, oldStore.globalConstants ?? []),
    lastSaveName: oldStore.lastSaveName,
  }
}

/*
 * Workspace file versions. A file is brought up to date by applying each step after its version.
 *
 * - legacy: no version. The store holds availableModules and availableParameters, and nodes keep
 *   portOptions and portLabels.
 * - 1.0.0: `{ id, version, flow, store, simulation, inspectionModules, workspace }`, as saved by the
 *   production site. Earlier saves used `{ info: { format_version: '1.0.0' } }` and may lack `simulation`.
 *   Math keeps its numeric initial values, and a blank row falls back to them.
 * - 1.1.0: math holds no numeric initial values, so the rows alone initialise the model. Each state
 *   names an initialiser variable, and store.mathDefaults holds the values taken out of each math.
 *   store.mathLayouts holds `[mathRef, TextLayout]` pairs: each math's CellML text comments, blank
 *   lines and statements as typed (see cellml-text-editor), which the XML can't hold.
 *   A port's multiportType and multiplyFactor may be lists, one entry per variable, when its
 *   variables differ (see utils/multiport.js); a whole-port value still means every variable, so
 *   1.0.0 ports need no migration.
 * - 1.2.0: simulation.simulationSettings' solver, timeStep, tolerance and maxSteps are applied, where
 *   before they were placeholders. `solver` is a key of SOLVERS (services/simulation/sedParameters.js).
 *   For CVODE, `tolerance` is its relative and absolute tolerance, `maxSteps` its maximum number of
 *   steps between output points, and `timeStep` its maximum step (0 for none); for a fixed-step solver,
 *   `timeStep` is its step. Older files get the settings every run used: CVODE, 1e-7, 500 and 0.
 *   A plotConfig selection's nodeId may be `inspection:<module id>`, an inspection module's output put on
 *   a plot, with variableName the module's name; older files have none.
 */
const LEGACY_VERSION = 'legacy'

// The solver settings every simulation and export used before 1.2.0, whatever the file held.
const SOLVER_SETTINGS_BEFORE_1_2_0 = Object.freeze({ solver: 'CVODE', timeStep: 0, tolerance: 1e-7, maxSteps: 500 })

const MIGRATIONS = [
  { from: LEGACY_VERSION, to: '1.0.0', migrate: migrateLegacyTo1_0_0 },
  { from: '1.0.0', to: '1.1.0', migrate: migrate1_0_0To1_1_0 },
  { from: '1.1.0', to: '1.2.0', migrate: migrate1_1_0To1_2_0 },
]

/**
 * Takes values out of older math and puts them in the rows of the nodes using it, so the rows
 * alone initialise the model. Math already separated, and its nodes, come back unchanged.
 *
 * @param {Array} nodes - Workspace nodes.
 * @param {Array<[string, string]>} mathEntries - mathRef and math pairs.
 * @returns {{ nodes: Array, mathEntries: Array<[string, string]>, mathDefaults: Array<[string, Array<[string, string]>]>,
 *   globalValues: Map<string, { value: string, units: string, data_reference: ?string }> }}
 *   The nodes and math, the values taken out of each math, as libraryStore.getState saves them, and
 *   the first value taken out for each global constant, as a libraryStore global constant entry.
 */
export function separateNodeParameters(nodes, mathEntries) {
  const separatedByRef = new Map()
  const separatedEntries = mathEntries.map(([mathRef, math]) => {
    const separated = separateParameters(math)
    if (separated.math !== math) separatedByRef.set(mathRef, separated)
    return [mathRef, separated.math]
  })

  const globalValues = new Map()
  const separatedNodes = nodes.map((node) => {
    const separated = separatedByRef.get(node.data?.mathRef)
    if (!separated) return node

    // Before, a blank row fell back to the math's value, so a blank row takes that value now.
    const { values, initialisers } = separated
    const previousRows = node.data.variables ?? []
    const rows = previousRows.map((row) =>
      isBlank(row.value) && values.has(row.name) ? { ...row, value: values.get(row.name) } : row
    )
    const variables = reconcileRows(analyzeMathXml(separated.math), rows, {
      portVariables: getPortVariables(node.data.ports),
      defaults: values,
    })
    carryStateInitialValues(variables, previousRows, initialisers)
    for (const row of variables) {
      if (row.type !== 'global_constant' || !values.has(row.name) || globalValues.has(row.name)) continue
      globalValues.set(row.name, {
        value: values.get(row.name),
        units: row.units,
        data_reference: row.data_reference ?? null,
      })
    }
    return { ...node, data: { ...node.data, variables } }
  })

  const mathDefaults = Array.from(separatedByRef, ([mathRef, { values }]) => [mathRef, Array.from(values)]).filter(
    ([, values]) => values.length
  )

  return { nodes: separatedNodes, mathEntries: separatedEntries, mathDefaults, globalValues }
}

/**
 * Gives each initialiser created by separation its state's numeric value and data reference, since
 * the state's value was its initial value.
 *
 * @param {Array} rows - Reconciled rows; mutated in place.
 * @param {Array} previousRows - The rows before separation.
 * @param {Set<string>} initialisers - The initialiser names separation created.
 */
function carryStateInitialValues(rows, previousRows, initialisers) {
  const previousByName = new Map(previousRows.map((row) => [row.name, row]))
  const rowsByName = new Map(rows.map((row) => [row.name, row]))
  for (const row of rows) {
    const initialiserRow = rowsByName.get(row.initialiser)
    if (row.stateRole !== 'state' || !initialisers.has(row.initialiser) || !initialiserRow) continue
    const previous = previousByName.get(row.name)
    const value = String(previous?.value ?? '').trim()
    if (isNumericLiteral(value)) initialiserRow.value = value
    const reference = previous?.data_reference
    if (reference != null && initialiserRow.data_reference == null) initialiserRow.data_reference = reference
  }
}

/**
 * Gets the format version of a saved workspace.
 *
 * @param {Object} doc - A parsed workspace file.
 * @returns {string} The version, or 'legacy' for files saved before versioning.
 */
export function detectVersion(doc) {
  return doc?.version ?? doc?.info?.format_version ?? LEGACY_VERSION
}

// The settings files saved without any were given when 1.0.0 came in. Kept as they were, so those files
// load the same however the app's defaults change.
const SETTINGS_FOR_FILES_WITHOUT_ANY = Object.freeze({
  pointInterval: 0.01,
  startingPoint: 0.0,
  endingPoint: 10.0,
  initialPoint: 0.0,
  solver: 'CVODE',
  timeStep: 0.0,
  tolerance: 1e-6,
  maxSteps: 10000,
})

/**
 * Gets the simulation block 1.0.0 requires, for files saved before it was always written.
 *
 * @returns {Object}
 */
function defaultSimulation() {
  return { simulationSettings: { ...SETTINGS_FOR_FILES_WITHOUT_ANY }, plotConfig: {}, parameterScanConfig: {} }
}

/**
 * Gives a versioned workspace the current envelope, replacing the earlier `info` block.
 *
 * @param {Object} doc - A versioned workspace file.
 * @param {string} version - Its version.
 * @returns {Object}
 */
function normaliseEnvelope(doc, version) {
  const normalised = {
    ...doc,
    id: PHLYNX_PROJECT_IDENTIFIER,
    version,
    simulation: doc.simulation ?? defaultSimulation(),
    inspectionModules: doc.inspectionModules ?? [],
  }
  delete normalised.info
  return normalised
}

/**
 * Brings a saved workspace from any version up to the current one.
 *
 * @param {Object} doc - A parsed workspace file.
 * @returns {Object} The workspace at PHLYNX_PROJECT_VERSION.
 * @throws {Error} If the version is unknown, e.g. saved by a newer PhLynx.
 */
export function migrateWorkspace(doc) {
  const version = detectVersion(doc)
  const current = version === LEGACY_VERSION ? doc : normaliseEnvelope(doc, version)
  if (version === PHLYNX_PROJECT_VERSION) return current

  const start = MIGRATIONS.findIndex((step) => step.from === version)
  if (start === -1) {
    throw new Error(`Unsupported workspace version '${version}'. It may have been saved by a newer version of PhLynx.`)
  }
  return MIGRATIONS.slice(start).reduce((migrated, step) => ({ ...step.migrate(migrated), version: step.to }), current)
}

/**
 * 1.1.0 -> 1.2.0: gives the simulation settings the solver settings that were used, since the solver,
 * time step, tolerance and maximum steps the file held were never applied before 1.2.0.
 *
 * @param {Object} doc - A 1.1.0 workspace.
 * @returns {Object}
 */
function migrate1_1_0To1_2_0(doc) {
  if (!doc.simulation) return doc
  return {
    ...doc,
    simulation: {
      ...doc.simulation,
      simulationSettings: { ...doc.simulation.simulationSettings, ...SOLVER_SETTINGS_BEFORE_1_2_0 },
    },
  }
}

/**
 * 1.0.0 -> 1.1.0: moves the math's values into the rows and records them as math defaults. A global
 * constant with no stored value takes its math value. Math from 1.0.0 has no text layouts.
 *
 * @param {Object} doc - A 1.0.0 workspace.
 * @returns {Object}
 */
function migrate1_0_0To1_1_0(doc) {
  const store = doc.store ?? {}
  const mathEntries = Array.isArray(store.availableMath) ? store.availableMath : Object.entries(store.availableMath ?? {})
  const { nodes, mathEntries: separatedEntries, mathDefaults, globalValues } = separateNodeParameters(
    doc.flow?.nodes ?? [],
    mathEntries
  )
  // Before, a global with no stored value fell back to the math's value.
  const globalConstants = new Map(store.globalConstants ?? [])
  for (const [name, entry] of globalValues) {
    const stored = globalConstants.get(name)
    if (isBlank(stored?.value)) globalConstants.set(name, stored ? { ...stored, value: entry.value } : entry)
  }
  return {
    ...doc,
    flow: { ...doc.flow, nodes },
    store: {
      ...store,
      availableMath: separatedEntries,
      mathDefaults,
      mathLayouts: store.mathLayouts ?? [],
      globalConstants: Array.from(globalConstants),
    },
  }
}

/**
 * legacy -> 1.0.0: converts a pre-versioning build file.
 *
 * @param {Object} doc - A legacy workspace.
 * @returns {Object}
 */
function migrateLegacyTo1_0_0(doc) {
  const oldFlow = doc.flow
  const oldStore = doc.store
  const oldNodes = oldFlow.nodes
  const oldEdges = oldFlow.edges

  // Sequential id map
  const idMap = {}
  oldNodes.forEach((n, i) => {
    idMap[n.id] = `dndnode_${i}`
  })

  const globalConstantNames = collectGlobalConstantNames(oldNodes)
  const paramLookup = buildParamLookup(oldStore.availableParameters || [])

  const uidMap = {}

  const newNodes = oldNodes.map((n) => convertNode(n, idMap[n.id], globalConstantNames, paramLookup, uidMap))

  const newEdges = oldEdges.map((e) => convertEdge(e, idMap, uidMap))

  const newFlow = {
    nodes: newNodes,
    edges: newEdges,
    position: oldFlow.position,
    zoom: oldFlow.zoom,
    viewport: oldFlow.viewport,
  }

  return {
    id: PHLYNX_PROJECT_IDENTIFIER,
    version: '1.0.0',
    flow: newFlow,
    store: convertStore(oldStore, globalConstantNames),
    simulation: {
      simulationSettings: { ...SETTINGS_FOR_FILES_WITHOUT_ANY },
      plotConfig: {},
      parameterScanConfig: {},
    },
    inspectionModules: [],
  }
}
