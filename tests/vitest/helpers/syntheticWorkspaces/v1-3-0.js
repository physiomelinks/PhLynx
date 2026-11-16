/**
 * A synthetic workspace at format 1.3.0. The store may hold a math's source: the CellDL diagram its CellML was
 * generated from, with the element manifest bg2cellml gave it.
 * Written out literally rather than built with the app's helpers, so a change to those shows as a format change.
 */
import { base as base1_2_0 } from './v1-2-0.js'
import { separatedDecayNode } from './v1-1-0.js'

export const version = '1.3.0'

/**
 * Builds the workspace around the cases.
 *
 * @returns {Object}
 */
export const base = () => {
  const doc = base1_2_0()
  doc.version = version
  doc.store.mathSources = []
  return doc
}

const GENERATOR = { name: '@physiomelinks/bg2cellml', version: '0.2.0' }

/** A diagram's document, holding its metadata and the given element ids. */
const document = (ids) =>
  `<svg xmlns="http://www.w3.org/2000/svg"><metadata id="celldl-rdf-metadata" data-content-type="text/turtle"/>${ids
    .map((id) => `<g id="${id}"/>`)
    .join('')}</svg>`

export const cases = {
  /**
   * Node `decay_drawn`'s math was generated from a CellDL diagram: a store whose quantity is x, with rate constant k,
   * on a zero node. The element manifest is keyed by the diagram's element ids, as bg2cellml's `convert()` gives it.
   */
  celldlSource: () => {
    const part = separatedDecayNode('decay_drawn')
    const [mathRef] = part.store.availableMath[0]
    const documentUri = 'https://bg-rdf.org/models/local/phlynx/decay_drawn.celldl'
    const quantity = { name: 'x', role: 'quantity', ucum: 'm', units: 'metre' }
    part.store.mathSources = [
      [
        mathRef,
        {
          format: 'celldl',
          document: document(['ID-00000001', 'ID-00000002']),
          documentUri,
          elements: {
            'ID-00000001': {
              iri: `${documentUri}#ID-00000001`,
              kind: 'element',
              symbol: 'x',
              template: 'https://bg-rdf.org/templates/chemical#QuantityStore',
              label: 'store',
              primary: 'x',
              variables: [quantity, { name: 'k', role: 'parameter', ucum: '/s', units: 'per_second' }],
            },
            'ID-00000002': { iri: `${documentUri}#ID-00000002`, kind: 'zero', symbol: 'x', variables: [quantity] },
          },
          generator: GENERATOR,
          frameworkVersion: '2026-04-12',
        },
      ],
    ]
    return part
  },

  /** Node `decay_blank`'s math is the start of a CellDL module with no diagram drawn yet. */
  blankCelldlSource: () => {
    const part = separatedDecayNode('decay_blank')
    const [mathRef] = part.store.availableMath[0]
    part.store.mathSources = [
      [
        mathRef,
        {
          format: 'celldl',
          document: null,
          documentUri: 'https://bg-rdf.org/models/local/phlynx/decay_blank.celldl',
          elements: {},
          generator: GENERATOR,
          frameworkVersion: '2026-04-12',
        },
      ],
    ]
    return part
  },
}
