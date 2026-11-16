import { describe, expect, it, vi } from 'vitest'

import { cardParameterSetOptions, NO_PARAMETER_SET, parameterSetMenu, parameterSetOptions, parameterSetRows, pickedRef, preferredModuleIndex } from '../../../src/utils/parameters/sets.js'

const param = (value, units = '') => ({ value, units, data_reference: '', extra: {} })
const set = (ref, globals = [], values = []) => ({ ref, globals: new Map(globals), values: new Map(values) })
const SETS = [set('lumen'), set('enterocyte'), set('capillary')]

describe('pickedRef', () => {
  it('keeps a chosen set the math still has, else follows the default', () => {
    expect(pickedRef(SETS, 'capillary', 'lumen')).toBe('capillary')
    expect(pickedRef(SETS, 'gone', 'lumen')).toBe('lumen')
    expect(pickedRef(SETS, null, 'enterocyte')).toBe('enterocyte')
  })

  it('gives none when neither is held', () => {
    expect(pickedRef(SETS, null, 'missing')).toBeNull()
    expect(pickedRef([], 'lumen', 'lumen')).toBeNull()
  })
})

describe('parameterSetOptions', () => {
  it('lists every set, marking the default', () => {
    expect(parameterSetOptions(SETS, 'enterocyte')).toEqual([
      { label: 'lumen', value: 'lumen' },
      { label: 'enterocyte (default)', value: 'enterocyte' },
      { label: 'capillary', value: 'capillary' },
    ])
  })
})

describe('parameterSetRows', () => {
  it('lists globals then values, keeping values still to be filled as null', () => {
    const rows = parameterSetRows(set('NKA', [['F', param('96485', 'C_per_mol')]], [['K', param('5', 'mM')], ['blank', param(null)]]))
    expect(rows).toEqual([
      { name: 'F', value: '96485', units: 'C_per_mol', kind: 'global' },
      { name: 'K', value: '5', units: 'mM', kind: 'value' },
      { name: 'blank', value: null, units: '', kind: 'value' },
    ])
  })
})

describe('preferredModuleIndex', () => {
  const loaded = new Set(['m:enterocyte', 'm:capillary'])
  const getSet = (mathRef, ref) => (loaded.has(`${mathRef}:${ref}`) ? {} : null)
  const config = (defaultParameterisation) => ({ mathRef: 'm', defaultParameterisation })

  it('gives the first config whose default set is loaded', () => {
    expect(preferredModuleIndex([config(), config('lumen'), config('enterocyte'), config('capillary')], getSet)).toBe(2)
  })

  it('gives the first config when none has a loaded default', () => {
    expect(preferredModuleIndex([config(), config('lumen')], getSet)).toBe(0)
    expect(preferredModuleIndex([], getSet)).toBe(0)
  })
})

describe('cardParameterSetOptions', () => {
  it('offers None first, then the sets with the default marked', () => {
    expect(cardParameterSetOptions(SETS.slice(0, 2), 'enterocyte')).toEqual([
      { label: 'None', value: NO_PARAMETER_SET },
      { label: 'lumen', value: 'lumen' },
      { label: 'enterocyte (default)', value: 'enterocyte' },
    ])
  })
})

describe('parameterSetMenu', () => {
  it("lists the math's sets, checking the instance's own and marking the default; picking one applies it", () => {
    const apply = vi.fn()
    const [menu] = parameterSetMenu(SETS, 'enterocyte', 'lumen', apply)

    expect(menu.label).toBe('Apply Parameter Set')
    expect(menu.items.map(({ label, checked }) => [label, checked])).toEqual([
      ['lumen (default)', false],
      ['enterocyte', true],
      ['capillary', false],
    ])
    menu.items[2].action()
    expect(apply).toHaveBeenCalledWith('capillary')
  })

  it('offers no None, and no entry for a math with no sets', () => {
    expect(parameterSetMenu(SETS, null, null, () => {})[0].items.map((item) => item.label)).not.toContain('None')
    expect(parameterSetMenu([], 'lumen', 'lumen', () => {})).toEqual([])
  })
})
