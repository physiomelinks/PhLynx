import JSZip from 'jszip'
import Papa from 'papaparse'

import { notify } from '../../utils/notify'
import { parseModuleRef } from '../../utils/config'
import { PORT_TYPE_OPTIONS } from '../../utils/constants'
import { isBlank } from '../../utils/variables'
import { configSignature, librarySignatures, moduleConfigEntry } from '../moduleConfig'
import { resolveBoundaryValues, storeOptions } from './boundaryValues'
import { buildCaCellmlFiles, isHeart, listNamed } from './caCellml'
import { parametersFileName, parametersJson } from '../../utils/parameters/write'
import { setAsUsedBy } from '../../utils/parameters/instanceSet'

// CA's placeholder for a value still to be given; it reads an empty cell as NaN.
const EMPTY_VALUE = 'EMPTY_MUST_BE_FILLED'
// The folder for CA's external_modules_dir, which reads every JSON file in it as a module config, so obs_data stays out.
const MODULES_DIR = 'modules'
// The folder the parameter sets the instances use are written to, each as `<ref>_parameters.json`.
const PARAMETERS_DIR = 'parameters'
// The module CA adds as a pulmonary artery and vein ('par', 'pvn') when the heart has one output.
const PULMONARY_MODULE_REF = 'arterial_simple:vp'

/**
 * Generates a zip blob for the Circulatory Autogen export. Components of one name in several groupings are renamed in
 * the export only, with a warning (buildCaCellmlFiles).
 * @param {string} fileName - The name for the exported files.
 * @param {Array} nodes - The array of nodes from Vue Flow.
 * @param {Array} edges - The array of edges from Vue Flow.
 * @param {Object} libraryStore - The Pinia builder store.
 * @param {ArrayBuffer|string|null} [obsData] - The workspace's obs_data.json, with its protocol, written as
 *   `<fileName>_obs_data.json` beside the config, as CA names it.
 * @param {Object} [options]
 * @param {(mathRef: string, paramRef: string) => Object|null} [options.getParameterSet] - Gives a loaded parameter
 *   set; each one an instance uses, chosen or its module's default, is written to `parameters/`.
 * @returns {Promise<Blob>} A promise that resolves with the zip file blob.
 */
export async function generateExportZip(fileName, nodes, edges, libraryStore, obsData = null, { getParameterSet } = {}) {
  try {
    const blocker = findCaExportBlocker(nodes, edges, libraryStore)
    if (blocker) throw new Error(blocker)

    const zip = new JSZip()

    // Create maps for quick lookup of node names and objects
    const nodeNameMap = new Map()
    const nodeNameObjMap = new Map()
    for (const node of nodes) {
      nodeNameMap.set(node.id, node.data.name)
      nodeNameObjMap.set(node.data.name, node)
    }

    // Each node's config entry, by module ref and then by signature (the entry less its subtype).
    const configsByRef = new Map()
    const instance_array = []
    const allParameters = new Set()
    // File name -> {mathRef, text}: the parameter sets the instances use.
    const parameterFiles = new Map()

    // --- 1. PROCESS NODES FOR CONFIG AND TOPOLOGY ---
    for (const node of nodes) {
      const inp_instances = []
      const out_instances = []

      // Identify incoming and outgoing connections
      for (const edge of edges) {
        if (edge.target === node.id) {
          const sourceNodeName = nodeNameMap.get(edge.source)
          if (sourceNodeName) inp_instances.push(sourceNodeName)
        }
        if (edge.source === node.id) {
          const targetNodeName = nodeNameMap.get(edge.target)
          if (targetNodeName) out_instances.push(targetNodeName)
        }
      }

      const { moduleType, moduleSubtype } = parseModuleRef(node.data.moduleRef)

      const moduleData = libraryStore.availableModules.get(node.data.moduleRef)
      if (!moduleData) {
        throw new Error(`Missing module definition '${node.data.moduleRef}' for node '${node.data.name}'`)
      }

      // An instance's own edits (ports, math, variable units or types) give it a config of its own.
      const entry = moduleConfigEntry(node.data, libraryStore)
      const signature = configSignature(entry)
      if (!configsByRef.has(node.data.moduleRef)) configsByRef.set(node.data.moduleRef, new Map())
      const configs = configsByRef.get(node.data.moduleRef)
      if (!configs.has(signature)) configs.set(signature, { entry, rows: [] })

      // An instance seeded with a set other than its module's default names it.
      const parameterisation = node.data.parameterisation
      const defaultSet = configs.get(signature).entry.default_parameterisation
      const row = {
        name: node.data.name,
        module_subtype: moduleSubtype,
        module_type: moduleType,
        inp_instances: inp_instances.join(' '),
        out_instances: out_instances.join(' '),
        ...(parameterisation && parameterisation !== defaultSet && { parameterisation }),
      }
      configs.get(signature).rows.push(row)
      instance_array.push(row)
      addParameterFile(parameterFiles, node, parameterisation || defaultSet, getParameterSet)

      // Collect parameters for this node's module. CA needs a row for every boundary condition, and uses it only
      // while nothing is connected to it.
      for (const variable of node.data.variables || []) {
        if (variable.type === 'constant') {
          allParameters.add(JSON.stringify({
            variable_name: `${variable.name}_${node.data.name}`,
            units: variable.units || '',
            value: isBlank(variable.value) ? '' : variable.value,
            data_reference: variable.data_reference || 'phlynx',
          }))
        } else if (variable.type === 'boundary_condition') {
          allParameters.add(JSON.stringify({
            variable_name: `${variable.name}_${node.data.name}`,
            units: variable.units || '',
            value: isBlank(variable.value) ? EMPTY_VALUE : variable.value,
            data_reference: variable.data_reference || 'phlynx',
          }))
        }
      }
    }

    warnMissingBoundaryValues(nodes, edges)
    const module_config = assignSubtypes(configsByRef, libraryStore)
    addPulmonaryModule(instance_array, module_config, libraryStore)
    // The CSV's columns are the first row's keys, so every row has the column once any does.
    if (instance_array.some((row) => row.parameterisation)) {
      for (const row of instance_array) row.parameterisation ??= ''
    }

    // The config's CellML, edits included; may rename component files so CA finds them.
    const { files: cellmlFiles, missingUnits, renamedComponents } = await buildCaCellmlFiles(fileName, module_config, libraryStore)
    if (renamedComponents.length) {
      notify.warning({
        title: 'Components Renamed',
        message: `CA finds components by name, so the export renames ${renamedComponents.map(({ file, from, to }) => `"${from}" in ${file} to "${to}"`).join(', ')}. The library keeps the original names.`,
      })
    }
    if (missingUnits.length) {
      notify.warning({
        title: 'Missing Units',
        message: `No library units file defines ${listNamed(missingUnits)}, so the exported units file leaves ${missingUnits.length === 1 ? 'it' : 'them'} out.`,
      })
    }

    // --- 2. CONSOLIDATE PARAMETER FILES INTO ONE CSV ---
    const globalConstants = libraryStore.globalVariables

    for (const variable of globalConstants) {
      allParameters.add(JSON.stringify({
        variable_name: variable[0],
        units: variable[1].units || '',
        value: isBlank(variable[1].value) ? '' : variable[1].value,
        data_reference: 'phlynx',
      }))
    }

    const consolidatedParameters = Array.from(allParameters).map((paramStr) => JSON.parse(paramStr))

    // --- 3. FINALIZING AND COMPRESSING ZIP ---
    zip.file(`${MODULES_DIR}/${fileName}_module_config.json`, JSON.stringify(module_config, null, 2))
    zip.file(`${fileName}_module_array.csv`, Papa.unparse(instance_array))
    zip.file(`${fileName}_parameters.csv`, Papa.unparse(consolidatedParameters))
    if (obsData != null) zip.file(`${fileName}_obs_data.json`, obsData)
    for (const [name, { text }] of parameterFiles) zip.file(`${PARAMETERS_DIR}/${name}`, text)
    for (const [name, text] of cellmlFiles) zip.file(`${MODULES_DIR}/${name}`, text)

    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    })

    return zipBlob
  } catch (error) {
    // The caller reports it.
    console.error('Export Error:', error)
    throw error
  }
}

/**
 * Finds what stops the workspace being exported to CA, so it can be checked before asking where to save.
 *
 * @param {Array} nodes - The array of nodes from Vue Flow.
 * @param {Array} edges - The array of edges from Vue Flow.
 * @param {Object} libraryStore - The Pinia builder store.
 * @returns {string|null} Why it can't be exported, or null when it can.
 */
export function findCaExportBlocker(nodes, edges, libraryStore) {
  // CA would run the module's own equation for the store, so the export would hold the wrong math.
  const driven = drivenStoreLabels(nodes, edges, libraryStore)
  return driven.length ? `Driving a CellDL store from a connection isn't supported in the CA export yet: ${driven.join(', ')}` : null
}

/**
 * Lists the CellDL stores a connection drives (see resolveBoundaryValues' `driven`), as `instance.variable`.
 *
 * @param {Array} nodes
 * @param {Array} edges
 * @param {Object} libraryStore
 * @returns {string[]}
 */
function drivenStoreLabels(nodes, edges, libraryStore) {
  if (!edges.some((edge) => edge.data?.couplings?.some((coupling) => coupling.drivesState))) return []
  const nodeNames = new Map(nodes.map((node) => [node.id, node.data.name]))
  const { driven } = resolveBoundaryValues(nodes, edges, libraryStore.getMathAnalysis, storeOptions(libraryStore))
  return [...driven].flatMap(([nodeId, states]) => [...states.keys()].map((name) => `${nodeNames.get(nodeId)}.${name}`))
}

/**
 * Warns about boundary conditions that nothing is connected to and that have no value, which CA leaves to be filled.
 *
 * @param {Array} nodes - The array of nodes from Vue Flow.
 * @param {Array} edges - The array of edges from Vue Flow.
 */
function warnMissingBoundaryValues(nodes, edges) {
  const nodeNames = new Map(nodes.map((node) => [node.id, node.data.name]))
  const missing = [...resolveBoundaryValues(nodes, edges).missing].flatMap(([nodeId, names]) =>
    [...names].map((name) => `${nodeNames.get(nodeId)}.${name}`)
  )
  if (!missing.length) return

  const count = missing.length === 1 ? '1 boundary condition has' : `${missing.length} boundary conditions have`
  notify.warning({
    title: 'Missing Boundary Values',
    message: `${count} no value and nothing connected, so CA will ask for ${missing.length === 1 ? 'it' : 'them'}: ${listNamed(missing)}.`,
  })
}

/**
 * Adds the parameter set an instance uses to the files to write, once per ref; a set the instance made holds its
 * current values, blank ones written as EMPTY_MUST_BE_FILLED. CA finds a set by its ref alone, so a
 * second math's set of the same ref is left out, with a warning.
 *
 * @param {Map<string, {mathRef: string, text: string}>} parameterFiles - Added to.
 * @param {Object} node
 * @param {string|null|undefined} paramRef
 * @param {Function} [getParameterSet]
 */
function addParameterFile(parameterFiles, node, paramRef, getParameterSet) {
  const stored = paramRef && getParameterSet?.(node.data.mathRef, paramRef)
  if (!stored) return
  // A set an instance made is written as that instance's values are now.
  const set = setAsUsedBy(stored, node)
  const name = parametersFileName(set.ref)
  const written = parameterFiles.get(name)
  if (!written) {
    parameterFiles.set(name, { mathRef: node.data.mathRef, text: parametersJson(set) })
  } else if (written.mathRef !== node.data.mathRef) {
    notify.warning({
      title: 'Parameter Set Not Exported',
      message: `${node.data.mathRef} and ${written.mathRef} each have a parameter set named "${set.ref}", and CA finds sets by name, so only the one for ${written.mathRef} is written.`,
    })
  }
}

/**
 * Gives a module ref's configs their subtypes. A config an untouched instance would have keeps the module ref's
 * subtype. Each other config gets `<subtype>_<first instance>`, made unique, and its instances' rows name it, so an
 * edited config never goes out under a ref that resolves to the library module. Warns, naming the instances split out.
 *
 * @param {Map<string, Map<string, {entry: Object, rows: Array}>>} configsByRef - Configs by module ref, then signature.
 * @param {Object} libraryStore - The library, for `availableModules` and its math.
 * @returns {Array<Object>} The config entries.
 */
function assignSubtypes(configsByRef, libraryStore) {
  const taken = new Set([...libraryStore.availableModules.keys(), ...configsByRef.keys()])
  const entries = []
  const splitOut = []

  for (const [moduleRef, configs] of configsByRef) {
    const { moduleType, moduleSubtype } = parseModuleRef(moduleRef)
    const libraryModule = libraryStore.availableModules.get(moduleRef)
    const baseSignature = librarySignatures(libraryModule, libraryStore).find((signature) => configs.has(signature))

    for (const [signature, { entry, rows }] of configs) {
      if (signature !== baseSignature) {
        let subtype = `${moduleSubtype}_${rows[0].name}`
        for (let i = 2; taken.has(`${moduleType}:${subtype}`); i++) subtype = `${moduleSubtype}_${rows[0].name}_${i}`
        taken.add(`${moduleType}:${subtype}`)
        entry.module_subtype = subtype
        for (const row of rows) row.module_subtype = subtype
        splitOut.push(...rows.map((row) => `${row.name} (${subtype})`))
      }
      entries.push(entry)
    }
  }

  if (splitOut.length) {
    const one = splitOut.length === 1
    notify.warning({
      title: 'Instances Exported Separately',
      message: `${one ? '1 instance differs' : `${splitOut.length} instances differ`} from ${one ? 'its' : 'their'} library module in ports, math or variables, so the export gives ${one ? 'it its own module config' : 'them their own module configs'}: ${listNamed(splitOut)}.`,
    })
  }
  return entries
}

/**
 * Adds the module CA uses for the pulmonary artery and vein it adds when the only heart has one output, unless a
 * config has it already, and warns that CA will ask for their values.
 *
 * @param {Array} instanceArray - The module array rows.
 * @param {Array<Object>} moduleConfig - The config entries, added to.
 * @param {Object} libraryStore - The library, for `availableModules` and the math's format.
 */
function addPulmonaryModule(instanceArray, moduleConfig, libraryStore) {
  const hearts = instanceArray.filter((row) => isHeart(row.module_type))
  if (hearts.length !== 1 || hearts[0].out_instances.split(' ').filter(Boolean).length >= 2) return

  const { moduleType, moduleSubtype } = parseModuleRef(PULMONARY_MODULE_REF)
  const module = libraryStore.availableModules.get(PULMONARY_MODULE_REF)
  const present = moduleConfig.some((entry) => entry.module_type === moduleType && entry.module_subtype === moduleSubtype)
  if (module && !present) moduleConfig.push(moduleConfigEntry(module, libraryStore))
  notify.warning({
    title: 'Pulmonary Circuit Added',
    message: `"${hearts[0].name}" has one output, so CA adds a pulmonary artery and vein (par, pvn) and will ask for their values.`,
  })
}
