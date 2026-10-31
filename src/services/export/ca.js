import JSZip from 'jszip'
import Papa from 'papaparse'

import { notify } from '../../utils/notify'
import { parseMathRef, parseModuleRef, restorePorts, restoreVariables } from '../../utils/config'
import { PORT_TYPE_OPTIONS } from '../../utils/constants'
import { isAnnotatedPort } from '../../utils/portIdentity'
import { isBlank } from '../../utils/variables'
import { resolveBoundaryValues } from './boundaryValues'
import { buildCaCellmlFiles, isHeart, listNamed } from './caCellml'

// CA's placeholder for a value still to be given; it reads an empty cell as NaN.
const EMPTY_VALUE = 'EMPTY_MUST_BE_FILLED'
// The folder for CA's external_modules_dir, which reads every JSON file in it as a module config, so obs_data stays out.
const MODULES_DIR = 'modules'
// The module CA adds as a pulmonary artery and vein ('par', 'pvn') when the heart has one output.
const PULMONARY_MODULE_REF = 'arterial_simple:vp'

/**
 * Generates a zip blob for the Circulatory Autogen export.
 * @param {string} fileName - The name for the exported files.
 * @param {Array} nodes - The array of nodes from Vue Flow.
 * @param {Array} edges - The array of edges from Vue Flow.
 * @param {Object} libraryStore - The Pinia builder store.
 * @param {ArrayBuffer|string|null} [obsData] - The workspace's obs_data.json, with its protocol, written as
 *   `<fileName>_obs_data.json` beside the config, as CA names it.
 * @returns {Promise<Blob>} A promise that resolves with the zip file blob.
 */
export async function generateExportZip(fileName, nodes, edges, libraryStore, obsData = null) {
  try {
    assertNoAnnotatedCouplings(nodes, edges)
    const zip = new JSZip()

    // Create maps for quick lookup of node names and objects
    const nodeNameMap = new Map()
    const nodeNameObjMap = new Map()
    for (const node of nodes) {
      nodeNameMap.set(node.id, node.data.name)
      nodeNameObjMap.set(node.data.name, node)
    }

    const uniqueModuleConfigs = new Map()
    const instance_array = []
    const allParameters = new Set()

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

      // Process Ports
      const allConnectedInstanceNames = new Set([...inp_instances, ...out_instances])
      const connectedNodeObjects = Array.from(allConnectedInstanceNames)
        .map((name) => nodeNameObjMap.get(name))
        .filter(Boolean)

      const { moduleType, moduleSubtype } = parseModuleRef(node.data.moduleRef)

      const moduleData = libraryStore.availableModules.get(node.data.moduleRef)
      if (!moduleData) {
        throw new Error(`Missing module definition '${node.data.moduleRef}' for node '${node.data.name}'`)
      }

      if (!uniqueModuleConfigs.has(node.data.moduleRef)) {
        uniqueModuleConfigs.set(node.data.moduleRef, moduleConfigEntry(node.data))
      }

      instance_array.push({
        name: node.data.name,
        module_subtype: moduleSubtype,
        module_type: moduleType,
        inp_instances: inp_instances.join(' '),
        out_instances: out_instances.join(' '),
      })

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
    addPulmonaryModule(instance_array, uniqueModuleConfigs, libraryStore)

    // Convert Map to array
    const module_config = Array.from(uniqueModuleConfigs.values());

    // The config's CellML, edits included; may rename component files so CA finds them.
    const { files: cellmlFiles, missingUnits } = await buildCaCellmlFiles(fileName, module_config, libraryStore)
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
    for (const [name, text] of cellmlFiles) zip.file(`${MODULES_DIR}/${name}`, text)

    const zipBlob = await zip.generateAsync({
      type: 'blob',
      compression: 'DEFLATE',
      compressionOptions: { level: 9 },
    })

    return zipBlob
  } catch (error) {
    console.error('Export Error:', error)
    notify.error({ message: `Failed to export config files: ${error.message}` })
    throw error
  }
}

/**
 * The edges with a coupling made by annotations, as 'source → target' names.
 *
 * @param {Array} nodes
 * @param {Array} edges
 * @returns {string[]}
 */
export function annotatedCouplingEdges(nodes, edges) {
  const names = new Map(nodes.map((node) => [node.id, node.data?.name ?? node.id]))
  return edges
    .filter((edge) =>
      (edge.data?.couplings ?? []).some(
        ({ sourcePort, targetPort }) => isAnnotatedPort(sourcePort) || isAnnotatedPort(targetPort)
      )
    )
    .map((edge) => `${names.get(edge.source) ?? edge.source} → ${names.get(edge.target) ?? edge.target}`)
}

/**
 * Stops the export when a coupling joins annotated ports: CA pairs ports by their port_type label, which annotated
 * ports leave empty.
 *
 * @param {Array} nodes
 * @param {Array} edges
 * @throws {Error} Naming the edges.
 */
function assertNoAnnotatedCouplings(nodes, edges) {
  const annotated = annotatedCouplingEdges(nodes, edges)
  if (!annotated.length) return
  throw new Error(
    `CA export can't carry couplings made by annotations, which have no port labels for CA to pair: ` +
      `${listNamed(annotated)}. Export CellML instead.`
  )
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
 * Makes a module's CA config entry.
 *
 * @param {{moduleRef: string, mathRef: string, ports: Array, variables: Array}} module - A node's data or a library module.
 * @returns {Object}
 */
function moduleConfigEntry(module) {
  const portsByType = restorePorts(module.ports)
  const { componentFile, componentName } = parseMathRef(module.mathRef)
  const { moduleType, moduleSubtype } = parseModuleRef(module.moduleRef)
  return {
    module_type: moduleType,
    module_subtype: moduleSubtype,
    module_format: 'cellml', // TODO - will need to generalise
    component_file: componentFile,
    component_type: componentName,
    entrance_ports: portsByType.entrance_ports || [],
    exit_ports: portsByType.exit_ports || [],
    general_ports: portsByType.general_ports || [],
    variables_and_units: restoreVariables(module.variables),
  }
}

/**
 * Adds the module CA uses for the pulmonary artery and vein it adds when the only heart has one output, and warns that
 * CA will ask for their values.
 *
 * @param {Array} instanceArray - The module array rows.
 * @param {Map<string, Object>} moduleConfigs - The config entries by module ref, added to.
 * @param {Object} libraryStore - The library, for `availableModules`.
 */
function addPulmonaryModule(instanceArray, moduleConfigs, libraryStore) {
  const hearts = instanceArray.filter((row) => isHeart(row.module_type))
  if (hearts.length !== 1 || hearts[0].out_instances.split(' ').filter(Boolean).length >= 2) return

  const module = libraryStore.availableModules.get(PULMONARY_MODULE_REF)
  if (module && !moduleConfigs.has(PULMONARY_MODULE_REF)) moduleConfigs.set(PULMONARY_MODULE_REF, moduleConfigEntry(module))
  notify.warning({
    title: 'Pulmonary Circuit Added',
    message: `"${hearts[0].name}" has one output, so CA adds a pulmonary artery and vein (par, pvn) and will ask for their values.`,
  })
}
