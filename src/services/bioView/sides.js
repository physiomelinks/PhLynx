/**
 * Which side of its membrane a protein's annotated quantity is on. The annotations place a protein's quantities
 * with GO cellular components; this is the one place that reads them as sides, so another reading (another
 * cell's terms, or a template's) can be added here later.
 */

import { GO } from '../annotations/iris.js'

/**
 * Gives the side a sidecar location puts a protein's quantity on.
 *
 * @param {string|null|undefined} location - A sidecar location: a GO CURIE, 'self' or 'self+<GO CURIE>'.
 * @returns {'outside'|'inside'|'membrane'|null} 'membrane' for the membrane or the protein itself; null when the
 *   location says nothing of a side.
 */
export function sideOf(location) {
  if (!location) return null
  const go = location.startsWith('self+') ? location.slice('self+'.length) : location
  if (go === GO.extracellularRegion) return 'outside'
  if (go === GO.cytoplasm) return 'inside'
  if (go === GO.plasmaMembrane || location === 'self') return 'membrane'
  return null
}
