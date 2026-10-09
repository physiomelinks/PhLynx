import JSZip from 'jszip'
import Papa from 'papaparse'

import { notify } from '../../utils/notify'
import { parseMathRef, parseModuleRef, restorePorts, restoreVariables } from '../../utils/config'
import { PORT_TYPE_OPTIONS } from '../../utils/constants'

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

      const portsByType = restorePorts(node.data.ports)

      // --- PARAMETER CLASSIFICATION FOR THIS NODE ---

      const variablesAndUnits = restoreVariables(node.data.variables)
      const { componentFile, componentType } = parseMathRef(node.data.mathRef)
      const { moduleType, moduleSubtype } = parseModuleRef(node.data.moduleRef)

      const moduleData = libraryStore.availableModules.get(node.data.moduleRef)
      if (!moduleData) {
        throw new Error(`Missing module definition '${node.data.moduleRef}' for node '${node.data.name}'`)
      }

      if (!uniqueModuleConfigs.has(node.data.moduleRef)) {
        uniqueModuleConfigs.set(node.data.moduleRef, {
          module_type: moduleType,
          module_subtype: moduleSubtype,
          module_format: 'cellml', // TODO - will need to generalise 
          component_file: componentFile,
          component_type: componentType,
          entrance_ports: portsByType.entrance_ports || [],
          exit_ports: portsByType.exit_ports || [],
          general_ports: portsByType.general_ports || [],
          variables_and_units: variablesAndUnits,
        });
      }

      instance_array.push({
        name: node.data.name,
        module_subtype: moduleSubtype,
        module_type: moduleType,
        inp_instances: inp_instances.join(' '),
        out_instances: out_instances.join(' '),
      })

      // Collect parameters for this node's module
      for (const variable of node.data.variables || []) {
        if (variable.type === 'constant') {
          allParameters.add(JSON.stringify({
            variable_name: `${variable.name}_${node.data.name}`,
            units: variable.units || '',
            value: variable.value || '',
            data_reference: variable.data_reference || 'phlynx',
          }))
        }
      }
    }

    // Convert Map to array
    const module_config = Array.from(uniqueModuleConfigs.values());

    // --- 2. CONSOLIDATE PARAMETER FILES INTO ONE CSV ---
    const globalConstants = libraryStore.globalVariables

    for (const variable of globalConstants) {
      allParameters.add(JSON.stringify({
        variable_name: variable[0],
        units: variable[1].units || '',
        value: variable[1].value || '',
        data_reference: 'phlynx',
      }))
    }

    const consolidatedParameters = Array.from(allParameters).map((paramStr) => JSON.parse(paramStr))

    // --- 3. FINALIZING AND COMPRESSING ZIP ---
    zip.file(`${fileName}_module_config.json`, JSON.stringify(module_config, null, 2))
    zip.file(`${fileName}_module_array.csv`, Papa.unparse(instance_array))
    zip.file(`${fileName}_parameters.csv`, Papa.unparse(consolidatedParameters))
    if (obsData != null) zip.file(`${fileName}_obs_data.json`, obsData)

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
