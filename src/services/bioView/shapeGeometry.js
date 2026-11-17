/**
 * The geometry a skin gives a cell when its SVG names what is what: an element with the id `outline` is the cell's
 * outline, `facet-<id>` the stretch of membrane a protein site runs along, `region-<id>` the area of a space inside
 * the cell, and `anchor-<id>` where a junction, a process area, an organelle or the cell's name goes. Everything
 * else is artwork. Only numbers are read from the named elements: each becomes a run of points.
 */

/** The ids that name geometry, by what they stand for. */
export const SHAPE_IDS = Object.freeze({ outline: /^outline$/, facet: /^facet-(.+)$/, region: /^region-(.+)$/, anchor: /^anchor-(.+)$/ })

/** Whether an element's id names geometry, which is then no part of the artwork. */
export const isShapeId = (id) => typeof id === 'string' && Object.values(SHAPE_IDS).some((pattern) => pattern.test(id))

/** How many straight pieces a curve is cut into. */
const CURVE_STEPS = 16

const NUMBER = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g

/**
 * Cuts an elliptical arc into points, from its end points as SVG path data gives them (see the SVG implementation
 * notes on arcs). Its start is left out.
 */
function arcPoints(from, rx, ry, turn, isLarge, isSweep, to) {
  if (!rx || !ry) return [to]
  const phi = (turn * Math.PI) / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (from.x - to.x) / 2
  const dy = (from.y - to.y) / 2
  const x1 = cos * dx + sin * dy
  const y1 = -sin * dx + cos * dy
  let a = Math.abs(rx)
  let b = Math.abs(ry)
  const stretch = (x1 * x1) / (a * a) + (y1 * y1) / (b * b)
  if (stretch > 1) {
    a *= Math.sqrt(stretch)
    b *= Math.sqrt(stretch)
  }
  const top = a * a * b * b - a * a * y1 * y1 - b * b * x1 * x1
  const scale = (isLarge === isSweep ? -1 : 1) * Math.sqrt(Math.max(0, top) / (a * a * y1 * y1 + b * b * x1 * x1 || 1))
  const cx1 = (scale * a * y1) / b
  const cy1 = (-scale * b * x1) / a
  const cx = cos * cx1 - sin * cy1 + (from.x + to.x) / 2
  const cy = sin * cx1 + cos * cy1 + (from.y + to.y) / 2
  const angle = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const start = angle(1, 0, (x1 - cx1) / a, (y1 - cy1) / b)
  let sweep = angle((x1 - cx1) / a, (y1 - cy1) / b, (-x1 - cx1) / a, (-y1 - cy1) / b)
  if (!isSweep && sweep > 0) sweep -= 2 * Math.PI
  if (isSweep && sweep < 0) sweep += 2 * Math.PI
  return Array.from({ length: CURVE_STEPS }, (_, i) => {
    const t = start + (sweep * (i + 1)) / CURVE_STEPS
    return { x: cx + a * Math.cos(t) * cos - b * Math.sin(t) * sin, y: cy + a * Math.cos(t) * sin + b * Math.sin(t) * cos }
  })
}

/**
 * Turns SVG path data into a run of points: its lines as they are, and its curves cut into straight pieces. Only its
 * first subpath is read.
 *
 * @param {string} d
 * @returns {{points: Array<{x: number, y: number}>, isClosed: boolean}}
 */
export function flattenPath(d) {
  const points = []
  let isClosed = false
  let at = { x: 0, y: 0 }
  let start = null
  let control = null
  let last = ''
  const cubic = (p0, p1, p2, p3) =>
    Array.from({ length: CURVE_STEPS }, (_, i) => {
      const t = (i + 1) / CURVE_STEPS
      const u = 1 - t
      return {
        x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
        y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
      }
    })
  const quadratic = (p0, p1, p2) => cubic(p0, { x: p0.x + (2 / 3) * (p1.x - p0.x), y: p0.y + (2 / 3) * (p1.y - p0.y) }, { x: p2.x + (2 / 3) * (p1.x - p2.x), y: p2.y + (2 / 3) * (p1.y - p2.y) }, p2)
  const sizes = { m: 2, l: 2, h: 1, v: 1, c: 6, s: 4, q: 4, t: 2, a: 7, z: 0 }
  for (const [, command, rest] of String(d ?? '').matchAll(/([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g)) {
    const kind = command.toLowerCase()
    const isRelative = command === kind
    const values = (rest.match(NUMBER) ?? []).map(Number)
    if (kind === 'z') {
      isClosed = true
      break
    }
    if (kind === 'm' && start) break
    for (let i = 0; i + sizes[kind] <= values.length; i += sizes[kind]) {
      const v = values.slice(i, i + sizes[kind])
      const point = (x, y) => (isRelative ? { x: at.x + x, y: at.y + y } : { x, y })
      const mirror = control && 'csqt'.includes(last) ? { x: 2 * at.x - control.x, y: 2 * at.y - control.y } : at
      let next
      let added
      control = null
      if (kind === 'm' || kind === 'l') {
        next = point(v[0], v[1])
        added = [next]
        if (kind === 'm' && !start) start = next
      } else if (kind === 'h') {
        next = { x: isRelative ? at.x + v[0] : v[0], y: at.y }
        added = [next]
      } else if (kind === 'v') {
        next = { x: at.x, y: isRelative ? at.y + v[0] : v[0] }
        added = [next]
      } else if (kind === 'c' || kind === 's') {
        const [c1, c2] = kind === 'c' ? [point(v[0], v[1]), point(v[2], v[3])] : [last === 'c' || last === 's' ? mirror : at, point(v[0], v[1])]
        next = kind === 'c' ? point(v[4], v[5]) : point(v[2], v[3])
        added = cubic(at, c1, c2, next)
        control = c2
      } else if (kind === 'q' || kind === 't') {
        const c1 = kind === 'q' ? point(v[0], v[1]) : last === 'q' || last === 't' ? mirror : at
        next = kind === 'q' ? point(v[2], v[3]) : point(v[0], v[1])
        added = quadratic(at, c1, next)
        control = c1
      } else {
        next = point(v[5], v[6])
        added = arcPoints(at, v[0], v[1], v[2], !!v[3], !!v[4], next)
      }
      points.push(...added)
      at = next
      last = kind
    }
  }
  return { points, isClosed }
}

/** A run of points' length. */
export function lengthOf(points) {
  let total = 0
  for (let i = 1; i < points.length; i++) total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y)
  return total
}

/**
 * Finds the point a distance along a run of points, and the way the run is heading there.
 *
 * @param {Array<{x: number, y: number}>} points
 * @param {number} distance - Kept within the run.
 * @returns {{x: number, y: number, angle: number}} angle: its heading, in degrees clockwise from +x on screen.
 */
export function pointAlong(points, distance) {
  let left = Math.max(0, distance)
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const piece = Math.hypot(b.x - a.x, b.y - a.y)
    if (!piece) continue
    if (left <= piece || i === points.length - 1) {
      const t = Math.min(1, left / piece)
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, angle: (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI }
    }
    left -= piece
  }
  return { ...(points[0] ?? { x: 0, y: 0 }), angle: 0 }
}

/** The box round a run of points. */
export function boundsOf(points) {
  const xs = points.map((point) => point.x)
  const ys = points.map((point) => point.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y }
}

/** Whether a point is inside a closed run of points. */
export function isInside(points, { x, y }) {
  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i]
    const b = points[j]
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

/**
 * Reads an SVG element as a run of points: a path, a rect, a circle or ellipse (as its box), a line, a polyline or a
 * polygon.
 *
 * @param {Element} element
 * @returns {{points: Array<{x: number, y: number}>, isClosed: boolean}|null} Null for anything else, or with fewer
 *   than two points.
 */
export function elementPoints(element) {
  const number = (name) => parseFloat(element.getAttribute(name)) || 0
  const tag = element.tagName.toLowerCase()
  let run = null
  if (tag === 'path') run = flattenPath(element.getAttribute('d'))
  else if (tag === 'rect') {
    const [x, y, w, h] = ['x', 'y', 'width', 'height'].map(number)
    run = { points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], isClosed: true }
  } else if (tag === 'circle' || tag === 'ellipse') {
    const [cx, cy] = [number('cx'), number('cy')]
    const [rx, ry] = tag === 'circle' ? [number('r'), number('r')] : [number('rx'), number('ry')]
    run = { points: [{ x: cx - rx, y: cy - ry }, { x: cx + rx, y: cy - ry }, { x: cx + rx, y: cy + ry }, { x: cx - rx, y: cy + ry }], isClosed: true }
  } else if (tag === 'line') {
    run = { points: [{ x: number('x1'), y: number('y1') }, { x: number('x2'), y: number('y2') }], isClosed: false }
  } else if (tag === 'polyline' || tag === 'polygon') {
    const values = (element.getAttribute('points') ?? '').match(NUMBER)?.map(Number) ?? []
    const points = []
    for (let i = 0; i + 1 < values.length; i += 2) points.push({ x: values[i], y: values[i + 1] })
    run = { points, isClosed: tag === 'polygon' }
  }
  return run && run.points.length >= 2 && run.points.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) ? run : null
}

/**
 * Reads the geometry a cleaned skin names, in its viewBox's own units from the viewBox's corner.
 *
 * @param {Element} root - The skin's `<svg>`, with a viewBox.
 * @returns {{ shape: Object|null, warnings: string[] }} shape: `{ width, height, outline, facets, regions, anchors }`,
 *   outline a closed run of points, facets id -> run of points, regions id -> { points, bounds }, anchors id ->
 *   box; null when the skin names no outline, which leaves it artwork alone.
 */
export function readShape(root) {
  const warnings = []
  const [minX, minY, width, height] = (root.getAttribute('viewBox') ?? '').match(NUMBER)?.map(Number) ?? []
  if (!(width > 0) || !(height > 0)) return { shape: null, warnings }
  const shift = (points) => points.map((point) => ({ x: point.x - minX, y: point.y - minY }))
  const shape = { width, height, outline: null, facets: {}, regions: {}, anchors: {} }
  for (const element of root.querySelectorAll('[id]')) {
    const id = element.getAttribute('id')
    if (!isShapeId(id)) continue
    // A turned or moved element's numbers aren't where it is drawn: nothing is read from it.
    let isMoved = false
    for (let each = element; each && each !== root; each = each.parentElement) isMoved ||= each.hasAttribute('transform')
    const run = isMoved ? null : elementPoints(element)
    if (!run) {
      warnings.push(isMoved ? `"${id}" is moved by a transform, so its place can't be read.` : `"${id}" is not a shape that can be read.`)
      continue
    }
    const points = shift(run.points)
    if (SHAPE_IDS.outline.test(id)) shape.outline = points
    else if (SHAPE_IDS.facet.test(id)) shape.facets[id.match(SHAPE_IDS.facet)[1]] = points
    else if (SHAPE_IDS.region.test(id)) shape.regions[id.match(SHAPE_IDS.region)[1]] = { points, bounds: boundsOf(points) }
    else shape.anchors[id.match(SHAPE_IDS.anchor)[1]] = boundsOf(points)
  }
  if (!shape.outline) return { shape: null, warnings }
  return { shape, warnings }
}

/** Writes a run of points as SVG path data. */
export const pathOf = (points, isClosed = true) =>
  points.map((point, i) => `${i ? 'L' : 'M'}${Math.round(point.x * 10) / 10} ${Math.round(point.y * 10) / 10}`).join(' ') + (isClosed ? ' Z' : '')
