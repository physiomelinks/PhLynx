/**
 * Finds the point of a series nearest the cursor on screen, for a chart whose x values needn't increase, as a
 * phase plot's don't, so the nearest x alone won't do.
 */

// Above this many points, a first pass looks at every so many, and a second searches around the best of them.
const FULL_SCAN_LIMIT = 50000

/**
 * Finds the index of the point nearest a position, measured in pixels so that the axes' units don't skew it.
 *
 * @param {ArrayLike<number>} xs
 * @param {ArrayLike<number>} ys
 * @param {(value: number) => number} toLeft - An x value's pixel position.
 * @param {(value: number) => number} toTop - A y value's pixel position.
 * @param {number} left - The cursor's pixel position.
 * @param {number} top
 * @param {number} [radius=Infinity] - How far away, in pixels, a point can be and still be found.
 * @returns {number|null} The index, or null when no point is within the radius.
 */
export function findNearestPoint(xs, ys, toLeft, toTop, left, top, radius = Infinity) {
  const count = Math.min(xs.length, ys.length)
  const distanceAt = (i) => {
    if (!Number.isFinite(xs[i]) || !Number.isFinite(ys[i])) return Infinity
    return Math.hypot(toLeft(xs[i]) - left, toTop(ys[i]) - top)
  }
  const nearestIn = (from, to, step) => {
    let best = null
    let bestDistance = Infinity
    for (let i = from; i < to; i += step) {
      const distance = distanceAt(i)
      if (distance < bestDistance) {
        best = i
        bestDistance = distance
      }
    }
    return { best, bestDistance }
  }

  const stride = Math.ceil(count / FULL_SCAN_LIMIT)
  let { best, bestDistance } = nearestIn(0, count, stride)
  if (stride > 1 && best !== null) ({ best, bestDistance } = nearestIn(Math.max(0, best - stride + 1), Math.min(count, best + stride), 1))
  return bestDistance <= radius ? best : null
}
