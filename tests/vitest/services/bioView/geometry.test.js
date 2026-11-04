import { Position } from '@vue-flow/core'
import { describe, expect, it } from 'vitest'

import {
  FACET_INSET,
  MIN_CELL,
  SLOT_PITCH,
  cellSlots,
  facetOfPart,
  facetSlots,
  fitCellRect,
  leafletCorners,
  leafletDistance,
  leafletPath,
  leafletSides,
  nearestSlot,
  partOf,
  pitchBetween,
  proteinLabelWidth,
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

  it('puts a drop slot on each protein drawn on a part, and a spare one a pitch past the last', () => {
    for (const [part, count] of [['apical', 2], ['basolateral', 3], ['lateral-left', 2], ['lateral-right', 1]]) {
      const drawn = Array.from({ length: count }, (_, order) => proteinPlacement(cell, part, order, count))
      const slots = facetSlots(cell, part, count)
      expect(slots.slice(0, -1).map(({ x, y }) => ({ x, y }))).toEqual(drawn.map(({ x, y }) => ({ x, y })))
      const [last, spare] = slots.slice(-2)
      expect(spare).toMatchObject({ order: count, spare: true })
      expect(Math.hypot(spare.x - last.x, spare.y - last.y)).toBe(SLOT_PITCH)
      expect(slots.filter((slot) => slot.spare)).toHaveLength(1)
    }
    expect(facetSlots(cell, 'apical', 0)).toEqual([{ x: 200, y: 0, order: 0, spare: true }])
    expect(facetSlots(cell, 'apical', 2, undefined, { spare: false }).map((slot) => slot.spare)).toEqual([false, false])
  })

  it('keeps a dragged protein’s row where it is drawn, without a spare', () => {
    const held = { rect: cell, counts: { apical: 1 }, held: 'apical' }
    expect(cellSlots(held, 'apical')).toEqual(facetSlots(cell, 'apical', 2, undefined, { spare: false }))
    expect(cellSlots(held, 'basolateral')).toEqual(facetSlots(cell, 'basolateral', 0))
  })

  it('snaps to the nearest slot, including a facet’s spare one, within reach', () => {
    const cells = [{ id: 'c', rect: cell, counts: { apical: 1, basolateral: 0, 'lateral-left': 0, 'lateral-right': 0 } }]
    // Apical has its protein's slot and a spare one beside it; a drop on the protein is its slot, not a tie.
    expect(nearestSlot(cells, { x: 200, y: 10 })).toMatchObject({ part: 'apical', order: 0, spare: false, x: 200 })
    expect(nearestSlot(cells, { x: 200 + SLOT_PITCH - 5, y: 10 })).toMatchObject({ cellId: 'c', part: 'apical', facet: 'apical', order: 1, spare: true })
    expect(nearestSlot(cells, { x: 200, y: 290 })).toMatchObject({ part: 'basolateral', order: 0, x: 200, y: 300 })
    expect(nearestSlot(cells, { x: 395, y: 150 })).toMatchObject({ part: 'lateral-right', facet: 'lateral', at: 'right', order: 0 })
    expect(nearestSlot(cells, { x: 200, y: 150 })).toBeNull()
  })

  it('grows a cell to fit its proteins and a spare slot, never shrinking it', () => {
    expect(fitCellRect({ x: 5, y: 6, width: 0, height: 0 }, {})).toEqual({ x: 5, y: 6, ...MIN_CELL })
    const wide = fitCellRect({ x: 0, y: 0, width: 0, height: 0 }, { apical: 5 })
    expect(facetSlots(wide, 'apical', 5)[0].x).toBeGreaterThanOrEqual(FACET_INSET)
    expect(facetSlots(wide, 'apical', 5).at(-1).x).toBeLessThanOrEqual(wide.width - FACET_INSET)
    expect(fitCellRect({ x: 0, y: 0, width: 2000, height: 900 }, { apical: 1 })).toMatchObject({ width: 2000, height: 900 })
    const tall = fitCellRect({ x: 0, y: 0, width: 0, height: 0 }, { 'lateral-left': 4, 'lateral-right': 1 })
    expect(facetSlots(tall, 'lateral-left', 4).at(-1).y).toBeLessThanOrEqual(tall.height - FACET_INSET)
  })

  it('spaces a top or bottom row out so neighbouring names keep clear, and caps very long ones', () => {
    const short = proteinLabelWidth('NHE3')
    const long = proteinLabelWidth('Sodium_glucose_cotransporter')
    expect(pitchBetween(short, short)).toBe(SLOT_PITCH)
    expect(long).toBe(proteinLabelWidth('Sodium_glucose_cotransporter_with_an_even_longer_name'))
    expect(proteinLabelWidth('NHE3', 'Na⁺ · H⁺ · Cl⁻ · K⁺ · HCO₃⁻')).toBeGreaterThan(short)

    // The names' boxes, centred under their slots, don't meet.
    const widths = [short, long, long]
    const slots = facetSlots(cell, 'apical', 3, undefined, { widths })
    for (let i = 1; i < 3; i++) {
      expect(slots[i].x - slots[i - 1].x).toBeGreaterThanOrEqual((widths[i] + widths[i - 1]) / 2)
    }
    // Still centred, with the spare a pitch past the last name.
    expect((slots[0].x + slots[2].x) / 2).toBeCloseTo(200)
    expect(slots[3].x - slots[2].x).toBe(pitchBetween(long))
    expect(slots.slice(0, 3).map(({ x }) => x)).toEqual(
      [0, 1, 2].map((order) => proteinPlacement(cell, 'apical', order, 3, undefined, widths).x)
    )
    // A side's rows run down it, where names don't meet: no change there.
    expect(slotPositions(cell, 'lateral-left', 2, undefined, widths)).toEqual(slotPositions(cell, 'lateral-left', 2))

    // The cell grows to fit them, and a dragged protein's row stays where it is drawn.
    const fitted = fitCellRect({ x: 0, y: 0, width: 0, height: 0 }, { apical: 3 }, undefined, { apical: widths })
    expect(fitted.width).toBeGreaterThan(fitCellRect({ x: 0, y: 0, width: 0, height: 0 }, { apical: 3 }).width)
    const row = facetSlots(fitted, 'apical', 3, undefined, { widths })
    expect(row[0].x).toBeGreaterThanOrEqual(FACET_INSET)
    expect(row.at(-1).x).toBeLessThanOrEqual(fitted.width - FACET_INSET)
    const held = { rect: fitted, counts: { apical: 2 }, held: 'apical', widths: { apical: widths } }
    expect(cellSlots(held, 'apical').map(({ x }) => x)).toEqual(row.slice(0, 3).map(({ x }) => x))
  })

  it('measures how far a point is from a cell’s rounded outline, negative inside', () => {
    expect(leafletDistance(cell, { x: 200, y: -5 })).toBe(5)
    expect(leafletDistance(cell, { x: 200, y: 6 })).toBe(-6)
    expect(leafletDistance(cell, { x: 200, y: 150 })).toBe(-150)
    // At a rect corner, outside the rounded one by the radius' diagonal.
    expect(leafletDistance(cell, { x: 0, y: 0 })).toBeCloseTo(40 * Math.SQRT2 - 40)
  })

  it('splits a leaflet into straight sides of whole lipids and the corner arcs between them', () => {
    const sides = leafletSides(203, 100)
    // 123 of straight top and bottom hold 24 lipids, centred; 20 of left and right hold 4.
    expect(sides.map(({ edge, length }) => [edge, length])).toEqual([
      ['top', 120],
      ['right', 20],
      ['bottom', 120],
      ['left', 20],
    ])
    expect(sides[0].transform).toBe('translate(40 0) rotate(0) translate(1.5 0)')
    expect(sides[1].transform).toBe('translate(203 40) rotate(90) translate(0 0)')
    // The arcs are the outline's own corners, grown with it.
    const arcs = (path) => path.match(/A [^A-Z]*/g).map((arc) => arc.trim()).sort()
    expect(arcs(leafletCorners(203, 100, 7))).toEqual(arcs(leafletPath(203, 100, 7)))
    expect(leafletCorners(203, 100, 7)).toMatch(/^M -7 40 A 47 47 0 0 1 40 -7 /)
    // Too small a corner for the inner leaflet: none.
    expect(leafletCorners(10, 10, -7)).toBe('')
    expect(leafletSides(60, 60)).toEqual([])
  })

  it('outlines a rounded cell', () => {
    expect(roundedRectPath({ x: 0, y: 0, width: 100, height: 50 }, 10)).toBe(
      'M 10 0 H 90 A 10 10 0 0 1 100 10 V 40 A 10 10 0 0 1 90 50 H 10 A 10 10 0 0 1 0 40 V 10 A 10 10 0 0 1 10 0 Z'
    )
  })
})
