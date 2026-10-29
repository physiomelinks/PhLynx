import { describe, expect, it } from 'vitest'

import { variableForElement } from '../../../../src/services/celldl/elements.js'

const rows = [{ name: 'v_1' }, { name: 'q_C' }, { name: 'u_C' }]
const variable = (name) => ({ name, role: 'other', ucum: '1', units: 'dimensionless' })

describe('variableForElement', () => {
  it("plots an element's primary variable when it has a row", () => {
    expect(variableForElement({ primary: 'q_C', variables: [variable('u_C'), variable('q_C')] }, rows)).toBe('q_C')
  })

  it('falls back to its first variable with a row', () => {
    expect(variableForElement({ primary: 'C', variables: [variable('C'), variable('u_C'), variable('q_C')] }, rows)).toBe('u_C')
    expect(variableForElement({ variables: [variable('v_1')] }, rows)).toBe('v_1')
  })

  it("reads a viewer annotation's variables by name", () => {
    expect(variableForElement({ primary: 'C', variables: ['C', 'q_C'] }, rows)).toBe('q_C')
  })

  it('gives null when none of its variables has a row, or there is no entry', () => {
    expect(variableForElement({ primary: 'x', variables: [variable('y')] }, rows)).toBeNull()
    expect(variableForElement({ primary: 'v_1' }, [])).toBeNull()
    expect(variableForElement(undefined, rows)).toBeNull()
  })
})
