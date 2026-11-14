// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, describe, expect, it } from 'vitest'

import SpeciesMenu from '../../../../src/components/bio/SpeciesMenu.vue'

const SPECIES = [
  { species: 'CHEBI:29101', label: 'Na⁺', colour: 'red' },
  { species: 'CHEBI:29103', label: 'K⁺', colour: 'blue' },
]
// The popover's content is shown only once opened by a click, and then teleported: mounted in place here.
const Popover = { template: '<div><slot /></div>', methods: { toggle() {} } }

let wrapper
const mountMenu = (props = {}) => {
  wrapper = mount(SpeciesMenu, {
    props: { species: SPECIES, ...props },
    global: { plugins: [PrimeVue], stubs: { Popover } },
  })
}
const rows = () => wrapper.findAll('[data-testid="bio-species-menu-item"]')
const lastEmitted = (event) => wrapper.emitted(event).at(-1)[0]

afterEach(() => wrapper?.unmount())

describe('the species menu', () => {
  it('lists every species in scope, ticked unless hidden', () => {
    mountMenu({ hidden: ['CHEBI:29103'] })
    expect(rows().map((row) => row.text())).toEqual(['Na⁺', 'K⁺'])
    expect(rows().map((row) => row.find('input').element.checked)).toEqual([true, false])
  })

  it('hides a species unticked and shows one ticked', async () => {
    mountMenu({ hidden: ['CHEBI:29103'] })
    await rows()[0].find('input').trigger('change')
    expect(lastEmitted('update:hidden')).toEqual(['CHEBI:29103', 'CHEBI:29101'])
    await rows()[1].find('input').trigger('change')
    expect(lastEmitted('update:hidden')).toEqual([])
  })

  it('shows all or none at once, keeping hidden what is out of scope', async () => {
    mountMenu({ hidden: ['CHEBI:1'] })
    const [all, none] = wrapper.findAll('button')
    await none.trigger('click')
    expect(lastEmitted('update:hidden')).toEqual(['CHEBI:1', 'CHEBI:29101', 'CHEBI:29103'])
    await all.trigger('click')
    expect(lastEmitted('update:hidden')).toEqual([])
  })

  it('chooses which species are in scope', async () => {
    mountMenu({ scope: 'coupled' })
    const radios = wrapper.findAll('input[type="radio"]')
    expect(radios.map((radio) => radio.element.checked)).toEqual([true, false, false])
    await radios[1].trigger('change')
    expect(lastEmitted('update:scope')).toBe('fluxes')
  })
})
