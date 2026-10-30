import { Position } from '@vue-flow/core'
import { describe, expect, it } from 'vitest'

import {
  FACET_INSET,
  FACET_PARTS,
  GLYPH_WIDTH,
  MIN_CELL,
  SLOT_PITCH,
  fitCellRect,
  nearestSlot,
  proteinPlacement,
  slotPositions,
} from '../../../../src/services/bioView/geometry.js'
import {
  EPITHELIAL_SHAPE,
  annotationOfFacet,
  facetOfAnnotation,
  facetsInGroup,
  shapeFromTemplateCell,
} from '../../../../src/services/bioView/shape.js'

/** A cell with membrane only along its top and bottom. */
const SLAB = shapeFromTemplateCell({
  id: 'slab',
  label: 'Slab',
  facets: [
    { id: 'outer', label: 'Outer', edge: 'top' },
    { id: 'inner', label: 'Inner', edge: 'bottom', site: false },
  ],
})

const rect = { x: 0, y: 0, width: 400, height: 300 }

describe('cell shapes', () => {
  it('reads the epithelial shape from the built-in template', () => {
    expect(EPITHELIAL_SHAPE.facets.map(({ id, edge, group }) => ({ id, edge, group }))).toEqual([
      { id: 'apical', edge: 'top', group: undefined },
      { id: 'basolateral', edge: 'bottom', group: undefined },
      { id: 'lateral-left', edge: 'left', group: 'lateral' },
      { id: 'lateral-right', edge: 'right', group: 'lateral' },
    ])
    expect(EPITHELIAL_SHAPE.processes).toEqual([{ id: 'metabolism', label: 'Metabolism' }])
    expect(FACET_PARTS).toEqual(EPITHELIAL_SHAPE.facets.map((facet) => facet.id))
    expect(Object.isFrozen(EPITHELIAL_SHAPE.facets[0])).toBe(true)
  })

  it('keeps only the facet fields a shape needs', () => {
    expect(SLAB.facets[1]).toEqual({ id: 'inner', label: 'Inner', edge: 'bottom' })
    expect(SLAB.processes).toEqual([])
  })

  it('goes from an annotation to a facet only through the alias table', () => {
    expect(facetOfAnnotation(EPITHELIAL_SHAPE, { facet: 'apical' })).toBe('apical')
    expect(facetOfAnnotation(EPITHELIAL_SHAPE, { facet: 'basolateral', at: 'left' })).toBe('basolateral')
    expect(facetOfAnnotation(EPITHELIAL_SHAPE, { facet: 'lateral', at: 'right' })).toBe('lateral-right')
    expect(facetOfAnnotation(EPITHELIAL_SHAPE, { facet: 'lateral', at: 'left' })).toBe('lateral-left')
    // No side: the callers share these out between the group.
    expect(facetOfAnnotation(EPITHELIAL_SHAPE, { facet: 'lateral' })).toBeNull()
    // A shape with no aliases matches nothing.
    expect(facetOfAnnotation(SLAB, { facet: 'apical' })).toBeNull()
  })

  it('goes from a facet back to its annotation', () => {
    expect(annotationOfFacet(EPITHELIAL_SHAPE, 'apical')).toEqual({ facet: 'apical' })
    expect(annotationOfFacet(EPITHELIAL_SHAPE, 'lateral-left')).toEqual({ facet: 'lateral', at: 'left' })
    expect(annotationOfFacet(EPITHELIAL_SHAPE, 'nowhere')).toBeNull()
    expect(annotationOfFacet(SLAB, 'outer')).toBeNull()
  })

  it('lists the facets in a group', () => {
    expect(facetsInGroup(EPITHELIAL_SHAPE, 'lateral')).toEqual(['lateral-left', 'lateral-right'])
    expect(facetsInGroup(EPITHELIAL_SHAPE, 'apical')).toEqual([])
    expect(facetsInGroup(SLAB, 'lateral')).toEqual([])
  })
})

describe('geometry of another shape', () => {
  it('puts slots and proteins on the edges its facets lie along', () => {
    expect(slotPositions(rect, 'outer', 2, SLAB)).toEqual([
      { x: 200 - SLOT_PITCH / 2, y: 0 },
      { x: 200 + SLOT_PITCH / 2, y: 0 },
    ])
    expect(slotPositions(rect, 'inner', 1, SLAB)).toEqual([{ x: 200, y: 300 }])
    expect(proteinPlacement(rect, 'inner', 0, 1, SLAB)).toEqual({
      x: 200,
      y: 300,
      rotation: 180,
      outward: Position.Bottom,
    })
    expect(() => slotPositions(rect, 'lateral-left', 1, SLAB)).toThrow()
  })

  it('snaps only to slots on its facets', () => {
    const cells = [{ id: 's', rect, counts: { outer: 1 }, shape: SLAB }]
    expect(nearestSlot(cells, { x: 200 + SLOT_PITCH / 2, y: 5 })).toMatchObject({
      cellId: 's',
      part: 'outer',
      facet: 'outer',
      at: undefined,
      order: 1,
    })
    expect(nearestSlot(cells, { x: 200, y: 295 })).toMatchObject({ part: 'inner', order: 0 })
    // Where an epithelial cell would have its lateral slots, this one has none.
    expect(nearestSlot(cells, { x: 0, y: 150 })).toBeNull()
    expect(nearestSlot(cells, { x: 400, y: 150 })).toBeNull()
  })

  it('grows only across for facets along its top and bottom', () => {
    expect(fitCellRect({ x: 1, y: 2, width: 0, height: 0 }, {}, SLAB)).toEqual({ x: 1, y: 2, ...MIN_CELL })
    const wide = fitCellRect({ x: 0, y: 0, width: 0, height: 0 }, { outer: 2, inner: 6 }, SLAB)
    expect(wide.width).toBe(6 * SLOT_PITCH + GLYPH_WIDTH + 2 * FACET_INSET)
    expect(wide.height).toBe(MIN_CELL.height)
    // Counts for facets it doesn't have are ignored.
    expect(fitCellRect({ x: 0, y: 0, width: 0, height: 0 }, { 'lateral-left': 9 }, SLAB)).toMatchObject(MIN_CELL)
  })
})
