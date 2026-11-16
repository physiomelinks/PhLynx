import { describe, expect, it } from 'vitest'

import { isPlaceholder, placeholderName, takesPlaceholder } from '../../../../src/services/bioView/placeholders.js'
import { NEW_INSTANCE_MODULE_REF } from '../../../../src/utils/constants.js'

const area = (role, extra = {}) => ({ type: 'area', kind: 'single', role, occupant: null, ...extra })
const node = (moduleRef = NEW_INSTANCE_MODULE_REF) => ({ id: 'n', data: { moduleRef } })

describe('placeholders', () => {
  it.each(['cytosol', 'membrane', 'region', 'cytosolic'])('go on an empty one-module %s site', (role) => {
    expect(takesPlaceholder(area(role))).toBe(true)
  })

  it('stay off a taken site, and off the rows of a protein site or process zone', () => {
    expect(takesPlaceholder(area('cytosol', { occupant: 'x' }))).toBe(false)
    expect(takesPlaceholder({ type: 'slot', kind: 'slots', role: 'membraneProtein', occupant: null })).toBe(false)
    expect(takesPlaceholder({ type: 'area', kind: 'slots', role: 'cytosolic', occupant: null })).toBe(false)
  })

  it('are new modules joined only by placement', () => {
    const placed = { source: 'n', target: 'm', data: { placement: 'across' } }
    const drawn = { source: 'm', target: 'n', data: { placement: false } }
    expect(isPlaceholder(node(), [placed])).toBe(true)
    expect(isPlaceholder(node(), [placed, drawn])).toBe(false)
    expect(isPlaceholder(node('pump:lib'), [])).toBe(false)
    expect(isPlaceholder(undefined, [])).toBe(false)
  })

  it('are named for their piece, as instance names are written', () => {
    expect(placeholderName('Cell 2', ['new_module'])).toBe('Cell_2')
    expect(placeholderName('Plasma membrane', ['Plasma_membrane'])).toBe('Plasma_membrane_1')
    expect(placeholderName('!!', [])).toBeNull()
  })
})
