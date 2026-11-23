import path from 'node:path'

import createLibCellML from 'libcellml.js'

import { initLibCellML } from '../../../src/utils/cellml.js'

let bootstrapPromise = null
const wasmPath = path.resolve(process.cwd(), 'node_modules/libcellml.js/libcellml.wasm')

/**
 * Loads libCellML from node_modules and binds it with initLibCellML, so loadLibCellML and the client's main-thread
 * fallback use it. The instance is cached so suites share one load.
 *
 * @returns {Promise<{ instance: Object }>}
 */
export function ensureLibCellmlReady() {
  bootstrapPromise ??= createLibCellML({
    locateFile: (file, prefix) => (file.endsWith('.wasm') ? wasmPath : `${prefix}${file}`),
  }).then((instance) => {
    initLibCellML(instance)
    return { instance }
  })
  return bootstrapPromise
}
