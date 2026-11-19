import { describe, expect, it } from 'vitest'

import { getBuiltInPieceTemplate } from '../../../../../src/services/bioView/pieces/builtInTemplates.js'
import { layoutPieces, pieceKey } from '../../../../../src/services/bioView/pieces/layout.js'
import { freeId, stampTemplate } from '../../../../../src/services/bioView/pieces/stamp.js'

const NONE = Object.freeze([])

describe('stampTemplate', () => {
  it('adds copies of a template’s pieces, its corner where it was dropped', () => {
    const template = getBuiltInPieceTemplate('epithelial-cell')
    const { pieces, errors } = stampTemplate(NONE, template, { x: 500, y: 300 })
    expect(errors).toEqual([])
    expect(pieces.map((piece) => piece.id)).toEqual(template.pieces.map((piece) => piece.id))
    // Laid out, the template's corner, the fluids round its cell and all, is where it was dropped.
    const rects = [...layoutPieces(pieces).places.values()].filter((place) => place.rect).map((place) => place.rect)
    expect(Math.min(...rects.map((rect) => rect.x))).toBe(500)
    expect(Math.min(...rects.map((rect) => rect.y))).toBe(300)
    // The cell inside them, the same as in the template.
    const own = layoutPieces(template.pieces).places
    const cell = layoutPieces(pieces).places.get(pieceKey('plasma-membrane')).rect
    expect(cell.x - 500).toBe(
      own.get(pieceKey('plasma-membrane')).rect.x -
        Math.min(...[...own.values()].filter((p) => p.rect).map((p) => p.rect.x)),
    )
  })

  it('gives copies of a template dropped again ids of their own, and rewrites what they name', () => {
    const template = getBuiltInPieceTemplate('epithelial-cell')
    const first = stampTemplate(NONE, template, { x: 0, y: 0 }).pieces
    const { pieces, ids, errors } = stampTemplate(first, template, { x: 800, y: 0 })
    expect(errors).toEqual([])
    expect(pieces).toHaveLength(2 * template.pieces.length)
    expect(ids.get('plasma-membrane')).toBe('plasma-membrane-2')
    expect(ids.get('cell')).toBe('cell-2')
    const membrane = pieces.find((piece) => piece.id === 'plasma-membrane-2')
    expect(membrane.encloses).toEqual(['cell-2'])
    expect(pieces.find((piece) => piece.id === 'apical-fluid-2').docks[0].on).toBe('plasma-membrane-2')
    expect(pieces.find((piece) => piece.id === 'metabolism-2').compartment).toBe('cell-2')
  })

  it('keeps an organelle’s place in the compartment it stands in', () => {
    const template = getBuiltInPieceTemplate('cardiomyocyte')
    const { pieces } = stampTemplate(NONE, template, { x: 100, y: 100 })
    expect(pieces.find((piece) => piece.id === 'sr-membrane').frame).toEqual(
      template.pieces.find((piece) => piece.id === 'sr-membrane').frame,
    )
  })

  it('puts the whole template, bands and all, from where it was dropped', () => {
    const template = getBuiltInPieceTemplate('two-cell-epithelium')
    const { pieces } = stampTemplate(NONE, template, { x: 0, y: 0 })
    const [a, b] = ['a-membrane', 'b-membrane'].map((id) => pieces.find((piece) => piece.id === id).frame)
    expect(b.x - a.x).toBe(440)
  })
})

describe('freeId', () => {
  it('numbers an id taken already, within 32 characters', () => {
    expect(freeId('cell', new Set())).toBe('cell')
    expect(freeId('cell', new Set(['cell', 'cell-2']))).toBe('cell-3')
    const long = 'a'.repeat(32)
    expect(freeId(long, new Set([long]))).toBe(`${'a'.repeat(30)}-2`)
  })
})
