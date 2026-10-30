/**
 * orthogonal.js
 *
 * Routes edges around modules with right-angled lines: A* over the grid made by the module outlines,
 * so a route only turns on the lines along their edges, with each turn costing extra so routes stay
 * simple. Each edge is routed on its own; parallel routes are not spread apart.
 */

import { Position } from '@vue-flow/core'
import { simplify, smoothstepPoints, stubPoint } from '../../utils/edgeRoute'

/** Default gap kept between a route and a module, in flow units. */
export const MARGIN = 10

/** Default extra cost of a turn, in flow units of length. */
export const BEND_PENALTY = 40

const DIRECTIONS = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
]
const SIDE_DIRECTION = { [Position.Right]: 0, [Position.Left]: 1, [Position.Bottom]: 2, [Position.Top]: 3 }
const OPPOSITE = [1, 0, 3, 2]

/**
 * Grows rectangles by a margin.
 *
 * @param {Array<{x: number, y: number, width: number, height: number}>} rects
 * @param {number} margin
 * @returns {Array<{left: number, right: number, top: number, bottom: number}>}
 */
function inflate(rects, margin) {
  return rects.map(({ x, y, width, height }) => ({
    left: x - margin,
    right: x + width + margin,
    top: y - margin,
    bottom: y + height + margin,
  }))
}

const isInside = (boxes, x, y) => boxes.some((b) => x > b.left && x < b.right && y > b.top && y < b.bottom)

/**
 * Checks whether an axis-aligned segment runs through a box.
 *
 * @param {Array<Object>} boxes
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @returns {boolean}
 */
function segmentHits(boxes, a, b) {
  const left = Math.min(a.x, b.x)
  const right = Math.max(a.x, b.x)
  const top = Math.min(a.y, b.y)
  const bottom = Math.max(a.y, b.y)
  return boxes.some((box) => {
    if (a.y === b.y) return a.y > box.top && a.y < box.bottom && right > box.left && left < box.right
    return a.x > box.left && a.x < box.right && bottom > box.top && top < box.bottom
  })
}

/**
 * Checks whether a polyline runs through a box.
 *
 * @param {Array<Object>} boxes
 * @param {Array<{x: number, y: number}>} points
 * @returns {boolean}
 */
function polylineHits(boxes, points) {
  return points.slice(1).some((point, i) => segmentHits(boxes, points[i], point))
}

/**
 * Checks whether an axis-aligned step meets a stub anywhere but at the stub's end, so a route can't
 * run back along a stub or cut across it.
 *
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @param {{handle: {x: number, y: number}, end: {x: number, y: number}}} stub
 * @returns {boolean}
 */
function crossesStub(a, b, { handle, end }) {
  const stepLeft = Math.min(a.x, b.x)
  const stepRight = Math.max(a.x, b.x)
  const stepTop = Math.min(a.y, b.y)
  const stepBottom = Math.max(a.y, b.y)
  const stubLeft = Math.min(handle.x, end.x)
  const stubRight = Math.max(handle.x, end.x)
  const stubTop = Math.min(handle.y, end.y)
  const stubBottom = Math.max(handle.y, end.y)
  // The overlap of the two segments' boxes; they meet when it isn't empty.
  const left = Math.max(stepLeft, stubLeft)
  const right = Math.min(stepRight, stubRight)
  const top = Math.max(stepTop, stubTop)
  const bottom = Math.min(stepBottom, stubBottom)
  if (left > right || top > bottom) return false
  return !(left === right && top === bottom && left === end.x && top === end.y)
}

const uniqueSorted = (values) => [...new Set(values)].sort((a, b) => a - b)

/**
 * A binary heap of [priority, value] pairs, smallest first.
 */
class MinHeap {
  constructor() {
    this.items = []
  }

  get size() {
    return this.items.length
  }

  push(priority, value) {
    const items = this.items
    items.push([priority, value])
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (items[parent][0] <= items[i][0]) break
      ;[items[parent], items[i]] = [items[i], items[parent]]
      i = parent
    }
  }

  pop() {
    const items = this.items
    const top = items[0]
    const last = items.pop()
    if (items.length) {
      items[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let smallest = i
        if (l < items.length && items[l][0] < items[smallest][0]) smallest = l
        if (r < items.length && items[r][0] < items[smallest][0]) smallest = r
        if (smallest === i) break
        ;[items[smallest], items[i]] = [items[i], items[smallest]]
        i = smallest
      }
    }
    return top[1]
  }
}

/**
 * Finds the cheapest right-angled path between two stub ends, on the grid of the boxes' outlines.
 *
 * @param {Array<Object>} boxes - Inflated obstacles.
 * @param {Array<{handle: Object, end: Object}>} stubs - The edge's stubs, which a route may only touch at their ends.
 * @param {{x: number, y: number}} start
 * @param {number} startDirection - Index into DIRECTIONS the route leaves start along.
 * @param {{x: number, y: number}} end
 * @param {number} endDirection - Index into DIRECTIONS the route should arrive at end along.
 * @param {number} bendPenalty
 * @returns {Array<{x: number, y: number}>|null} Points from start to end, or null when walled in.
 */
function findPath(boxes, stubs, start, startDirection, end, endDirection, bendPenalty) {
  const left = Math.min(start.x, end.x, ...boxes.map((b) => b.left)) - 1
  const right = Math.max(start.x, end.x, ...boxes.map((b) => b.right)) + 1
  const top = Math.min(start.y, end.y, ...boxes.map((b) => b.top)) - 1
  const bottom = Math.max(start.y, end.y, ...boxes.map((b) => b.bottom)) + 1
  const xs = uniqueSorted([left, right, start.x, end.x, ...boxes.flatMap((b) => [b.left, b.right])])
  const ys = uniqueSorted([top, bottom, start.y, end.y, ...boxes.flatMap((b) => [b.top, b.bottom])])
  const width = xs.length

  const blocked = new Map()
  const isBlocked = (ix, iy) => {
    const key = iy * width + ix
    if (!blocked.has(key)) blocked.set(key, isInside(boxes, xs[ix], ys[iy]))
    return blocked.get(key)
  }
  // Between neighbouring grid lines no outline lies, so a step is clear when its middle is.
  const stepClear = (ix, iy, jx, jy) => {
    if (isInside(boxes, (xs[ix] + xs[jx]) / 2, (ys[iy] + ys[jy]) / 2)) return false
    const a = { x: xs[ix], y: ys[iy] }
    const b = { x: xs[jx], y: ys[jy] }
    return !stubs.some((stub) => crossesStub(a, b, stub))
  }

  const sx = xs.indexOf(start.x)
  const sy = ys.indexOf(start.y)
  const ex = xs.indexOf(end.x)
  const ey = ys.indexOf(end.y)
  const heuristic = (ix, iy) => Math.abs(xs[ix] - end.x) + Math.abs(ys[iy] - end.y)
  const stateKey = (ix, iy, d) => (iy * width + ix) * 4 + d

  const cost = new Map()
  const previous = new Map()
  const open = new MinHeap()
  const startKey = stateKey(sx, sy, startDirection)
  cost.set(startKey, 0)
  open.push(heuristic(sx, sy), startKey)

  while (open.size) {
    const key = open.pop()
    const d = key % 4
    const cell = (key - d) / 4
    const ix = cell % width
    const iy = (cell - ix) / width
    const here = cost.get(key)

    // The extra turn into a stub reached from the side is already in its cost, so the first
    // arrival taken off the heap is the cheapest.
    if (ix === ex && iy === ey) {
      const points = []
      for (let k = key; k !== undefined; k = previous.get(k)) {
        const kc = (k - (k % 4)) / 4
        points.push({ x: xs[kc % width], y: ys[(kc - (kc % width)) / width] })
      }
      return points.reverse()
    }

    DIRECTIONS.forEach((dir, nd) => {
      if (nd === OPPOSITE[d]) return
      const jx = ix + dir.x
      const jy = iy + dir.y
      if (jx < 0 || jy < 0 || jx >= width || jy >= ys.length) return
      if (isBlocked(jx, jy) || !stepClear(ix, iy, jx, jy)) return
      const step = Math.abs(xs[jx] - xs[ix]) + Math.abs(ys[jy] - ys[iy])
      let next = here + step + (nd === d ? 0 : bendPenalty)
      if (jx === ex && jy === ey && nd !== endDirection) next += bendPenalty
      const nextKey = stateKey(jx, jy, nd)
      if (next < (cost.get(nextKey) ?? Infinity)) {
        cost.set(nextKey, next)
        previous.set(nextKey, key)
        open.push(next + heuristic(jx, jy), nextKey)
      }
    })
  }
  return null
}

/**
 * Routes each edge around the obstacles.
 *
 * @param {Array<Object>} requests - Each { id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition }.
 * @param {Object} options
 * @param {Array<{x: number, y: number, width: number, height: number}>} options.obstacles - Module rectangles.
 * @param {number} [options.margin=MARGIN]
 * @param {number} [options.bendPenalty=BEND_PENALTY]
 * @returns {Map<string, Array<{x: number, y: number}>|undefined>} Edge id to waypoints; undefined
 *   when the plain smoothstep line is already clear. Edges with no way through are left out.
 */
export function routeAll(requests, { obstacles, margin = MARGIN, bendPenalty = BEND_PENALTY }) {
  const boxes = inflate(obstacles, margin)
  const bare = inflate(obstacles, 0)
  const routes = new Map()
  requests.forEach((request) => {
    const plain = smoothstepPoints(request)
    if (!polylineHits(boxes, plain.slice(1, -1))) {
      routes.set(request.id, undefined)
      return
    }
    const source = { x: request.sourceX, y: request.sourceY }
    const target = { x: request.targetX, y: request.targetY }
    const start = stubPoint(source.x, source.y, request.sourcePosition)
    const end = stubPoint(target.x, target.y, request.targetPosition)
    // A module close in front of a handle keeps no margin for this edge; only one over a stub end blocks it.
    const edgeBoxes = boxes.map((box, i) => (isInside([box], start.x, start.y) || isInside([box], end.x, end.y) ? bare[i] : box))
    if (isInside(edgeBoxes, start.x, start.y) || isInside(edgeBoxes, end.x, end.y)) return
    const stubs = [
      { handle: source, end: start },
      { handle: target, end },
    ]
    const path = findPath(
      edgeBoxes,
      stubs,
      start,
      SIDE_DIRECTION[request.sourcePosition] ?? 2,
      end,
      OPPOSITE[SIDE_DIRECTION[request.targetPosition] ?? 3],
      bendPenalty
    )
    // Exact, so no jog between grid lines that lie close together is lost.
    if (path) routes.set(request.id, simplify(path, 0).slice(1, -1))
  })
  return routes
}

export default { name: 'orthogonal', routeAll }
