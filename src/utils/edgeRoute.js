/**
 * edgeRoute.js
 *
 * Geometry for coupling edges drawn through user waypoints. A route is an orthogonal polyline
 * [source, source stub, ...bends, target stub, target]; waypoints are the bends the user placed, in
 * flow coordinates, stored as `edge.data.waypoints`. An edge without waypoints is drawn by vue-flow's
 * getSmoothStepPath, and smoothstepPoints gives the same route as points, so it can be edited.
 */

import { Position } from '@vue-flow/core'

/** Length of the straight run out of a handle, as getSmoothStepPath's default offset. */
export const STUB = 20

/** Radius of a rounded bend, as getSmoothStepPath's default borderRadius. */
export const CORNER_RADIUS = 5

/** Most waypoints an edge keeps; more is taken to be a broken file. */
export const MAX_WAYPOINTS = 64

const DIRECTIONS = {
  [Position.Left]: { x: -1, y: 0 },
  [Position.Right]: { x: 1, y: 0 },
  [Position.Top]: { x: 0, y: -1 },
  [Position.Bottom]: { x: 0, y: 1 },
}

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)
const distance = (a, b) => Math.hypot(b.x - a.x, b.y - a.y)
const isHorizontal = (side) => side === Position.Left || side === Position.Right

/**
 * Gives the unit vector pointing out of a handle on this side.
 *
 * @param {string} side - A vue-flow Position.
 * @returns {{x: number, y: number}}
 */
export function sideVector(side) {
  return DIRECTIONS[side] ?? DIRECTIONS[Position.Bottom]
}

/**
 * Gives the end of the stub out of a handle.
 *
 * @param {number} x
 * @param {number} y
 * @param {string} side
 * @param {number} [length=STUB]
 * @returns {{x: number, y: number}}
 */
export function stubPoint(x, y, side, length = STUB) {
  const dir = sideVector(side)
  return { x: x + dir.x * length, y: y + dir.y * length }
}

/**
 * Gives the points getSmoothStepPath draws through, source and target included.
 * Ported from @vue-flow/core's getPoints (MIT, (c) webkid GmbH and Burak Cakmakoglu), which is not exported.
 *
 * @param {Object} params - Edge props: sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition.
 * @param {number} [params.offset=STUB]
 * @returns {Array<{x: number, y: number}>}
 */
export function smoothstepPoints({
  sourceX,
  sourceY,
  sourcePosition = Position.Bottom,
  targetX,
  targetY,
  targetPosition = Position.Top,
  offset = STUB,
}) {
  const source = { x: sourceX, y: sourceY }
  const target = { x: targetX, y: targetY }
  const sourceDir = sideVector(sourcePosition)
  const targetDir = sideVector(targetPosition)
  const sourceGapped = stubPoint(sourceX, sourceY, sourcePosition, offset)
  const targetGapped = stubPoint(targetX, targetY, targetPosition, offset)
  const dir = isHorizontal(sourcePosition)
    ? { x: sourceGapped.x < targetGapped.x ? 1 : -1, y: 0 }
    : { x: 0, y: sourceGapped.y < targetGapped.y ? 1 : -1 }
  const axis = dir.x !== 0 ? 'x' : 'y'
  const currDir = dir[axis]
  const sourceGapOffset = { x: 0, y: 0 }
  const targetGapOffset = { x: 0, y: 0 }
  let points

  if (sourceDir[axis] * targetDir[axis] === -1) {
    const centerX = (sourceX + targetX) / 2
    const centerY = (sourceY + targetY) / 2
    const verticalSplit = [
      { x: centerX, y: sourceGapped.y },
      { x: centerX, y: targetGapped.y },
    ]
    const horizontalSplit = [
      { x: sourceGapped.x, y: centerY },
      { x: targetGapped.x, y: centerY },
    ]
    if (sourceDir[axis] === currDir) points = axis === 'x' ? verticalSplit : horizontalSplit
    else points = axis === 'x' ? horizontalSplit : verticalSplit
  } else {
    const sourceTarget = [{ x: sourceGapped.x, y: targetGapped.y }]
    const targetSource = [{ x: targetGapped.x, y: sourceGapped.y }]
    if (axis === 'x') points = sourceDir.x === currDir ? targetSource : sourceTarget
    else points = sourceDir.y === currDir ? sourceTarget : targetSource

    if (sourcePosition === targetPosition) {
      const diff = Math.abs(source[axis] - target[axis])
      if (diff <= offset) {
        const gapOffset = Math.min(offset - 1, offset - diff)
        if (sourceDir[axis] === currDir) {
          sourceGapOffset[axis] = (sourceGapped[axis] > source[axis] ? -1 : 1) * gapOffset
        } else {
          targetGapOffset[axis] = (targetGapped[axis] > target[axis] ? -1 : 1) * gapOffset
        }
      }
    } else {
      const opposite = axis === 'x' ? 'y' : 'x'
      const isSameDir = sourceDir[axis] === targetDir[opposite]
      const sourceGt = sourceGapped[opposite] > targetGapped[opposite]
      const sourceLt = sourceGapped[opposite] < targetGapped[opposite]
      const flip =
        (sourceDir[axis] === 1 && ((!isSameDir && sourceGt) || (isSameDir && sourceLt))) ||
        (sourceDir[axis] !== 1 && ((!isSameDir && sourceLt) || (isSameDir && sourceGt)))
      if (flip) points = axis === 'x' ? sourceTarget : targetSource
    }
  }

  return [
    source,
    { x: sourceGapped.x + sourceGapOffset.x, y: sourceGapped.y + sourceGapOffset.y },
    ...points,
    { x: targetGapped.x + targetGapOffset.x, y: targetGapped.y + targetGapOffset.y },
    target,
  ]
}

/**
 * Picks the elbow between two points that share neither x nor y.
 *
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @param {'x'|'y'} firstAxis - The axis to travel along first.
 * @returns {{x: number, y: number}}
 */
function elbow(a, b, firstAxis) {
  return firstAxis === 'x' ? { x: b.x, y: a.y } : { x: a.x, y: b.y }
}

/**
 * Makes a path through the stubs and waypoints orthogonal, adding one elbow wherever two
 * consecutive points share neither x nor y. The route leaves the source stub along the stub's axis
 * unless that would double back over the stub, and arrives at the target stub the same way.
 *
 * @param {Array<{x: number, y: number}>} points - [source stub, ...waypoints, target stub].
 * @param {string} sourceSide
 * @param {string} targetSide
 * @returns {Array<{x: number, y: number}>}
 */
export function orthogonalise(points, sourceSide, targetSide) {
  if (points.length < 2) return points.slice()
  const sourceDir = sideVector(sourceSide)
  const targetDir = sideVector(targetSide)
  const sourceAxis = isHorizontal(sourceSide) ? 'x' : 'y'
  const targetAxis = isHorizontal(targetSide) ? 'x' : 'y'
  const last = points.length - 1
  const out = [points[0]]
  let previousAxis = sourceAxis

  for (let i = 0; i < last; i++) {
    const a = points[i]
    const b = points[i + 1]
    if (a.x !== b.x && a.y !== b.y) {
      let firstAxis
      if (i === last - 1) {
        // Arrive along the target stub, moving towards the node, unless b lies behind a.
        const isAhead = (a[targetAxis] - b[targetAxis]) * targetDir[targetAxis] > 0
        firstAxis = isAhead ? (targetAxis === 'x' ? 'y' : 'x') : targetAxis
      } else if (i === 0) {
        const isAhead = (b[sourceAxis] - a[sourceAxis]) * sourceDir[sourceAxis] > 0
        firstAxis = isAhead ? sourceAxis : sourceAxis === 'x' ? 'y' : 'x'
      } else {
        firstAxis = previousAxis === 'x' ? 'y' : 'x'
      }
      out.push(elbow(a, b, firstAxis))
      previousAxis = firstAxis === 'x' ? 'y' : 'x'
    } else {
      previousAxis = a.y === b.y ? 'x' : 'y'
    }
    out.push(b)
  }
  return out
}

/**
 * Drops repeated points and the middle of three collinear points.
 *
 * @param {Array<{x: number, y: number}>} points
 * @param {number} [tolerance=0.5]
 * @returns {Array<{x: number, y: number}>}
 */
export function simplify(points, tolerance = 0.5) {
  const out = []
  points.forEach((point) => {
    const previous = out[out.length - 1]
    if (previous && distance(previous, point) <= tolerance) return
    const beforePrevious = out[out.length - 2]
    if (
      beforePrevious &&
      ((Math.abs(beforePrevious.x - previous.x) <= tolerance && Math.abs(previous.x - point.x) <= tolerance) ||
        (Math.abs(beforePrevious.y - previous.y) <= tolerance && Math.abs(previous.y - point.y) <= tolerance))
    ) {
      out[out.length - 1] = point
      return
    }
    out.push(point)
  })
  return out
}

/**
 * Gives the whole route of an edge through its waypoints.
 *
 * @param {Object} edge - Edge props: sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition.
 * @param {Array<{x: number, y: number}>} waypoints
 * @returns {Array<{x: number, y: number}>} Source first, target last.
 */
export function fullPolyline(edge, waypoints) {
  const { sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition } = edge
  const source = { x: sourceX, y: sourceY }
  const target = { x: targetX, y: targetY }
  const inner = orthogonalise(
    [stubPoint(sourceX, sourceY, sourcePosition), ...waypoints, stubPoint(targetX, targetY, targetPosition)],
    sourcePosition,
    targetPosition
  )
  return [source, ...simplify(inner), target]
}

/**
 * Draws a bend with a rounded corner, as getSmoothStepPath does.
 * Ported from @vue-flow/core's getBend (MIT).
 */
function bend(a, b, c, size) {
  const bendSize = Math.min(distance(a, b) / 2, distance(b, c) / 2, size)
  const { x, y } = b
  if ((a.x === x && x === c.x) || (a.y === y && y === c.y)) return `L${x} ${y}`
  if (a.y === y) {
    const xDir = a.x < c.x ? -1 : 1
    const yDir = a.y < c.y ? 1 : -1
    return `L ${x + bendSize * xDir},${y}Q ${x},${y} ${x},${y + bendSize * yDir}`
  }
  const xDir = a.x < c.x ? 1 : -1
  const yDir = a.y < c.y ? -1 : 1
  return `L ${x},${y + bendSize * yDir}Q ${x},${y} ${x + bendSize * xDir},${y}`
}

/**
 * Gives the SVG path of a polyline with rounded bends, matching getSmoothStepPath's output.
 *
 * @param {Array<{x: number, y: number}>} points
 * @param {number} [radius=CORNER_RADIUS]
 * @returns {string}
 */
export function roundedPath(points, radius = CORNER_RADIUS) {
  return points.reduce((path, point, i) => {
    if (i > 0 && i < points.length - 1) return path + bend(points[i - 1], point, points[i + 1], radius)
    return path + `${i === 0 ? 'M' : 'L'}${point.x} ${point.y}`
  }, '')
}

/**
 * Gives the point halfway along a polyline, for a label.
 *
 * @param {Array<{x: number, y: number}>} points
 * @returns {{x: number, y: number}}
 */
export function midpointAlong(points) {
  const lengths = points.slice(1).map((point, i) => distance(points[i], point))
  let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2
  for (let i = 0; i < lengths.length; i++) {
    if (remaining <= lengths[i] && lengths[i] > 0) {
      const t = remaining / lengths[i]
      return { x: points[i].x + (points[i + 1].x - points[i].x) * t, y: points[i].y + (points[i + 1].y - points[i].y) * t }
    }
    remaining -= lengths[i]
  }
  return { ...points[points.length - 1] }
}

/**
 * Moves waypoints by an offset.
 *
 * @param {Array<{x: number, y: number}>|undefined} waypoints
 * @param {number} dx
 * @param {number} dy
 * @returns {Array<{x: number, y: number}>|undefined}
 */
export function translateWaypoints(waypoints, dx, dy) {
  return waypoints?.map(({ x, y }) => ({ x: x + dx, y: y + dy }))
}

/**
 * Gives edge data with its waypoints moved by an offset, for an edge whose two ends both moved.
 *
 * @param {Object|undefined} data
 * @param {number} dx
 * @param {number} dy
 * @returns {Object|undefined} data itself when it has no valid waypoints.
 */
export function offsetEdgeData(data, dx, dy) {
  const waypoints = sanitiseWaypoints(data?.waypoints)
  return waypoints ? withEdgeWaypoints(data, translateWaypoints(waypoints, dx, dy)) : data
}

/**
 * Checks waypoints read from a file or the clipboard.
 *
 * @param {*} value
 * @returns {Array<{x: number, y: number}>|undefined} Plain copies, or undefined unless value is a
 *   non-empty array of at most MAX_WAYPOINTS points with finite coordinates.
 */
export function sanitiseWaypoints(value) {
  if (!Array.isArray(value) || !value.length || value.length > MAX_WAYPOINTS) return undefined
  if (!value.every((point) => isFiniteNumber(point?.x) && isFiniteNumber(point?.y))) return undefined
  return value.map(({ x, y }) => ({ x, y }))
}

/**
 * Gives an edge's valid waypoints.
 *
 * @param {Object} edge - An edge, or edge props, with `data`.
 * @returns {Array<{x: number, y: number}>|undefined}
 */
export function getEdgeWaypoints(edge) {
  return sanitiseWaypoints(edge?.data?.waypoints)
}

/**
 * Gives edge data with these waypoints, or without any when there are none.
 *
 * @param {Object|undefined} data
 * @param {Array<{x: number, y: number}>|undefined} waypoints
 * @returns {Object}
 */
export function withEdgeWaypoints(data, waypoints) {
  const { waypoints: _old, ...rest } = data ?? {}
  return waypoints?.length ? { ...rest, waypoints } : rest
}

/**
 * Removes the waypoints of every edge, so each is drawn as smoothstep again.
 *
 * @param {Array<Object>} edges - Edges to change in place.
 */
export function clearWaypoints(edges) {
  edges.forEach((edge) => {
    if (edge.data && 'waypoints' in edge.data) edge.data = withEdgeWaypoints(edge.data, undefined)
  })
}
