/**
 * Adds a CellDL diagram to the library as a module, with the diagram as its math's source. Load it
 * with import(), as it brings in the converter.
 */
import { CELLDL_USER_MODULES_FILE, PROTECTED_MATH_REFS } from '../../utils/constants.js'
import { parseMathRef } from '../../utils/config.js'
import { cleanName, getUniqueName } from '../../utils/identifiers.js'
import { groupingUnitsAfterSave } from '../userModules.js'
import { convertCelldl, knownUnitsForModule } from './convert.js'
import { mintDocumentUri } from './documentUri.js'
import { undrawnElements, undrawnError } from './drawing.js'

/**
 * Names a diagram's component after its file name, in the CellDL user modules grouping, avoiding, ignoring case,
 * every component the grouping has and the templates'.
 *
 * @param {string} filename - e.g. `my rc.celldl`.
 * @param {Object} libraryStore
 * @returns {{ componentName: string, mathRef: string }} e.g. `my_rc` and `User_Modules.celldl:my_rc`.
 */
export function celldlImportNames(filename, libraryStore) {
  const stem = String(filename ?? '').replace(/\.celldl$/i, '')
  const taken = new Set()
  for (const mathRef of [...libraryStore.availableMath.keys(), ...PROTECTED_MATH_REFS]) {
    const { componentFile, componentName } = parseMathRef(mathRef)
    if (componentFile === CELLDL_USER_MODULES_FILE || PROTECTED_MATH_REFS.has(mathRef)) taken.add(componentName.toLowerCase())
  }

  const componentName = getUniqueName(cleanName(stem) || 'celldl', {
    has: (name) => taken.has(name.toLowerCase()),
  })
  return { componentName, mathRef: `${CELLDL_USER_MODULES_FILE}:${componentName}` }
}

/**
 * Converts a CellDL diagram and adds it to the library: its source, then its math (which creates
 * its module) and its text layout, then its units. Nothing is added if it doesn't convert, the CellDL
 * editor couldn't open it, or its warnings aren't accepted.
 *
 * @param {string} filename
 * @param {string} document - The CellDL SVG.
 * @param {Object} libraryStore
 * @param {Object} [options]
 * @param {(warnings: Object[]) => Promise<boolean>} [options.confirmWarnings] - Asks whether to add a
 *   diagram that converts with warnings; without it, such a diagram is added.
 * @returns {Promise<{ ok: boolean, cancelled?: boolean, mathRef: string, componentName: string,
 *   errors: Object[], warnings: Object[] }>} Issues are bg2cellml's. Rejects if the converter can't start.
 */
export async function importCelldl(filename, document, libraryStore, { confirmWarnings } = {}) {
  const { componentName, mathRef } = celldlImportNames(filename, libraryStore)
  const result = await convertCelldl(document, {
    documentUri: mintDocumentUri(mathRef),
    componentName,
    knownUnits: knownUnitsForModule(libraryStore, mathRef),
  })
  const outcome = { ok: false, mathRef, componentName, errors: result.errors, warnings: result.warnings }
  if (!result.ok) return outcome
  // Only the named component becomes the module, so a source is never stored without its math.
  const components = result.components.filter((component) => component.name === componentName)
  if (!components.length) {
    const message = `The diagram's CellML has no component named ${componentName}`
    return { ...outcome, errors: [{ message, severity: 'error', stage: 'build' }] }
  }
  // Its CellDL tab would fail to open a diagram that converts but doesn't draw its elements.
  const undrawn = undrawnElements(document, Object.keys(result.elements ?? {}))
  if (undrawn.length) return { ...outcome, errors: [undrawnError(undrawn)] }
  if (result.warnings.length && confirmWarnings && !(await confirmWarnings(result.warnings))) {
    return { ...outcome, cancelled: true }
  }

  libraryStore.setMathSource(mathRef, {
    format: 'celldl',
    document,
    documentUri: result.documentUri,
    elements: result.elements,
    generator: result.generator,
    frameworkVersion: result.frameworkVersion,
  })
  // The grouping's units first, as they are worked out from its other modules' math.
  const units = groupingUnitsAfterSave(libraryStore, mathRef, result.unitsModel)
  libraryStore.addMathFile(CELLDL_USER_MODULES_FILE, components)
  // Its sections' headings, which the CellML Text tab shows.
  libraryStore.setMathLayout(mathRef, result.layout ?? null)
  if (units.model) libraryStore.addUnitsFile(units)
  return { ...outcome, ok: true }
}
