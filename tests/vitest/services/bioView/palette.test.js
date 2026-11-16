import { describe, expect, it } from 'vitest'

import { nearestEdge, templateCellAt } from '../../../../src/services/bioView/palette.js'

const rect = { x: 100, y: 100, width: 200, height: 100 }

describe('the build palette', () => {
  it('finds the template cell a point is on or just outside, and no cell of the diagram’s own', () => {
    const layout = new Map([
      ['own', { kind: 'cell', rect }],
      ['tpl:t1/cell', { kind: 'cell', rect, instance: 't1', path: 'cell' }],
      ['tpl:t1/lumen', { kind: 'region', rect, instance: 't1', path: 'lumen' }],
    ])
    expect(templateCellAt(layout, { x: 150, y: 150 })).toEqual({ key: 'tpl:t1/cell', instance: 't1', path: 'cell', rect, isOrganelle: false })
    expect(templateCellAt(layout, { x: 90, y: 150 })).toBeNull()
    expect(templateCellAt(layout, { x: 90, y: 150 }, 20)?.instance).toBe('t1')
    expect(templateCellAt(layout, { x: 50, y: 150 }, 20)).toBeNull()
  })

  it('takes the cell whose centre is nearest where two are in reach', () => {
    const layout = new Map([
      ['a', { kind: 'cell', rect, instance: 't1', path: 'cell' }],
      ['b', { kind: 'cell', rect: { ...rect, x: 320 }, instance: 't2', path: 'cell' }],
    ])
    expect(templateCellAt(layout, { x: 312, y: 150 }, 20).instance).toBe('t2')
    expect(templateCellAt(layout, { x: 305, y: 150 }, 20).instance).toBe('t1')
  })

  it('picks the nearest side among those offered', () => {
    expect(nearestEdge(rect, { x: 200, y: 110 }, ['top', 'bottom', 'left', 'right'])).toBe('top')
    expect(nearestEdge(rect, { x: 200, y: 110 }, ['bottom', 'left'])).toBe('bottom')
    expect(nearestEdge(rect, { x: 290, y: 150 }, ['top', 'right'])).toBe('right')
    expect(nearestEdge(rect, { x: 200, y: 110 }, [])).toBeNull()
  })

  it('finds an organelle the point is on ahead of its cell, unless only cells are wanted', () => {
    const inner = { x: 150, y: 120, width: 80, height: 40 }
    const layout = new Map([
      ['cell', { kind: 'cell', rect, instance: 't1', path: 'cell' }],
      ['sr', { kind: 'cell', rect: inner, instance: 't1', path: 'sr', parent: 'cell' }],
    ])
    expect(templateCellAt(layout, { x: 200, y: 150 })).toMatchObject({ path: 'sr', isOrganelle: true })
    expect(templateCellAt(layout, { x: 200, y: 150 }, 0, { organelles: false }).path).toBe('cell')
    expect(templateCellAt(layout, { x: 280, y: 190 }).path).toBe('cell')
  })
})
