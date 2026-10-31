/**
 * What a membrane protein carries across its membrane, for the arrows on its cartoon. The annotations
 * say which species cross, but not which way: that is the sign of the protein's flows, known once the
 * model has run.
 *
 * Flows follow the convention of PhLynx's modules: a molar flow rate annotated as in a place is the rate
 * into that place, since compartments add up the flows coupled to them (dc/dt = Γ·Σv). So a positive
 * flow inside the cell means the species is going in.
 */

import { CHEBI, GO, OPB } from '../annotations/iris.js'

/** Short names for the species the annotations use. */
const SPECIES_LABELS = new Map([
  [CHEBI.sodium, 'Na⁺'],
  [CHEBI.potassium, 'K⁺'],
  [CHEBI.glucose, 'Glc'],
  [CHEBI.proton, 'H⁺'],
  [CHEBI.atp, 'ATP'],
  [CHEBI.adp, 'ADP'],
  [CHEBI.phosphate, 'Pᵢ'],
])

/**
 * Gives a species' short name.
 *
 * @param {string} chebi - A CHEBI CURIE.
 * @returns {string}
 */
export function speciesLabel(chebi) {
  return SPECIES_LABELS.get(chebi) ?? chebi
}

/**
 * Finds the species a protein carries across its membrane: those with a molar flow both inside the cell
 * and outside it.
 *
 * @param {Object|null} sidecar - From parseSidecar.
 * @returns {Array<{species: string, label: string, inside: string, outside: string}>} With the names of the
 *   flow variables on each side, in the order the sidecar first gives them.
 */
export function transportedSpecies(sidecar) {
  const flows = new Map()
  for (const { variable, property, species, location } of sidecar?.variables ?? []) {
    if (property !== OPB.molarFlowRate || species?.length !== 1) continue
    const side = location === GO.cytoplasm ? 'inside' : location === GO.extracellularRegion ? 'outside' : null
    if (!side) continue
    const entry = flows.get(species[0]) ?? { species: species[0], label: speciesLabel(species[0]) }
    entry[side] ??= variable
    flows.set(species[0], entry)
  }
  return [...flows.values()].filter((entry) => entry.inside && entry.outside)
}

/**
 * Tells which way a species went, from its flow into the cell at the end of a run.
 *
 * @param {ArrayLike<number>|null|undefined} inward - The inside flow's values over the run.
 * @param {number} [tolerance=1e-12] - Smaller flows count as none.
 * @returns {'in'|'out'|null} null without a run, or when nothing is flowing.
 */
export function flowDirection(inward, tolerance = 1e-12) {
  if (!inward?.length) return null
  const last = inward[inward.length - 1]
  if (!Number.isFinite(last) || Math.abs(last) <= tolerance) return null
  return last > 0 ? 'in' : 'out'
}
