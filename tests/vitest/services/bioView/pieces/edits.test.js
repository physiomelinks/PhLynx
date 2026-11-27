import { describe, expect, it } from 'vitest'

import { getBuiltInPieceTemplate } from '../../../../../src/services/bioView/pieces/builtInTemplates.js'
import {
  mergeFreeSpans,
  relabelPiece,
  removePieces,
  removedWith,
  skinPiece,
} from '../../../../../src/services/bioView/pieces/edits.js'
import { validatePieces, writtenPieces } from '../../../../../src/services/bioView/pieces/model.js'
import { topologyOf } from '../../../../../src/services/bioView/pieces/topology.js'

const valid = (raw) => {
  const { pieces, errors } = validatePieces(raw)
  expect(errors).toEqual([])
  return pieces
}
const byId = (pieces, id) => pieces.find((piece) => piece.id === id)
const ids = (pieces) => pieces.map((piece) => piece.id)

const cardiomyocyte = valid(getBuiltInPieceTemplate('cardiomyocyte').pieces)
const rod = valid(getBuiltInPieceTemplate('rod-photoreceptor').pieces)

describe('writtenPieces', () => {
  it('writes each side’s spans as a file has them, which validate to the same pieces, warning of nothing', () => {
    for (const pieces of [cardiomyocyte, rod]) {
      const written = writtenPieces(pieces)
      for (const membrane of written.filter((piece) => piece.kind === 'membrane')) {
        for (const spans of Object.values(membrane.sides)) {
          expect(spans.every((span) => !('from' in span))).toBe(true)
          expect('to' in spans.at(-1)).toBe(false)
        }
      }
      expect(validatePieces(written)).toEqual({ pieces, errors: [], warnings: [] })
    }
  })
})

describe('relabelPiece and skinPiece', () => {
  it('renames a piece, or a stretch of a membrane, and refuses a blank name or one that isn’t there', () => {
    expect(byId(valid(relabelPiece(cardiomyocyte, 'sr', 'SR lumen')), 'sr').label).toBe('SR lumen')
    const span = topologyOf(cardiomyocyte).spansOf('sr-membrane')[0]
    const renamed = valid(relabelPiece(cardiomyocyte, `sr-membrane.${span.id}`, ' Network SR '))
    expect(topologyOf(renamed).spansOf('sr-membrane')[0]).toMatchObject({ id: span.id, label: 'Network SR' })
    expect(relabelPiece(cardiomyocyte, 'sr', '  ')).toBeNull()
    expect(relabelPiece(cardiomyocyte, 'nowhere', 'X')).toBeNull()
    expect(relabelPiece(cardiomyocyte, 'sr-membrane.nowhere', 'X')).toBeNull()
  })

  it('draws a membrane or compartment with a skin, or plain, but nothing else', () => {
    const skinned = valid(skinPiece(cardiomyocyte, 'sarcolemma', { ref: 'myocyte', mode: 'cover' }))
    expect(byId(skinned, 'sarcolemma').skin).toMatchObject({ ref: 'myocyte', mode: 'cover' })
    expect(byId(valid(skinPiece(skinned, 'sarcolemma', null)), 'sarcolemma').skin).toBeUndefined()
    expect(skinPiece(cardiomyocyte, 't-tubule', { ref: 'x' })).toBeNull()
  })
})

describe('removePieces', () => {
  it('takes a cell whole: its membrane, inside, fluids, folds, organelles and zones', () => {
    const going = removedWith(cardiomyocyte, ['sarcolemma', 'myocyte'])
    expect(going.size).toBe(cardiomyocyte.length)
    expect(valid(removePieces(cardiomyocyte, ['sarcolemma', 'myocyte']).pieces)).toEqual([])
  })

  it('takes a membrane alone, leaving its inside where it was, with what stands in it', () => {
    const { pieces: raw, removed } = removePieces(cardiomyocyte, ['sarcolemma'])
    const left = valid(raw)
    // The fluid outside, the fold and the cleft docked to the fold go with it; the inside and the SR stay.
    expect([...removed].sort()).toEqual(['cleft', 'extracellular', 'sarcolemma', 't-tubule'])
    expect(ids(left)).toContain('myocyte')
    expect(ids(left)).toContain('sr-membrane')
    expect(byId(left, 'myocyte').frame).toEqual(byId(cardiomyocyte, 'sarcolemma').frame)
  })

  it('takes an organelle’s lumen with its membrane, and a compartment with the tubes to it', () => {
    expect([...removedWith(cardiomyocyte, ['sr'])].sort()).toEqual(['cleft', 'sr', 'sr-membrane'].sort())
    const joined = valid([
      { id: 'a', kind: 'compartment', label: 'A', frame: { x: 0, y: 0, width: 200, height: 100 } },
      { id: 'b', kind: 'compartment', label: 'B', frame: { x: 400, y: 0, width: 200, height: 100 } },
      { id: 't', kind: 'tube', label: 'T', ends: ['a', 'b'] },
    ])
    expect(ids(valid(removePieces(joined, ['b']).pieces))).toEqual(['a'])
  })

  it('makes a gap junction a flow when one of its cells loses its membrane', () => {
    const cells = valid([
      { id: 'a', kind: 'compartment', label: 'A' },
      { id: 'am', kind: 'membrane', label: 'AM', encloses: ['a'], frame: { x: 0, y: 0, width: 200, height: 120 } },
      { id: 'b', kind: 'compartment', label: 'B' },
      { id: 'bm', kind: 'membrane', label: 'BM', encloses: ['b'], frame: { x: 200, y: 0, width: 200, height: 120 } },
      { id: 'gj', kind: 'tube', label: 'Gap junction', ends: ['a', 'b'], flux: 'junction' },
    ])
    const left = valid(removePieces(cells, ['bm']).pieces)
    expect(byId(left, 'gj')).toMatchObject({ flux: 'flow', label: 'Tube' })
  })

  it('leaves the pieces to say why when what is left doesn’t hold together', () => {
    // The rod's segments are docked along its membrane with no inside of its own: without one, a stretch meets nothing.
    const segment = rod.find((piece) => piece.kind === 'compartment' && piece.docks?.length)
    const { errors } = validatePieces(removePieces(rod, [segment.id]).pieces)
    expect(errors.length).toBeGreaterThan(0)
  })
})

describe('mergeFreeSpans', () => {
  /** A cell whose top an undocked compartment left in three, a template's named stretch on its bottom. */
  const cut = (extra = []) =>
    valid([
      { id: 'cell', kind: 'compartment', label: 'Cell' },
      {
        id: 'pm',
        kind: 'membrane',
        label: 'PM',
        encloses: ['cell'],
        frame: { x: 0, y: 0, width: 400, height: 300 },
        sides: {
          top: [
            { id: 'top', label: 'Membrane (top)', to: 0.3 },
            { id: 'x', label: 'PM (X)', to: 0.6 },
            { id: 'top-2', label: 'Membrane (top)' },
          ],
          bottom: [
            { id: 'bottom', label: 'PM (bottom)', to: 0.5 },
            { id: 'basal', label: 'Basal membrane' },
          ],
        },
      },
      ...extra,
    ])
  const tops = (pieces) =>
    topologyOf(valid(pieces))
      .spansOf('pm')
      .filter((span) => span.side === 'top')
      .map(({ id, from, to }) => [id, from, to])

  it('joins the stretches a dock that left cut, but not a template’s named one', () => {
    expect(tops(mergeFreeSpans(cut(), new Set()))).toEqual([['top', 0, 1]])
    // The bottom's named stretch stays.
    const bottom = topologyOf(valid(mergeFreeSpans(cut(), new Set()))).spansOf('pm').filter((s) => s.side === 'bottom')
    expect(bottom.map((span) => span.id)).toEqual(['bottom', 'basal'])
  })

  it('keeps apart a stretch with a module on it, and those a dock still starts or ends at', () => {
    expect(mergeFreeSpans(cut(), new Set(['pm.x']))).toBeNull()
    const docked = cut([
      { id: 'x', kind: 'compartment', label: 'X', docks: [{ on: 'pm', side: 'top', face: 'outside', from: 0.3, to: 0.6 }] },
    ])
    expect(mergeFreeSpans(docked, new Set())).toBeNull()
  })
})
