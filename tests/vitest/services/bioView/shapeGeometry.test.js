// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { boundsOf, flattenPath, isInside, isShapeId, lengthOf, pathOf, pointAlong, readShape } from '../../../../src/services/bioView/shapeGeometry.js'

const near = (a, b) => expect(a).toBeCloseTo(b, 1)

describe('reading a path as points', () => {
  it('follows lines, absolute or relative, and says whether it closes', () => {
    expect(flattenPath('M10 20 L30 20 v10 h-20 Z')).toEqual({ points: [{ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 30 }, { x: 10, y: 30 }], isClosed: true })
    expect(flattenPath('m5,5 10,0 0,10').points).toEqual([{ x: 5, y: 5 }, { x: 15, y: 5 }, { x: 15, y: 15 }])
    expect(flattenPath('M0 0 L1 1').isClosed).toBe(false)
    expect(flattenPath('M0 0 L1 1 Z M5 5 L6 6').points).toHaveLength(2)
  })

  it('cuts curves and arcs into pieces that end where they should', () => {
    const cubic = flattenPath('M0 0 C0 10 10 10 10 0').points
    expect(cubic.at(-1)).toEqual({ x: 10, y: 0 })
    near(Math.max(...cubic.map((point) => point.y)), 7.5)
    const smooth = flattenPath('M0 0 C0 10 10 10 10 0 S20 -10 20 0').points
    near(Math.min(...smooth.map((point) => point.y)), -7.5)
    const quad = flattenPath('M0 0 Q5 10 10 0 T20 0').points
    near(quad.at(-1).x, 20)
    // A half circle of radius 5, clockwise on screen, over the top.
    const arc = flattenPath('M0 0 A5 5 0 0 1 10 0').points
    near(arc.at(-1).x, 10)
    near(Math.min(...arc.map((point) => point.y)), -5)
    near(lengthOf(arc), Math.PI * 5)
  })
})

describe('runs of points', () => {
  const square = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]
  it('are measured, walked along, boxed and tested for what is inside', () => {
    expect(lengthOf(square)).toBe(30)
    expect(pointAlong(square, 5)).toEqual({ x: 5, y: 0, angle: 0 })
    expect(pointAlong(square, 15)).toEqual({ x: 10, y: 5, angle: 90 })
    expect(pointAlong(square, 99)).toMatchObject({ x: 0, y: 10 })
    expect(boundsOf(square)).toEqual({ x: 0, y: 0, width: 10, height: 10 })
    expect(isInside(square, { x: 5, y: 5 })).toBe(true)
    expect(isInside(square, { x: 15, y: 5 })).toBe(false)
    expect(pathOf(square)).toBe('M0 0 L10 0 L10 10 L0 10 Z')
  })
})

describe('the geometry a skin names', () => {
  const parse = (inner, viewBox = '10 10 100 200') => new DOMParser().parseFromString(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}">${inner}</svg>`, 'image/svg+xml').documentElement

  it('reads an outline, facets, regions and anchors by their ids, from the viewBox’s corner', () => {
    const { shape, warnings } = readShape(
      parse(
        '<path id="outline" d="M10 10 H110 V210 H10 Z"/><path id="facet-os" d="M110 20 V100"/>' +
          '<rect id="region-outer" x="20" y="20" width="80" height="80"/><circle id="anchor-cilium" cx="60" cy="110" r="5"/>' +
          '<path id="decor" d="M0 0 L5 5"/>'
      )
    )
    expect(warnings).toEqual([])
    expect(shape).toMatchObject({ width: 100, height: 200 })
    expect(shape.outline).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 200 }, { x: 0, y: 200 }])
    expect(shape.facets.os).toEqual([{ x: 100, y: 10 }, { x: 100, y: 90 }])
    expect(shape.regions.outer.bounds).toEqual({ x: 10, y: 10, width: 80, height: 80 })
    expect(shape.anchors.cilium).toEqual({ x: 45, y: 95, width: 10, height: 10 })
  })

  it('is none for a skin with no outline, and leaves out what a transform moves', () => {
    expect(readShape(parse('<path id="facet-a" d="M0 0 L5 5"/>')).shape).toBeNull()
    const moved = readShape(parse('<path id="outline" d="M10 10 H110 V210 Z"/><g transform="translate(5 5)"><path id="facet-a" d="M0 0 L5 5"/></g>'))
    expect(moved.shape.facets).toEqual({})
    expect(moved.warnings).toEqual(['"facet-a" is moved by a transform, so its place can’t be read.'.replace('’', "'")])
  })

  it('knows which ids name geometry', () => {
    expect(['outline', 'facet-a', 'region-b', 'anchor-c'].every(isShapeId)).toBe(true)
    expect(['outline2', 'decor', 'facet', null].some(isShapeId)).toBe(false)
  })
})
