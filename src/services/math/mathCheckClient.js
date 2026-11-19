/**
 * Checks math in the libCellML worker (services/libcellml), which falls back to the main thread where Workers are
 * unavailable.
 */
import { withLibraryUnits } from './checkMath'
import { runLibCellML } from '../libcellml/libcellmlClient'

/**
 * Checks a math on its own, with the library's units, off the main thread (see checkModel for what it finds).
 *
 * @param {string} mathXml - A math as libraryStore keeps it.
 * @param {Map<string, Array<Object>>} unitDefinitions - The library's, as libraryStore.unitDefinitions.
 * @returns {Promise<{ invalid: string[], imbalances: string[] }>}
 */
export function checkMathInBackground(mathXml, unitDefinitions) {
  return runLibCellML('checkModel', withLibraryUnits(mathXml, unitDefinitions))
}
