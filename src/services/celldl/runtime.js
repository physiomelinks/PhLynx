/**
 * The CellDL converter: bg2cellml with PhLynx's libCellML and the CellDL editor's oxigraph and
 * BG-RDF framework, so PhLynx ships one oxigraph. Both packages are imported only dynamically, so
 * they load when a CellDL module first needs converting.
 * bg2cellml never imports oxigraph, and only uses the module it is given; PhLynx's own oxigraph is
 * for the live conversion's worker alone (useLiveCelldlConvert).
 */
import { whenLibCellMLReady } from '../../utils/cellml.js'

let converterPromise = null

/**
 * Creates a converter with the BG-RDF framework loaded.
 *
 * @returns {Promise<Object>} A bg2cellml Converter.
 */
async function createConverter() {
  const [libcellml, editor, { Converter }] = await Promise.all([
    whenLibCellMLReady(),
    import('@celldl/editor'),
    import('@physiomelinks/bg2cellml'),
  ])
  const oxigraph = await editor.initialiseRdf()
  const converter = new Converter({ libcellml, oxigraph })
  const issues = converter.loadFramework({ quads: editor.bgRdfStatements() })
  if (issues.length) throw new Error(`The BG-RDF framework didn't load: ${issues.join('; ')}`)
  return converter
}

/**
 * Gets the shared converter, creating it on first use. A failure isn't kept, so the next call
 * tries again.
 *
 * @returns {Promise<Object>} A bg2cellml Converter.
 */
export function getConverter() {
  converterPromise ??= createConverter().catch((error) => {
    converterPromise = null
    throw error
  })
  return converterPromise
}
