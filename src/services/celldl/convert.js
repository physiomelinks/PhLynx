/**
 * Converts a CellDL diagram to a PhLynx module: bg2cellml's CellML, split into its component and
 * units as a CellML import is. Load it with import(), as it brings in the converter.
 */
import { processCellMLData } from '../../utils/cellml.js'
import { documentUriFor } from './documentUri.js'
import { getConverter } from './runtime.js'

export { knownUnitsFor, knownUnitsForModule } from './knownUnits.js'

/** An error of the converter's shape, for a failure it gives no issue for. */
const errorIssue = (message, stage) => ({ message, severity: 'error', stage })

/**
 * Errors that keep the CellML from being used. A conversion is never ok without one, so there is
 * always something to show.
 */
function blockingErrors(result) {
  if (result.ok || result.errors.length) return result.errors
  if (result.exception) return [errorIssue(`The converter failed: ${result.exception.split('\n')[0]}`, 'build')]
  if (!result.cellml) return [errorIssue('The diagram gave no CellML', 'build')]
  return [errorIssue(`The diagram's model can't be simulated (its type is ${result.modelType ?? 'unknown'})`, 'analyser')]
}

/**
 * Converts a CellDL document.
 *
 * @param {string} document - The CellDL SVG.
 * @param {Object} options
 * @param {string} options.documentUri - The IRI to read the document under (mintDocumentUri).
 * @param {string} options.componentName - The CellML component's name.
 * @param {string[]} [options.knownUnits] - The library's other units (knownUnitsFor).
 * @returns {Promise<Object>} `{ ok, components, unitsModel, elements, annotations, documentUri, generator,
 *   frameworkVersion, unitSystem, errors, warnings, renamedUnits }`. The unit system ('si' or 'cellular') is the
 *   diagram's own, from its triple; a diagram without one is SI. `components` and `unitsModel` are as
 *   processCellMLData gives them, and null unless ok. Issues are bg2cellml's
 *   `{ message, severity, stage, subject?, elementId? }`. Rejects if the converter can't start.
 */
export async function convertCelldl(document, { documentUri, componentName, knownUnits } = {}) {
  const [converter, { toViewerAnnotations }] = await Promise.all([
    getConverter(),
    import('@physiomelinks/bg2cellml'),
  ])
  const result = await converter.convert(document, {
    sourceUri: documentUri,
    componentName,
    ...(knownUnits?.length ? { knownUnits } : {}),
  })
  let errors = blockingErrors(result)
  let processed = null
  if (!errors.length) {
    processed = processCellMLData(result.cellml)
    if (processed.type !== 'success') {
      errors = processed.issues.map((issue) => errorIssue(issue.description, 'build'))
      processed = null
    }
  }
  return {
    ok: !errors.length,
    components: processed?.components ?? null,
    unitsModel: processed?.units.model ?? null,
    elements: result.elements,
    annotations: toViewerAnnotations(result.elements),
    documentUri: documentUriFor(result),
    generator: result.generator,
    frameworkVersion: result.framework.version ?? null,
    unitSystem: result.unitSystem ?? null,
    errors,
    warnings: result.warnings,
    renamedUnits: result.units.renamed,
  }
}
