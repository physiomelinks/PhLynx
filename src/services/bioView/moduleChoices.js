/**
 * The library modules the physiological view's dialogs offer, in the order they are offered.
 */

import { NEW_INSTANCE_MODULE_REF } from '../../utils/constants.js'

/**
 * Lists modules to choose from: a new module first, then those whose annotations say they are the kind wanted,
 * then the rest, each by reference.
 *
 * @param {Iterable<{moduleRef: string, mathRef?: string}>} modules - The library's.
 * @param {(module: Object) => string|null} kindOf - What a module's annotations say it is.
 * @param {string} kind - e.g. 'compartment' or 'membrane'.
 * @returns {Array<{moduleRef: string, label: string, match: boolean}>}
 */
export function moduleChoices(modules, kindOf, kind) {
  const isNew = (choice) => Number(choice.moduleRef === NEW_INSTANCE_MODULE_REF)
  return [...modules]
    .filter((module) => module.mathRef)
    .map((module) => {
      const match = kindOf(module) === kind
      return { moduleRef: module.moduleRef, label: match ? `${module.moduleRef} (${kind})` : module.moduleRef, match }
    })
    .sort((a, b) => isNew(b) - isNew(a) || Number(b.match) - Number(a.match) || a.moduleRef.localeCompare(b.moduleRef))
}
