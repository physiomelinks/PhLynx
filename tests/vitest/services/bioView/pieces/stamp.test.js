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

describe('stampTemplate into a compartment', () => {
  const HOST = Object.freeze([
    {
      id: 'interstitium',
      kind: 'compartment',
      label: 'Interstitium',
      frame: { x: 100, y: 50, width: 1200, height: 900 },
    },
  ])
  const into = (pieces) => {
    const rect = layoutPieces(pieces).rects.get('interstitium')
    return { id: 'interstitium', corner: { x: rect.x, y: rect.y } }
  }

  it('stands what stood on the canvas in the compartment, its corner where it was dropped', () => {
    const template = getBuiltInPieceTemplate('cell')
    const { pieces, errors } = stampTemplate(HOST, template, { x: 300, y: 250 }, { into: into(HOST) })
    expect(errors).toEqual([])
    const roots = template.pieces.filter((piece) => !piece.parent && ['compartment', 'membrane'].includes(piece.kind))
    expect(roots.length).toBeGreaterThan(0)
    for (const root of roots) expect(pieces.find((piece) => piece.id === root.id).parent).toBe('interstitium')
    // Laid out, the template's corner is where it was dropped, inside the compartment.
    const { rects } = layoutPieces(pieces)
    const added = template.pieces.map((piece) => rects.get(piece.id)).filter(Boolean)
    expect(Math.min(...added.map((rect) => rect.x))).toBe(300)
    expect(Math.min(...added.map((rect) => rect.y))).toBe(250)
    const host = rects.get('interstitium')
    for (const rect of added) {
      expect(rect.x + rect.width).toBeLessThanOrEqual(host.x + host.width)
      expect(rect.y + rect.height).toBeLessThanOrEqual(host.y + host.height)
    }
  })

  it.each(['epithelial-cell', 'two-cell-epithelium', 'cardiomyocyte', 'chemical-synapse', 'rod-photoreceptor'])(
    'puts the %s template in a compartment',
    (id) => {
      const template = getBuiltInPieceTemplate(id)
      const { pieces, errors } = stampTemplate(HOST, template, { x: 150, y: 100 }, { into: into(HOST) })
      expect(errors).toEqual([])
      // Nothing it adds is left on the canvas.
      const added = pieces.filter((piece) => piece.id !== 'interstitium')
      expect(added.filter((piece) => ['compartment', 'membrane'].includes(piece.kind) && !piece.parent)).toEqual([])
    },
  )

  it('still puts a template on the canvas where it is dropped in none', () => {
    const template = getBuiltInPieceTemplate('cell')
    const { pieces } = stampTemplate(HOST, template, { x: 2000, y: 0 })
    for (const piece of template.pieces) {
      expect(pieces.find((each) => each.id === piece.id).parent).toBe(piece.parent)
    }
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
