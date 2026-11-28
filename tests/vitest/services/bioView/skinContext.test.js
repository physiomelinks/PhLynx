import { describe, expect, it } from 'vitest'

import { validatePieces } from '../../../../src/services/bioView/pieces/model.js'
import { topologyOf } from '../../../../src/services/bioView/pieces/topology.js'
import { contextOfModule, contextOfPiece } from '../../../../src/services/bioView/skinContext.js'
import { CARDIOMYOCYTE, CHEMICAL_SYNAPSE, ROD, TWO_CELL_EPITHELIUM } from '../../fixtures/pieces.js'

/** Each piece's target, by id; fails the test on any error. */
function targets(raw) {
  const { pieces, errors } = validatePieces(raw)
  expect(errors).toEqual([])
  const topology = topologyOf(pieces)
  return Object.fromEntries(pieces.map((piece) => [piece.id, contextOfPiece(topology, piece.id)?.target ?? null]))
}

describe('what a module is, for its skin', () => {
  it('is a protein in its membrane or a process, with its annotations as its terms', () => {
    expect(contextOfModule('membraneProtein', ['GO:0005412'])).toEqual({
      family: 'module',
      target: 'protein',
      terms: ['GO:0005412'],
    })
    expect(contextOfModule('cytosolic')).toMatchObject({ family: 'module', target: 'process', terms: [] })
    for (const role of ['membrane', 'cytosol', 'region', 'none']) expect(contextOfModule(role, ['GO:1'])).toBeNull()
  })
})

describe('what a piece is, for its skin', () => {
  it('gives a cell its cytosol and plasma membrane, an organelle its own, and a cleft within it a subcompartment', () => {
    expect(targets(CARDIOMYOCYTE)).toEqual({
      myocyte: 'cytosol',
      'myocyte-membrane': 'plasmaMembrane',
      't-tubule': null,
      myofilaments: null,
      mitochondria: null,
      sr: 'organelle',
      'sr-membrane': 'organelleMembrane',
      extracellular: 'extracellular',
      cleft: 'subcompartment',
    })
  })

  it('makes a rod’s segments subcompartments, with their terms, and its cilium a bridge', () => {
    const { pieces } = validatePieces(ROD)
    const topology = topologyOf(pieces)
    expect(contextOfPiece(topology, 'outer-segment')).toEqual({
      family: 'area',
      target: 'subcompartment',
      terms: ['GO:0001750'],
    })
    expect(targets(ROD)).toMatchObject({
      'inner-segment': 'subcompartment',
      'rod-membrane': 'plasmaMembrane',
      cilium: 'bridge',
      extracellular: 'extracellular',
    })
  })

  it('reads the space between cells as extracellular', () => {
    expect(targets(CHEMICAL_SYNAPSE)).toMatchObject({
      cleft: 'extracellular',
      pre: 'cytosol',
      'post-membrane': 'plasmaMembrane',
    })
    expect(targets(TWO_CELL_EPITHELIUM)).toMatchObject({ paracellular: 'extracellular', a: 'cytosol' })
  })

  it('keeps a cell standing in an extracellular compartment a cell', () => {
    expect(
      targets([
        { id: 'blood', kind: 'compartment', label: 'Blood', frame: { x: 0, y: 0, width: 800, height: 600 } },
        { id: 'rbc', kind: 'compartment', label: 'Red cell', parent: 'blood' },
        { id: 'rbc-membrane', kind: 'membrane', label: 'Membrane', parent: 'blood', encloses: ['rbc'] },
      ]),
    ).toEqual({ blood: 'extracellular', rbc: 'cytosol', 'rbc-membrane': 'plasmaMembrane' })
  })

  it('gives each tube its target by its flux', () => {
    const tube = (flux) => ({ id: `t-${flux}`, kind: 'tube', label: flux, ends: ['a', 'b'], flux })
    expect(
      targets([
        { id: 'a', kind: 'compartment', label: 'A' },
        { id: 'b', kind: 'compartment', label: 'B' },
        ...['flow', 'junction', 'bridge', 'diffusion'].map(tube),
      ]),
    ).toMatchObject({
      't-flow': 'conduit',
      't-junction': 'gapJunction',
      't-bridge': 'bridge',
      't-diffusion': 'diffusion',
    })
  })
})
