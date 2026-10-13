/**
 * Bundles PhLynx's run as SED-ML with the model it runs, in a COMBINE archive's layout: a protocol's as protocol.sedml,
 * which protocolSedml.js writes, or a time course's, which runSedml.js does.
 */
import JSZip from 'jszip'

import { buildManifestXml } from './omex'
import { SEDML_MODEL } from './protocolSedml'

/** The files of a bundle. */
export const BUNDLE_FILES = {
  sedml: 'protocol.sedml',
  sedmlModel: SEDML_MODEL,
  manifest: 'manifest.xml',
}

/**
 * Bundles the SED-ML of PhLynx's run of a protocol with the model it runs, and their manifest.
 *
 * @param {Object} options
 * @param {string} options.sedml - From buildProtocolSedml.
 * @param {string} options.cellml - The model it runs, with the protocol's drivers and clock written in.
 * @returns {Promise<Blob>}
 */
export const generateProtocolZip = ({ sedml, cellml }) =>
  generateSedmlZip({ sedml, cellml, sedmlName: BUNDLE_FILES.sedml, modelName: BUNDLE_FILES.sedmlModel })

/**
 * Bundles SED-ML with the model it runs, and their manifest, the SED-ML the archive's master file.
 *
 * @param {Object} options
 * @param {string} options.sedml
 * @param {string} options.cellml
 * @param {string} options.sedmlName - The SED-ML's file name.
 * @param {string} options.modelName - The model's, as the SED-ML names it.
 * @returns {Promise<Blob>}
 */
export async function generateSedmlZip({ sedml, cellml, sedmlName, modelName }) {
  const zip = new JSZip()
  const entries = [
    { location: sedmlName, format: 'http://identifiers.org/combine.specifications/sed-ml', master: true, content: sedml },
    { location: modelName, format: 'http://identifiers.org/combine.specifications/cellml', content: cellml },
  ]
  entries.forEach(({ location, content }) => zip.file(location, content))
  zip.file(BUNDLE_FILES.manifest, buildManifestXml(entries))
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } })
}
