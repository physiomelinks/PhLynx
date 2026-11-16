import { describe, expect, it } from 'vitest'

import { CELL_RADIUS, GLYPH_HEIGHT } from '../../../../src/services/bioView/geometry.js'
import {
  CARD,
  GAP,
  REGION_HEIGHT,
  SIDE_REGION_WIDTH,
  compartmentRect,
  formOfAgainst,
  layoutPhysiology,
  processSlot,
} from '../../../../src/services/bioView/layout.js'

const rects = new Map([
  ['a', { x: 0, y: 0, width: 320, height: 240 }],
  ['b', { x: 500, y: 20, width: 320, height: 200 }],
  ['c', { x: 0, y: 400, width: 320, height: 240 }],
])
const at = (cellKey, edge) => ({ cellKey, edge })

describe('compartment forms', () => {
  it('tells bands, columns, gaps and free compartments apart', () => {
    expect(formOfAgainst([])).toBe('free')
    expect(formOfAgainst([at('a', 'top'), at('b', 'top')])).toBe('band')
    expect(formOfAgainst([at('a', 'right')])).toBe('column')
    expect(formOfAgainst([at('a', 'right'), at('b', 'left')])).toBe('gap')
    expect(formOfAgainst([at('a', 'bottom'), at('c', 'top')])).toBe('gap')
  })
})

describe('compartment rects', () => {
  it('runs a band across its cells, the first reaching under their corners and later ones stacking outward', () => {
    const across = { x: -GAP, width: 820 + 2 * GAP }
    expect(compartmentRect('band', [at('a', 'top'), at('b', 'top')], 0, rects)).toEqual({
      ...across,
      y: -REGION_HEIGHT,
      height: REGION_HEIGHT + CELL_RADIUS,
    })
    expect(compartmentRect('band', [at('a', 'top'), at('b', 'top')], 1, rects)).toEqual({ ...across, y: -2 * REGION_HEIGHT, height: REGION_HEIGHT })
    expect(compartmentRect('band', [at('a', 'bottom'), at('b', 'bottom')], 0, rects)).toEqual({
      ...across,
      y: 240 - CELL_RADIUS,
      height: REGION_HEIGHT + CELL_RADIUS,
    })
    expect(compartmentRect('band', [at('a', 'bottom')], 1, rects, 60)).toEqual({ x: -GAP, width: 320 + 2 * GAP, y: 300, height: 60 })
  })

  it('runs a column down one side of its cell', () => {
    expect(compartmentRect('column', [at('a', 'right')], 0, rects)).toEqual({
      x: 320 - CELL_RADIUS,
      y: 0,
      width: SIDE_REGION_WIDTH + CELL_RADIUS,
      height: 240,
    })
    expect(compartmentRect('column', [at('a', 'right')], 1, rects)).toEqual({ x: 320 + SIDE_REGION_WIDTH, y: 0, width: SIDE_REGION_WIDTH, height: 240 })
    expect(compartmentRect('column', [at('b', 'left')], 0, rects, 50)).toEqual({ x: 450, y: 20, width: 50 + CELL_RADIUS, height: 200 })
  })

  it('fills the gap between two facing facets, whichever is named first', () => {
    const across = { x: 320 - CELL_RADIUS, y: 20, width: 180 + 2 * CELL_RADIUS, height: 200 }
    expect(compartmentRect('gap', [at('a', 'right'), at('b', 'left')], 0, rects)).toEqual(across)
    expect(compartmentRect('gap', [at('b', 'left'), at('a', 'right')], 0, rects)).toEqual(across)
    expect(compartmentRect('gap', [at('a', 'bottom'), at('c', 'top')], 0, rects)).toEqual({
      x: 0,
      y: 240 - CELL_RADIUS,
      width: 320,
      height: 160 + 2 * CELL_RADIUS,
    })
  })

  it('gives a free compartment no rect', () => {
    expect(compartmentRect('free', [], 0, rects)).toBeNull()
  })
})

describe('process areas', () => {
  it('puts the implicit area in the row today’s cytosolic processes use', () => {
    const rect = { x: 10, y: 20, width: 320, height: 240 }
    expect(processSlot(rect, 0, 0)).toEqual({ x: 10 + CELL_RADIUS, y: 20 + GLYPH_HEIGHT + 24 })
    expect(processSlot(rect, 0, 2)).toEqual({ x: 10 + CELL_RADIUS + 2 * (CARD.width + 16), y: 20 + GLYPH_HEIGHT + 24 })
    expect(processSlot(rect, 1, 0).y).toBe(20 + GLYPH_HEIGHT + 24 + CARD.height + 16)
  })
})

describe('layoutPhysiology', () => {
  it('returns the places and no sites when there are no template instances', () => {
    const nodes = [{ id: 'c', data: { name: 'c' } }]
    const roles = new Map([['c', { role: 'cytosol' }]])
    const { places, sites } = layoutPhysiology(nodes, roles, { instances: [], definitions: new Map() })
    expect(places.get('c')).toMatchObject({ kind: 'cell', membrane: null })
    expect(sites).toEqual([])
  })
})
