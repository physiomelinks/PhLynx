/**
 * Ontology labels for annotation chips. A provider asks its sources in order, so an ApiNATOMY source can be
 * placed ahead of the built-in table later.
 */

import { canonicalCurie } from './iris.js'

export const BUILT_IN_LABELS = new Map([
  // OPB properties (ids TO-VERIFY, see iris.js)
  ['OPB:00340', 'concentration'],
  ['OPB:00592', 'molar flow rate'],
  ['OPB:00154', 'fluid volume'],
  ['OPB:00295', 'spatial area'],
  ['OPB:00506', 'electrical potential'],
  ['OPB:00318', 'charge flow rate'],
  // CHEBI species
  ['CHEBI:29101', 'Na⁺'],
  ['CHEBI:29103', 'K⁺'],
  ['CHEBI:17634', 'D-glucose'],
  ['CHEBI:15378', 'H⁺'],
  ['CHEBI:15422', 'ATP'],
  ['CHEBI:16761', 'ADP'],
  ['CHEBI:43474', 'Pi'],
  // GO cellular components, activities and processes
  ['GO:0005737', 'cytoplasm'],
  ['GO:0005576', 'extracellular region'],
  ['GO:0005886', 'plasma membrane'],
  ['GO:0005412', 'glucose:sodium symporter activity'],
  ['GO:0055056', 'D-glucose transmembrane transporter activity'],
  ['GO:0005391', 'P-type sodium:potassium-exchanging transporter activity'],
  ['GO:0005242', 'inward rectifier potassium channel activity'],
  ['GO:0006096', 'glycolytic process'],
  // SBO
  ['SBO:0000290', 'physical compartment'],
])

/**
 * A label source backed by a Map of CURIE to label.
 *
 * @param {Map<string, string>} table
 * @returns {{ labelFor: (curie: string) => string|undefined }}
 */
export function createTableSource(table) {
  return { labelFor: (curie) => table.get(curie) }
}

/**
 * Creates a label provider that asks each source in turn, by canonical CURIE.
 *
 * @param {Array<{ labelFor: Function }>} sources - Earlier sources win.
 * @returns {{ labelFor: (iriOrCurie: string) => string|undefined, addSource: (source: object) => void }}
 */
export function createLabelProvider(sources = [createTableSource(BUILT_IN_LABELS)]) {
  const ordered = [...sources]
  return {
    labelFor(iriOrCurie) {
      const curie = canonicalCurie(iriOrCurie)
      for (const source of ordered) {
        const label = source.labelFor(curie)
        if (label) return label
      }
      return undefined
    },
    addSource(source) {
      ordered.unshift(source)
    },
  }
}

const defaultProvider = createLabelProvider()

/**
 * Looks up a label with the default provider.
 *
 * @param {string} iriOrCurie
 * @returns {string|undefined}
 */
export function labelFor(iriOrCurie) {
  return defaultProvider.labelFor(iriOrCurie)
}

/**
 * Returns a display label, falling back to the CURIE.
 *
 * @param {string} iriOrCurie
 * @returns {string}
 */
export function displayLabel(iriOrCurie) {
  return labelFor(iriOrCurie) ?? canonicalCurie(iriOrCurie)
}

/**
 * Puts a source ahead of the default provider's built-in table.
 *
 * @param {{ labelFor: Function }} source
 */
export function addLabelSource(source) {
  defaultProvider.addSource(source)
}
