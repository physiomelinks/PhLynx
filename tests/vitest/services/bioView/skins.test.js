// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { SKIN_LIMITS, sanitiseSkin, skinHref } from '../../../../src/services/bioView/skins.js'

const svg = (inner, attributes = 'viewBox="0 0 10 10"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attributes}>${inner}</svg>`

describe('cleaning a skin', () => {
  it('keeps a drawing’s shapes, paints and clips', () => {
    const { svg: clean, errors } = sanitiseSkin(svg('<defs><linearGradient id="g"><stop offset="0" stop-color="red"/></linearGradient></defs><g><path d="M0 0h10" fill="url(#g)"/><circle cx="5" cy="5" r="2"/></g>'))
    expect(errors).toEqual([])
    expect(clean).toContain('<path')
    expect(clean).toContain('url(#g)')
    expect(clean).toContain('linearGradient')
    expect(clean).toContain('viewBox="0 0 10 10"')
  })

  it('drops what runs or reaches outside the drawing', () => {
    const dirty = svg(
      '<script>alert(1)</script><foreignObject><div>x</div></foreignObject><image href="https://example.org/a.png"/>' +
        '<style>@import url(https://example.org/a.css)</style><a href="https://example.org"><rect width="1" height="1"/></a>' +
        '<rect width="4" height="4" onclick="alert(1)" style="fill:url(https://example.org/x)" fill="url(https://example.org/p#q)"/>' +
        '<use href="https://example.org/other.svg#shape"/><use href="#local"/><path d="M0 0" onload="x()"/>'
    )
    const { svg: clean } = sanitiseSkin(dirty)
    for (const gone of ['script', 'foreignObject', 'image', '<style', '<a ', 'onclick', 'onload', 'example.org', 'style=']) {
      expect(clean).not.toContain(gone)
    }
    expect(clean).toContain('href="#local"')
    expect(clean).toContain('<rect')
  })

  it('gives a drawing sized by itself a viewBox, and takes its size away', () => {
    const { svg: clean } = sanitiseSkin(svg('<rect width="3" height="3"/>', 'width="40" height="20"'))
    expect(clean).toContain('viewBox="0 0 40 20"')
    expect(clean).not.toMatch(/<svg[^>]* width=/)
  })

  it('refuses what is no drawing, too big, of no size, or empty once cleaned', () => {
    expect(sanitiseSkin('').errors).toEqual(['The file is empty.'])
    expect(sanitiseSkin('<html><body/></html>').errors).toEqual(['The file is not an SVG drawing.'])
    expect(sanitiseSkin(svg('<rect width="1" height="1"/>', '')).errors).toEqual(['The SVG needs a viewBox, or a width and height.'])
    expect(sanitiseSkin(svg('<script>1</script>')).errors[0]).toContain('Nothing is left to draw')
    expect(sanitiseSkin(svg(`<path d="${'M0 0 '.repeat(SKIN_LIMITS.bytes / 4)}"/>`)).errors[0]).toContain('at most')
  })
})

describe('a skin’s id and address', () => {
  it('names a skin for its file, past the ids taken', () => {
  })

  it('gives a skin as an image’s address', () => {
    expect(skinHref('<svg/>')).toBe('data:image/svg+xml;charset=utf-8,%3Csvg%2F%3E')
  })
})
