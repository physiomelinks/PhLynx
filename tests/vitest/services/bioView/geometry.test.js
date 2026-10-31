import { Position } from '@vue-flow/core'
import { describe, expect, it } from 'vitest'

import {
  FACET_INSET,
  MIN_CELL,
  SLOT_PITCH,
  facetOfPart,
  fitCellRect,
  nearestSlot,
  partOf,
  proteinPlacement,
  roundedRectPath,
  slotPositions,
} from '../../../../src/services/bioView/geometry.js'

const cell = { x: 0, y: 0, width: 400, height: 300 }

describe('physiological view geometry', () => {
  it('spreads apical slots along the top edge, centred, a pitch apart', () => {
    expect(slotPositions(cell, 'apical', 3)).toEqual([
      { x: 200 - SLOT_PITCH, y: 0 },
      { x: 200, y: 0 },
      { x: 200 + SLOT_PITCH, y: 0 },
    ])
    expect(slotPositions(cell, 'basolateral', 1)).toEqual([{ x: 200, y: 300 }])
  })

  it('gives each side of the lateral facet its own row down the cell', () => {
    expect(slotPositions(cell, 'lateral-left', 2).map((s) => s.x)).toEqual([0, 0])
    expect(slotPositions(cell, 'lateral-right', 1)).toEqual([{ x: 400, y: 150 }])
    expect(partOf('lateral', 'right')).toBe('lateral-right')
    expect(partOf('lateral')).toBe('lateral-left')
    expect(partOf('apical')).toBe('apical')
    expect(facetOfPart('lateral-right')).toEqual({ facet: 'lateral', at: 'right' })
    expect(facetOfPart('basolateral')).toEqual({ facet: 'basolateral', at: undefined })
  })

  it('turns each protein so its outside faces out of the cell', () => {
    expect(proteinPlacement(cell, 'apical', 0, 1)).toEqual({ x: 200, y: 0, rotation: 0, outward: Position.Top })
    expect(proteinPlacement(cell, 'basolateral', 0, 1)).toMatchObject({ rotation: 180, outward: Position.Bottom })
    expect(proteinPlacement(cell, 'lateral-left', 0, 1)).toMatchObject({ x: 0, rotation: -90, outward: Position.Left })
    expect(proteinPlacement(cell, 'lateral-right', 0, 1)).toMatchObject({ x: 400, rotation: 90, outward: Position.Right })
  })

  it('snaps to the nearest slot, including a facet’s spare one, within reach', () => {
    const cells = [{ id: 'c', rect: cell, counts: { apical: 1, basolateral: 0, 'lateral-left': 0, 'lateral-right': 0 } }]
    // Apical has its protein's slot and a spare one beside it.
    expect(nearestSlot(cells, { x: 200 + SLOT_PITCH / 2 + 5, y: 10 })).toMatchObject({ cellId: 'c', part: 'apical', facet: 'apical', order: 1 })
    expect(nearestSlot(cells, { x: 200, y: 290 })).toMatchObject({ part: 'basolateral', order: 0, x: 200, y: 300 })
    expect(nearestSlot(cells, { x: 395, y: 150 })).toMatchObject({ part: 'lateral-right', facet: 'lateral', at: 'right', order: 0 })
    expect(nearestSlot(cells, { x: 200, y: 150 })).toBeNull()
  })

  it('grows a cell to fit its proteins and a spare slot, never shrinking it', () => {
    expect(fitCellRect({ x: 5, y: 6, width: 0, height: 0 }, {})).toEqual({ x: 5, y: 6, ...MIN_CELL })
    const wide = fitCellRect({ x: 0, y: 0, width: 0, height: 0 }, { apical: 5 })
    expect(slotPositions(wide, 'apical', 6)[0].x).toBeGreaterThanOrEqual(FACET_INSET)
    expect(fitCellRect({ x: 0, y: 0, width: 2000, height: 900 }, { apical: 1 })).toMatchObject({ width: 2000, height: 900 })
    const tall = fitCellRect({ x: 0, y: 0, width: 0, height: 0 }, { 'lateral-left': 4, 'lateral-right': 1 })
    expect(slotPositions(tall, 'lateral-left', 5)[0].y).toBeGreaterThanOrEqual(FACET_INSET)
  })

  it('outlines a rounded cell', () => {
    expect(roundedRectPath({ x: 0, y: 0, width: 100, height: 50 }, 10)).toBe(
      'M 10 0 H 90 A 10 10 0 0 1 100 10 V 40 A 10 10 0 0 1 90 50 H 10 A 10 10 0 0 1 0 40 V 10 A 10 10 0 0 1 10 0 Z'
    )
  })
})
