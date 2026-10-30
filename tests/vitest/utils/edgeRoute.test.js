import { Position, getSmoothStepPath } from '@vue-flow/core'
import { describe, expect, it } from 'vitest'

import {
  MAX_WAYPOINTS,
  clearWaypoints,
  STUB,
  fullPolyline,
  getEdgeWaypoints,
  midpointAlong,
  orthogonalise,
  roundedPath,
  sanitiseWaypoints,
  simplify,
  smoothstepPoints,
  translateWaypoints,
  withEdgeWaypoints,
} from '../../../src/utils/edgeRoute.js'

const SIDES = [Position.Left, Position.Right, Position.Top, Position.Bottom]

/** Edge props from (sx, sy) on one side to (tx, ty) on another. */
const edge = (sx, sy, sourcePosition, tx, ty, targetPosition) => ({
  sourceX: sx,
  sourceY: sy,
  sourcePosition,
  targetX: tx,
  targetY: ty,
  targetPosition,
})

const isOrthogonal = (points) => points.slice(1).every((p, i) => p.x === points[i].x || p.y === points[i].y)

describe('smoothstepPoints', () => {
  const placements = [
    [0, 0, 300, 140],
    [300, 140, 0, 0],
    [0, 0, 8, 260],
    [0, 0, 260, 8],
  ]

  it.each(SIDES.flatMap((s) => SIDES.flatMap((t) => placements.map((p) => [s, t, ...p]))))(
    'draws the same path as getSmoothStepPath from %s to %s (%d,%d → %d,%d)',
    (sourcePosition, targetPosition, sx, sy, tx, ty) => {
      const props = edge(sx, sy, sourcePosition, tx, ty, targetPosition)
      expect(roundedPath(smoothstepPoints(props))).toBe(getSmoothStepPath(props)[0])
    }
  )

  it('keeps the shortened stub of two close handles on the same side', () => {
    const props = edge(0, 0, Position.Right, 10, 100, Position.Right)
    const points = smoothstepPoints(props)
    expect(roundedPath(points)).toBe(getSmoothStepPath(props)[0])
    expect(points[1].x - points[0].x).not.toBe(STUB)
  })
})

describe('orthogonalise', () => {
  it('leaves along the source stub when the next point is ahead', () => {
    const points = orthogonalise([{ x: 20, y: 0 }, { x: 100, y: 50 }, { x: 200, y: 50 }], Position.Right, Position.Left)
    expect(points[1]).toEqual({ x: 100, y: 0 })
  })

  it('turns off the source stub when the next point is behind it', () => {
    const points = orthogonalise([{ x: 20, y: 0 }, { x: -100, y: 50 }, { x: -150, y: 50 }], Position.Right, Position.Left)
    expect(points[1]).toEqual({ x: 20, y: 50 })
  })

  it('arrives along the target stub, moving towards the node', () => {
    const points = orthogonalise([{ x: 0, y: 0 }, { x: 200, y: 80 }], Position.Bottom, Position.Left)
    expect(points).toEqual([{ x: 0, y: 0 }, { x: 0, y: 80 }, { x: 200, y: 80 }])
  })

  it('adds an elbow between interior points that are not aligned', () => {
    const points = orthogonalise([{ x: 20, y: 0 }, { x: 100, y: 0 }, { x: 160, y: 70 }, { x: 300, y: 70 }], Position.Right, Position.Left)
    expect(isOrthogonal(points)).toBe(true)
  })
})

describe('simplify', () => {
  it('drops repeated and collinear points', () => {
    const points = [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }]
    expect(simplify(points)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 40 }])
  })
})

describe('fullPolyline', () => {
  it.each(SIDES.flatMap((s) => SIDES.map((t) => [s, t])))('is orthogonal and enters the target along its stub (%s → %s)', (s, t) => {
    const props = edge(0, 0, s, 400, 200, t)
    const points = fullPolyline(props, [{ x: 150, y: -60 }, { x: 250, y: 260 }])
    expect(isOrthogonal(points)).toBe(true)
    expect(points[0]).toEqual({ x: 0, y: 0 })
    expect(points.at(-1)).toEqual({ x: 400, y: 200 })
    // The last segment points into the target, so the arrow does too.
    const [before, end] = points.slice(-2)
    const out = { [Position.Left]: [-1, 0], [Position.Right]: [1, 0], [Position.Top]: [0, -1], [Position.Bottom]: [0, 1] }[t]
    expect(Math.sign(before.x - end.x)).toBe(out[0])
    expect(Math.sign(before.y - end.y)).toBe(out[1])
  })

  it('passes through each waypoint', () => {
    const waypoints = [{ x: 120, y: 0 }, { x: 120, y: 200 }]
    const points = fullPolyline(edge(0, 0, Position.Right, 300, 200, Position.Left), waypoints)
    waypoints.forEach((w) => expect(points).toContainEqual(w))
  })
})

describe('midpointAlong', () => {
  it('finds the point halfway along the route', () => {
    expect(midpointAlong([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }])).toEqual({ x: 100, y: 0 })
    expect(midpointAlong([{ x: 0, y: 0 }, { x: 0, y: 40 }])).toEqual({ x: 0, y: 20 })
  })
})

describe('waypoint data', () => {
  it('keeps only arrays of finite points', () => {
    expect(sanitiseWaypoints([{ x: 1, y: 2, extra: true }])).toEqual([{ x: 1, y: 2 }])
    expect(sanitiseWaypoints([])).toBeUndefined()
    expect(sanitiseWaypoints('1,2')).toBeUndefined()
    expect(sanitiseWaypoints([{ x: 1, y: NaN }])).toBeUndefined()
    expect(sanitiseWaypoints([{ x: '1', y: 2 }])).toBeUndefined()
    expect(sanitiseWaypoints([null])).toBeUndefined()
    expect(sanitiseWaypoints(Array.from({ length: MAX_WAYPOINTS + 1 }, () => ({ x: 0, y: 0 })))).toBeUndefined()
  })

  it('reads, sets and clears an edge’s waypoints', () => {
    const data = { couplings: [] }
    const routed = withEdgeWaypoints(data, [{ x: 1, y: 2 }])
    expect(getEdgeWaypoints({ data: routed })).toEqual([{ x: 1, y: 2 }])
    expect(withEdgeWaypoints(routed, undefined)).toEqual(data)
    expect(getEdgeWaypoints({ data })).toBeUndefined()
  })

  it('moves waypoints by an offset', () => {
    expect(translateWaypoints([{ x: 1, y: 2 }], 10, -5)).toEqual([{ x: 11, y: -3 }])
    expect(translateWaypoints(undefined, 10, 10)).toBeUndefined()
  })

  it('clears every edge’s route, leaving its other data', () => {
    const edges = [{ data: { couplings: [1], waypoints: [{ x: 1, y: 2 }] } }, { data: { couplings: [] } }, {}]
    clearWaypoints(edges)
    expect(edges).toEqual([{ data: { couplings: [1] } }, { data: { couplings: [] } }, {}])
  })
})
