import { describe, expect, it, vi } from 'vitest'
import { primeMenuItems } from '../../../../src/services/bioView/menus'
import { parameterSetMenu } from '../../../../src/utils/parameters/sets'

describe('primeMenuItems', () => {
  it('gives the diagram Apply Parameter Set submenu as PrimeVue items, the current set ticked', () => {
    const apply = vi.fn()
    const sets = [{ ref: 'lumen' }, { ref: 'capillary' }]
    const [menu] = primeMenuItems(parameterSetMenu(sets, 'capillary', 'lumen', apply), {
      'Apply Parameter Set': 'pi pi-sliders-h',
    })

    expect(menu.label).toBe('Apply Parameter Set')
    expect(menu.icon).toBe('pi pi-sliders-h')
    expect(menu.command).toBeUndefined()
    const capillary = menu.items.find((item) => item.label.startsWith('capillary'))
    expect(capillary.icon).toBe('pi pi-check')
    expect(menu.items.filter((item) => item.icon === 'pi pi-check')).toHaveLength(1)
    expect(menu.items.map((item) => item.label)).toEqual(['lumen (default)', 'capillary'])

    capillary.command()
    expect(apply).toHaveBeenCalledWith('capillary')
  })

  it('gives nothing when the diagram menu has nothing', () => {
    expect(primeMenuItems(parameterSetMenu([], null, null, vi.fn()))).toEqual([])
  })
})
