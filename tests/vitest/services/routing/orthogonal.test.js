import { Position } from '@vue-flow/core'
import { describe, expect, it } from 'vitest'

import { MARGIN, routeAll } from '../../../../src/services/routing/orthogonal.js'
import { fullPolyline } from '../../../../src/utils/edgeRoute.js'

/** Edge from the right of a node at (0,0) to the left of one at (400,0), both 100 x 60. */
const request = { id: 'e', sourceX: 100, sourceY: 30, sourcePosition: Position.Right, targetX: 400, targetY: 30, targetPosition: Position.Left }
const source = { x: 0, y: 0, width: 100, height: 60 }
const target = { x: 400, y: 0, width: 100, height: 60 }

/** How many times a route changes direction. */
const turns = (points) =>
  points.slice(1, -1).filter((p, i) => (points[i].x === p.x) !== (p.x === points[i + 2].x)).length

const isOrthogonal = (points) => points.slice(1).every((p, i) => p.x === points[i].x || p.y === points[i].y)

/** Whether any segment of a route passes through a rectangle. */
function crosses(points, rect) {
  return points.slice(1).some((b, i) => {
    const a = points[i]
    const [left, right] = [Math.min(a.x, b.x), Math.max(a.x, b.x)]
    const [top, bottom] = [Math.min(a.y, b.y), Math.max(a.y, b.y)]
    return right > rect.x && left < rect.x + rect.width && bottom > rect.y && top < rect.y + rect.height
  })
}

describe('orthogonal router', () => {
  it('keeps the plain line when nothing is in the way', () => {
    const routes = routeAll([request], { obstacles: [source, target] })
    expect(routes.has('e')).toBe(true)
    expect(routes.get('e')).toBeUndefined()
  })

  it('goes around a module in the way, clear of it by the margin', () => {
    const blocker = { x: 200, y: -40, width: 100, height: 140 }
    const waypoints = routeAll([request], { obstacles: [source, target, blocker] }).get('e')
    expect(waypoints.length).toBeGreaterThan(0)
    const route = fullPolyline(request, waypoints)
    expect(isOrthogonal(route)).toBe(true)
    const inflated = { x: blocker.x - MARGIN + 1, y: blocker.y - MARGIN + 1, width: blocker.width + 2 * MARGIN - 2, height: blocker.height + 2 * MARGIN - 2 }
    expect(crosses(route, inflated)).toBe(false)
    expect(crosses(route.slice(1, -1), source)).toBe(false)
    expect(crosses(route.slice(1, -1), target)).toBe(false)
  })

  it('takes the way with the fewest turns', () => {
    // A blocker reaching far below leaves only the way over it.
    const blocker = { x: 200, y: -20, width: 100, height: 400 }
    const waypoints = routeAll([request], { obstacles: [source, target, blocker] }).get('e')
    // Over the blocker at its margin, with the four turns that takes, however a tie is broken.
    const route = fullPolyline(request, waypoints)
    expect(Math.min(...route.map((p) => p.y))).toBe(-20 - MARGIN)
    expect(turns(route)).toBe(4)
  })

  it('arrives along the target stub, never doubling back over it', () => {
    const obstacles = [
      { x: 140, y: 70, width: 130, height: 130 },
      { x: 50, y: 0, width: 70, height: 100 },
      { x: 20, y: 260, width: 100, height: 50 },
    ]
    const edge = { id: 'e', sourceX: 205, sourceY: 200, sourcePosition: Position.Bottom, targetX: 120, targetY: 50, targetPosition: Position.Right }
    const route = fullPolyline(edge, routeAll([edge], { obstacles }).get('e'))
    const [before, stubEnd, end] = route.slice(-3)
    expect(stubEnd).toEqual({ x: 140, y: 50 })
    // The last two segments both head left, into the node, or the stub is reached from the side.
    expect(before.x >= stubEnd.x && end.x < stubEnd.x).toBe(true)
  })

  it('routes past a module close in front of a handle, ignoring only its margin', () => {
    // The blocker's margin covers the source stub end; the blocker itself does not.
    const close = { x: 125, y: -60, width: 60, height: 200 }
    const waypoints = routeAll([request], { obstacles: [source, target, close] }).get('e')
    const route = fullPolyline(request, waypoints)
    expect(crosses(route, close)).toBe(false)
    expect(isOrthogonal(route)).toBe(true)
  })

  it('leaves out an edge that is walled in', () => {
    const wall = [
      { x: 110, y: -200, width: 20, height: 500 },
      { x: 110, y: -220, width: 300, height: 20 },
      { x: 110, y: 300, width: 300, height: 20 },
      { x: 390, y: -200, width: 20, height: 500 },
    ]
    const boxed = { ...request, targetX: 600, targetY: 30 }
    expect(routeAll([boxed], { obstacles: [source, ...wall] }).has('e')).toBe(false)
  })

  it('gives the same route every time', () => {
    const blocker = { x: 200, y: -40, width: 100, height: 140 }
    const options = { obstacles: [source, target, blocker] }
    expect(routeAll([request], options)).toEqual(routeAll([request], options))
  })

  it('routes a large workspace quickly', () => {
    const obstacles = []
    for (let row = 0; row < 10; row++) for (let col = 0; col < 10; col++) obstacles.push({ x: col * 250, y: row * 200, width: 120, height: 80 })
    const requests = Array.from({ length: 150 }, (_, i) => {
      const a = obstacles[i % 100]
      const b = obstacles[(i * 37 + 11) % 100]
      return { id: `e${i}`, sourceX: a.x + 120, sourceY: a.y + 40, sourcePosition: Position.Right, targetX: b.x, targetY: b.y + 40, targetPosition: Position.Left }
    })
    const started = performance.now()
    const routes = routeAll(requests, { obstacles })
    expect(performance.now() - started).toBeLessThan(2000)
    expect(routes.size).toBeGreaterThan(140)
  })
})
