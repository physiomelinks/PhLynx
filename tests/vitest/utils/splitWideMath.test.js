import { describe, expect, it } from 'vitest'

import { splitWideMath } from '../../../src/utils/cellml.js'
import { CELLML_NS, MATHML_NS } from '../../../src/utils/constants.js'

const term = (i) => `<apply><times/><cn cellml:units="dimensionless">${i}</cn><ci>x${i}</ci></apply>`
const sum = (n) => `<apply><plus/>${Array.from({ length: n }, (_, i) => term(i)).join('')}</apply>`
const math = (...equations) => `<math xmlns="${MATHML_NS}" xmlns:cellml="${CELLML_NS}">${equations.join('')}</math>`
const equation = (i, rhs = `<cn cellml:units="dimensionless">${i}</cn>`) => `<apply><eq/><ci>y${i}</ci>${rhs}</apply>`

const parse = (text) => new DOMParser().parseFromString(`<root>${text}</root>`, 'application/xml')
const operandCounts = (doc) => Array.from(doc.getElementsByTagNameNS(MATHML_NS, 'apply'), (apply) => apply.children.length - 1)
const termOrder = (doc) => Array.from(doc.getElementsByTagNameNS(MATHML_NS, 'ci'), (ci) => ci.textContent)

describe('splitWideMath', () => {
  it('leaves math within the limits as it is', () => {
    const text = math(...Array.from({ length: 100 }, (_, i) => equation(i, sum(3))))
    expect(splitWideMath(text)).toBe(text)
    expect(splitWideMath(math(equation(0, sum(100))))).toBe(math(equation(0, sum(100))))
  })

  it('groups a wide sum into sums of at most 100 operands, keeping their order', () => {
    const doc = parse(splitWideMath(math(equation(0, sum(382)))))
    expect(Math.max(...operandCounts(doc))).toBeLessThanOrEqual(100)
    expect(termOrder(doc)).toEqual(['y0', ...Array.from({ length: 382 }, (_, i) => `x${i}`)])
    // eq, the outer sum of 4 groups, the groups, and each term's product.
    expect(operandCounts(doc).filter((count) => count > 2)).toEqual([4, 100, 100, 100, 82])
  })

  it('groups again when there are more than 100 groups', () => {
    const doc = parse(splitWideMath(math(equation(0, sum(10001)))))
    expect(Math.max(...operandCounts(doc))).toBeLessThanOrEqual(100)
    expect(termOrder(doc)).toHaveLength(10002)
  })

  it('groups a wide sum nested inside another expression', () => {
    const doc = parse(splitWideMath(math(equation(0, `<apply><minus/>${sum(250)}<ci>z</ci></apply>`))))
    expect(Math.max(...operandCounts(doc))).toBeLessThanOrEqual(100)
  })

  it('leaves an operator whose operands can’t be regrouped', () => {
    const wideMin = `<apply><min/>${Array.from({ length: 150 }, (_, i) => `<ci>x${i}</ci>`).join('')}</apply>`
    const text = math(equation(0, wideMin))
    expect(splitWideMath(text)).toBe(text)
  })

  it('splits a <math> of more than 100 equations into several, each keeping its namespaces', () => {
    const split = splitWideMath(math(...Array.from({ length: 250 }, (_, i) => equation(i))))
    const doc = parse(split)
    const blocks = Array.from(doc.documentElement.children)
    expect(blocks.map((block) => block.children.length)).toEqual([100, 100, 50])
    expect(blocks.every((block) => block.namespaceURI === MATHML_NS)).toBe(true)
    expect(split.match(/xmlns:cellml=/g)).toHaveLength(3)
    expect(termOrder(doc)).toEqual(Array.from({ length: 250 }, (_, i) => `y${i}`))
  })
})
