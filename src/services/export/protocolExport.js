/**
 * Bundles PhLynx's run of a protocol as SED-ML: protocol.sedml, which protocolSedml.js writes, with the model it runs,
 * in a COMBINE archive's layout.
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
 * Bundles the SED-ML of PhLynx's run with the model it runs, and their manifest.
 *
 * @param {Object} options
 * @param {string} options.sedml - From buildProtocolSedml.
 * @param {string} options.cellml - The model it runs, with the protocol's drivers and clock written in.
 * @returns {Promise<Blob>}
 */
export async function generateProtocolZip({ sedml, cellml }) {
  const zip = new JSZip()
  const entries = [
    { location: BUNDLE_FILES.sedml, format: 'http://identifiers.org/combine.specifications/sed-ml', master: true, content: sedml },
    { location: BUNDLE_FILES.sedmlModel, format: 'http://identifiers.org/combine.specifications/cellml', content: cellml },
  ]
  entries.forEach(({ location, content }) => zip.file(location, content))
  zip.file(BUNDLE_FILES.manifest, buildManifestXml(entries))
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } })
}
