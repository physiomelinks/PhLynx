/**
 * Species offered without a network lookup: a pinned table of common ChEBI species and their aliases, the terms
 * other sidecars in the workspace use, and pasted CURIEs or IRIs.
 */

import { canonicalCurie, hasPrefix } from './iris.js'

/** Common species, in their physiological charge form where they have one. */
export const SPECIES_ALIASES = [
  { curie: 'CHEBI:29101', label: 'Na⁺', aliases: ['sodium', 'na', 'sodium ion'] },
  { curie: 'CHEBI:29103', label: 'K⁺', aliases: ['potassium', 'k', 'potassium ion'] },
  { curie: 'CHEBI:29108', label: 'Ca²⁺', aliases: ['calcium', 'ca', 'calcium ion'] },
  { curie: 'CHEBI:17996', label: 'Cl⁻', aliases: ['chloride', 'cl'] },
  { curie: 'CHEBI:15378', label: 'H⁺', aliases: ['proton', 'hydrogen ion', 'h'] },
  { curie: 'CHEBI:17544', label: 'HCO₃⁻', aliases: ['bicarbonate', 'hydrogencarbonate', 'hco3'] },
  { curie: 'CHEBI:18420', label: 'Mg²⁺', aliases: ['magnesium', 'mg'] },
  { curie: 'CHEBI:17634', label: 'D-glucose', aliases: ['glucose', 'glc'] },
  { curie: 'CHEBI:15422', label: 'ATP', aliases: ['adenosine triphosphate'] },
  { curie: 'CHEBI:16761', label: 'ADP', aliases: ['adenosine diphosphate'] },
  { curie: 'CHEBI:24838', label: 'Pi', aliases: ['inorganic phosphate', 'phosphate', 'pi'] },
  { curie: 'CHEBI:43474', label: 'HPO₄²⁻', aliases: ['hydrogenphosphate', 'hpo4'] },
  { curie: 'CHEBI:15377', label: 'water', aliases: ['h2o'] },
  { curie: 'CHEBI:15379', label: 'O₂', aliases: ['oxygen', 'dioxygen', 'o2'] },
  { curie: 'CHEBI:16526', label: 'CO₂', aliases: ['carbon dioxide', 'co2'] },
  { curie: 'CHEBI:16651', label: 'L-lactate', aliases: ['lactate', 'lac'] },
  { curie: 'CHEBI:15361', label: 'pyruvate', aliases: ['pyr'] },
  { curie: 'CHEBI:16199', label: 'urea', aliases: [] },
  { curie: 'CHEBI:28938', label: 'NH₄⁺', aliases: ['ammonium', 'nh4'] },
  { curie: 'CHEBI:29985', label: 'L-glutamate', aliases: ['glutamate', 'glu'] },
  { curie: 'CHEBI:29105', label: 'Zn²⁺', aliases: ['zinc', 'zn'] },
]

/** Each pinned species' label by CURIE, for the label provider. */
export const SPECIES_LABELS = new Map(SPECIES_ALIASES.map(({ curie, label }) => [curie, label]))

// Short ASCII names for the pinned species, which name the entities a sidecar shares, e.g. 'local:Na_in'.
const SPECIES_TOKENS = new Map([
  ['CHEBI:29101', 'Na'],
  ['CHEBI:29103', 'K'],
  ['CHEBI:29108', 'Ca'],
  ['CHEBI:17996', 'Cl'],
  ['CHEBI:15378', 'H'],
  ['CHEBI:17544', 'HCO3'],
  ['CHEBI:18420', 'Mg'],
  ['CHEBI:17634', 'Glc'],
  ['CHEBI:15422', 'ATP'],
  ['CHEBI:16761', 'ADP'],
  ['CHEBI:24838', 'Pi'],
  ['CHEBI:43474', 'HPO4'],
  ['CHEBI:15377', 'H2O'],
  ['CHEBI:15379', 'O2'],
  ['CHEBI:16526', 'CO2'],
  ['CHEBI:16651', 'Lac'],
  ['CHEBI:15361', 'Pyr'],
  ['CHEBI:16199', 'Urea'],
  ['CHEBI:28938', 'NH4'],
  ['CHEBI:29985', 'Glu'],
  ['CHEBI:29105', 'Zn'],
])

/**
 * A species' short name for local node names: the pinned table's, e.g. 'Na', else its CURIE as 'CHEBI_29101'.
 * Distinct species never share one.
 *
 * @param {string} curieOrIri
 * @returns {string}
 */
export function speciesToken(curieOrIri) {
  const curie = canonicalCurie(curieOrIri)
  return SPECIES_TOKENS.get(curie) ?? curie.replace(/[^A-Za-z0-9]/g, '_')
}

/**
 * Reads a pasted CURIE or IRI as a ChEBI species.
 *
 * @param {string} text - e.g. 'CHEBI:29101', 'chebi_29101' or 'http://purl.obolibrary.org/obo/CHEBI_29101'.
 * @returns {string|null} The canonical CURIE, or null when the text is not a ChEBI term.
 */
export function parseSpeciesTerm(text) {
  const curie = canonicalCurie(String(text ?? '').trim())
  return hasPrefix(curie, 'CHEBI') && /^CHEBI:\d+$/.test(curie) ? curie : null
}

/**
 * Finds the species matching typed text: a pasted ChEBI term first, then the workspace's terms and the pinned
 * table whose label, alias or CURIE contains it.
 *
 * @param {string} query
 * @param {Object} [options]
 * @param {Iterable<string>} [options.workspaceTerms] - ChEBI CURIEs other sidecars use; listed before the table.
 * @param {(curie: string) => string} [options.labelOf] - A term's label, for workspace terms outside the table.
 * @returns {Array<{ curie: string, label: string, source: 'pasted'|'workspace'|'table' }>}
 */
export function searchSpecies(query, { workspaceTerms = [], labelOf = (curie) => curie } = {}) {
  const text = String(query ?? '').trim().toLowerCase()
  const results = []
  const seen = new Set()
  const add = (item) => {
    if (seen.has(item.curie)) return
    seen.add(item.curie)
    results.push(item)
  }
  const pasted = parseSpeciesTerm(query)
  if (pasted) add({ curie: pasted, label: SPECIES_LABELS.get(pasted) ?? labelOf(pasted), source: 'pasted' })

  const matches = (curie, label, aliases = []) =>
    !text || [curie, label, ...aliases].some((value) => value.toLowerCase().includes(text))
  for (const curie of workspaceTerms) {
    const label = SPECIES_LABELS.get(curie) ?? labelOf(curie)
    const aliases = SPECIES_ALIASES.find((entry) => entry.curie === curie)?.aliases
    if (matches(curie, label, aliases)) add({ curie, label, source: 'workspace' })
  }
  for (const { curie, label, aliases } of SPECIES_ALIASES) {
    if (matches(curie, label, aliases)) add({ curie, label, source: 'table' })
  }
  return results
}
