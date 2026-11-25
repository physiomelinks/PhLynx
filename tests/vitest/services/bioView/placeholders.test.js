import { describe, expect, it } from 'vitest'

import { isPlaceholder, placeholderName } from '../../../../src/services/bioView/placeholders.js'
import { NEW_INSTANCE_MODULE_REF } from '../../../../src/utils/constants.js'

const node = (moduleRef = NEW_INSTANCE_MODULE_REF) => ({ id: 'n', data: { moduleRef } })

describe('placeholders', () => {
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
