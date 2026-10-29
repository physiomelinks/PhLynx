// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { undrawnElements, undrawnError } from '../../../../src/services/celldl/drawing.js'

const SVG = (body) => `<svg xmlns="http://www.w3.org/2000/svg"><metadata id="celldl-rdf-metadata"/>${body}</svg>`

describe('undrawnElements', () => {
  it('finds the elements with no SVG element, or an empty group, as the CellDL editor needs one drawn', () => {
    const document = SVG('<g id="a"><image href="a.svg"/></g><g id="b"/><g id="c"> </g><path id="d.e" d="M0,0"/>')
    expect(undrawnElements(document, ['a', 'b', 'c', 'd.e', 'f'])).toEqual(['b', 'c', 'f'])
    expect(undrawnElements(document, [])).toEqual([])
  })
})

describe('undrawnError', () => {
  it('names the elements', () => {
    expect(undrawnError(['a'])).toEqual({ message: "The diagram has no drawing of a, so the CellDL editor can't open it", severity: 'error', stage: 'diagram' })
    expect(undrawnError(['a', 'b', 'c']).message).toBe("The diagram has no drawing of a, b and c, so the CellDL editor can't open it")
  })
})
