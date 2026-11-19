import { describe, expect, it } from 'vitest'

import { FACETS, LATERAL_SIDES, isFacet } from '../../../../src/services/bioView/facets.js'

describe('facets', () => {
  it('names the facets of an epithelial cell and the sides of its lateral facet', () => {
    expect(FACETS).toEqual(['apical', 'lateral', 'basolateral'])
    expect(LATERAL_SIDES).toEqual(['left', 'right'])
    expect(Object.isFrozen(FACETS) && Object.isFrozen(LATERAL_SIDES)).toBe(true)
  })

  it('tells a facet from anything else', () => {
    expect(FACETS.every(isFacet)).toBe(true)
    for (const value of ['top', 'Apical', '', null, undefined, 0]) expect(isFacet(value)).toBe(false)
  })
})
