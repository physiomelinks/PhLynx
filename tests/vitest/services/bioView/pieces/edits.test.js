import { describe, expect, it } from 'vitest'

import { getBuiltInPieceTemplate } from '../../../../../src/services/bioView/pieces/builtInTemplates.js'
import { relabelPiece, removePieces, removedWith, skinPiece } from '../../../../../src/services/bioView/pieces/edits.js'
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

  it('leaves the pieces to say why when what is left doesn’t hold together', () => {
    // The rod's segments are docked along its membrane with no inside of its own: without one, a stretch meets nothing.
    const segment = rod.find((piece) => piece.kind === 'compartment' && piece.docks?.length)
    const { errors } = validatePieces(removePieces(rod, [segment.id]).pieces)
    expect(errors.length).toBeGreaterThan(0)
  })
})
