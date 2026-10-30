// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { flowMatrix, parseRgb, serialiseInlineSvg } from '../../../../src/services/export/svg'

const NS = 'http://www.w3.org/2000/svg'

/** Builds an <svg> from markup. */
function svgFrom(markup) {
  const host = document.createElement('div')
  host.innerHTML = `<svg xmlns="${NS}" viewBox="0 0 64 48">${markup}</svg>`
  return host.firstElementChild
}

/** Computed styles as a browser would give them, from a data-style attribute on each element. */
const BASE = { display: 'inline', visibility: 'visible', opacity: '1', fill: 'rgb(0, 0, 0)', stroke: 'none', strokeWidth: '1px', fillOpacity: '1', strokeOpacity: '1' }
const getStyle = (element) => ({ ...BASE, ...JSON.parse(element.getAttribute('data-style') ?? '{}') })

const serialise = (svg) =>
  serialiseInlineSvg(svg, {
    getStyle,
    colour: (css) => (css === 'none' ? null : parseRgb(css)),
    idPrefix: 'p-',
    serialise: (element) => new XMLSerializer().serializeToString(element),
  })

describe('inline SVG export', () => {
  it('maps the svg’s own units into flow coordinates', () => {
    // Drawn at 2x on screen, 100px right and 50px down of the root, with the viewport panned by 20.
    const matrix = flowMatrix({ a: 2, b: 0, c: 0, d: 2, e: 160, f: 90 }, { left: 40, top: 20 }, { x: 20, y: 20, zoom: 2 })
    expect(matrix).toBe('matrix(1 0 0 1 50 25)')
  })

  it('writes each shape’s computed paint as attributes, dropping classes and styles', () => {
    const svg = svgFrom(
      `<path class="glyph" style="fill: currentColor" d="M0 0L10 10" data-style='{"fill":"rgb(255, 0, 0)","stroke":"rgba(0, 0, 255, 0.5)","strokeWidth":"3px","strokeLinecap":"round"}'/>`
    )
    const out = serialise(svg)
    expect(out).toContain('fill="#ff0000"')
    expect(out).toContain('stroke="#0000ff"')
    expect(out).toContain('stroke-opacity="0.5"')
    expect(out).toContain('stroke-width="3"')
    expect(out).toContain('stroke-linecap="round"')
    expect(out).not.toContain(' class=')
    expect(out).not.toContain(' style=')
    expect(out).not.toContain('xmlns')
  })

  it('leaves out what is hidden', () => {
    const svg = svgFrom(`<circle r="4" data-style='{"display":"none"}'/><rect width="4" height="4"/>`)
    const out = serialise(svg)
    expect(out).not.toContain('<circle')
    expect(out).toContain('<rect')
  })

  it('prefixes ids and the references to them, keeping definitions', () => {
    const svg = svgFrom(
      `<defs><linearGradient id="g"><stop offset="0" data-style='{"stopColor":"rgb(0, 128, 0)","stopOpacity":"1"}'/></linearGradient></defs>` +
        `<rect width="4" height="4" data-style='{"fill":"url(\\"#g\\")"}'/>`
    )
    const out = serialise(svg)
    expect(out).toContain('id="p-g"')
    expect(out).toContain('fill="url(#p-g)"')
    expect(out).toContain('stop-color="#008000"')
  })

  it('keeps text’s font', () => {
    const svg = svgFrom(`<text data-style='{"fontFamily":"Inter","fontSize":"12px","fontWeight":"600"}'>Na+</text>`)
    const out = serialise(svg)
    expect(out).toContain('font-family="Inter"')
    expect(out).toContain('font-size="12"')
    expect(out).toContain('font-weight="600"')
    expect(out).toContain('>Na+</text>')
  })
})
