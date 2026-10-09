import { describe, expect, it } from 'vitest'

import {
  SVG_ICONS,
  el,
  escapeXml,
  fitText,
  markerPlacement,
  markerTransform,
  normalisePathData,
  num,
  parseRgb,
  resolveRadius,
} from '../../../../src/services/export/svg'

// A fixed-pitch font: every character is 10 units wide.
const measure = (text) => text.length * 10

describe('SVG export helpers', () => {
  it('escapes text for content and attributes', () => {
    expect(escapeXml(`a<b> & "c" 'd'`)).toBe('a&lt;b&gt; &amp; &quot;c&quot; &apos;d&apos;')
  })

  it('writes numbers with at most two decimals', () => {
    expect(num(1.23456)).toBe('1.23')
    expect(num(-0.5)).toBe('-0.5')
    expect(num(3)).toBe('3')
  })

  it('builds elements, dropping empty attributes', () => {
    expect(el('rect', { x: 1.005, y: 2, fill: '#fff', stroke: null, rx: undefined, id: '' })).toBe('<rect x="1" y="2" fill="#fff"/>')
    expect(el('text', { 'font-family': '"Helvetica Neue", Arial' }, 'a &amp; b')).toBe(
      '<text font-family="&quot;Helvetica Neue&quot;, Arial">a &amp; b</text>'
    )
  })

  it('shortens text with an ellipsis as CSS does', () => {
    expect(fitText('short', 100, measure)).toBe('short')
    expect(fitText('abcdefghij', 60, measure)).toBe('abcde…')
    expect(fitText('abc def ghi', 60, measure)).toBe('abc d…')
    expect(fitText('abcdefghij', 60, measure, false)).toBe('abcdef')
    expect(fitText('abcdefghij', 10, measure)).toBe('…')
    expect(fitText('abcdefghij', 5, measure)).toBe('')
  })

  it('resolves border radii, capped at half the shorter side', () => {
    expect(resolveRadius('10px', 200, 100)).toBe(10)
    expect(resolveRadius('50%', 14, 14)).toBe(7)
    expect(resolveRadius('999px', 40, 20)).toBe(10)
    expect(resolveRadius('0px', 40, 20)).toBe(0)
  })

  it('reads rgb colours in both syntaxes and treats transparent as nothing', () => {
    expect(parseRgb('rgb(255, 0, 16)')).toEqual({ hex: '#ff0010', opacity: 1 })
    expect(parseRgb('rgba(51, 65, 85, 0.7)')).toEqual({ hex: '#334155', opacity: 0.7 })
    expect(parseRgb('rgb(51 65 85 / 40%)')).toEqual({ hex: '#334155', opacity: 0.4 })
    expect(parseRgb('rgba(0, 0, 0, 0)')).toBeNull()
    expect(parseRgb('color(srgb 0.2 0.3 0.4)')).toBeUndefined()
  })

  it('has a path for the icons the instance card and warning badges use', () => {
    for (const name of ['pi-box', 'pi-file', 'pi-exclamation-triangle']) expect(SVG_ICONS[name]).toMatch(/^M/)
  })

  it('rewrites path data with plain separators and rounded numbers', () => {
    expect(normalisePathData('M-193.4078101972567 322.17L -193.40,201.58Q -193.4,196.5 -188.4,196.5')).toBe(
      'M -193.41 322.17 L -193.4 201.58 Q -193.4 196.5 -188.4 196.5'
    )
    expect(normalisePathData('m1e2-.5l3,4z')).toBe('m 100 -0.5 l 3 4 z')
    expect(normalisePathData('M0 0A5 5 0 01 10 10')).toBe('M0 0A5 5 0 01 10 10')
  })
})

/** Applies a matrix(a b c d e f) string to a point. */
function apply(transform, [x, y]) {
  const [a, b, c, d, e, f] = transform.match(/-?[\d.]+(?:e-?\d+)?/g).map(Number)
  return [a * x + c * y + e, b * x + d * y + f]
}

/** A straight path from (x1, y1) to (x2, y2), standing in for SVGPathElement. */
function line([x1, y1], [x2, y2]) {
  const length = Math.hypot(x2 - x1, y2 - y1)
  return {
    getTotalLength: () => length,
    getPointAtLength: (at) => ({ x: x1 + ((x2 - x1) * at) / length, y: y1 + ((y2 - y1) * at) / length }),
  }
}

// Vue Flow's closed arrow, as PhLynx draws it.
const ARROW = { viewBox: [-10, -10, 20, 20], refX: 0, refY: 0, markerWidth: 12.5, markerHeight: 12.5, markerUnits: 'strokeWidth' }

describe('arrowheads without <marker>', () => {
  it('points along the end of an edge, tip on the end point', () => {
    // An edge running straight up, as the smoothstep edges into a top handle do.
    const placement = markerPlacement(line([0, 100], [0, 0]), false, 'auto-start-reverse')
    expect(placement.point).toEqual({ x: 0, y: 0 })
    expect(placement.angle).toBeCloseTo(-90)

    const transform = markerTransform(ARROW, placement.point, placement.angle, 5)
    const [tipX, tipY] = apply(transform, [0, 0])
    expect(tipX).toBeCloseTo(0)
    expect(tipY).toBeCloseTo(0)
    // The arrow's back corners (-5, ±4) sit behind the tip, i.e. further down the edge.
    const [, backY] = apply(transform, [-5, 4])
    expect(backY).toBeCloseTo(5 * (12.5 * 5) / 20)
  })

  it('reverses auto-start-reverse at the start of a path only', () => {
    const path = line([0, 0], [100, 0])
    expect(markerPlacement(path, true, 'auto-start-reverse').angle).toBeCloseTo(180)
    expect(markerPlacement(path, true, 'auto').angle).toBeCloseTo(0)
    expect(markerPlacement(path, false, '45').angle).toBe(45)
    expect(markerPlacement(line([3, 3], [3, 3]), false, 'auto')).toBeNull()
  })

  it('scales by stroke width unless the marker uses user space', () => {
    const at = { x: 10, y: 20 }
    const [x] = apply(markerTransform(ARROW, at, 0, 2), [-10, 0])
    expect(x).toBeCloseTo(10 - 12.5)
    const [xUser] = apply(markerTransform({ ...ARROW, markerUnits: 'userSpaceOnUse' }, at, 0, 2), [-10, 0])
    expect(xUser).toBeCloseTo(10 - 6.25)
  })
})
