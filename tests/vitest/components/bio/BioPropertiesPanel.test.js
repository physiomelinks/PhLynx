// @vitest-environment happy-dom
import { computed, reactive, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { contextOfModule } from '../../../../src/services/bioView/skinContext.js'
import { NO_SKIN } from '../../../../src/services/bioView/skinRegistry.js'

const nodes = ref([])

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({ nodes, getSelectedNodes: computed(() => nodes.value.filter((node) => node.selected)) }),
}))

const { default: BioPropertiesPanel } = await import('../../../../src/components/bio/BioPropertiesPanel.vue')

const role = (value, skin = null, terms = []) => ({ role: value, skin, skinContext: contextOfModule(value, terms) })
const PROTEIN_SKINS = ['symporter', 'antiporter', 'uniporter', 'pump', 'channel', 'receptor', 'generic']

let wrapper
let properties

function mountPanel(roles) {
  properties = { roles: ref(new Map(Object.entries(roles))), chooseSkin: vi.fn() }
  wrapper = mount(BioPropertiesPanel, { props: { properties }, global: { plugins: [PrimeVue] } })
}

const select = (...ids) => {
  nodes.value = ['p', 'q', 'gly', 'cell'].map((id) => reactive({ id, selected: ids.includes(id), data: { name: id } }))
}
const tiles = () => wrapper.findAll('.skin-tile')
const tile = (skin) => wrapper.find(`.skin-tile[data-skin="${skin}"]`)

describe('BioPropertiesPanel', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => wrapper?.unmount())

  it('asks for a selection until there is one', () => {
    select()
    mountPanel({})
    expect(wrapper.text()).toContain('Select one or more instances')
  })

  it('offers a protein only a protein’s cartoons, its own marked, with no None', () => {
    select('p')
    mountPanel({ p: role('membraneProtein', 'pump') })
    expect(tiles().map((t) => t.attributes('data-skin'))).toEqual(PROTEIN_SKINS)
    expect(tile('pump').classes()).toContain('skin-tile--active')
  })

  it('puts the cartoons the selection’s annotations match first', () => {
    select('p', 'q')
    mountPanel({ p: role('membraneProtein', 'pump', ['GO:0005242']), q: role('membraneProtein', 'pump', ['GO:0005391']) })
    expect(tiles().map((t) => t.attributes('data-skin'))).toEqual([
      'pump',
      'channel',
      ...PROTEIN_SKINS.filter((id) => !['pump', 'channel'].includes(id)),
    ])
  })

  it('offers a process None, marked once chosen, and sets the choice for the whole selection', async () => {
    select('gly')
    mountPanel({ gly: role('cytosolic') })
    expect(tile(NO_SKIN).classes()).toContain('skin-tile--active')
    expect(tiles().map((t) => t.attributes('data-skin'))).toEqual([NO_SKIN, 'myofilament', 'mitochondrion', 'process'])
    await tile(NO_SKIN).trigger('click')
    expect(properties.chooseSkin).toHaveBeenCalledWith(['gly'], NO_SKIN)
    await tile('mitochondrion').trigger('click')
    expect(properties.chooseSkin).toHaveBeenCalledWith(['gly'], 'mitochondrion')
  })

  it('shows a mixed selection’s cartoons as mixed, and none for what has no cartoon', () => {
    select('p', 'q')
    mountPanel({ p: role('membraneProtein', 'pump'), q: role('membraneProtein', 'channel') })
    expect(wrapper.text()).toContain('more than one skin')
    expect(wrapper.findAll('.skin-tile--active')).toHaveLength(0)

    wrapper.unmount()
    select('p', 'cell')
    mountPanel({ p: role('membraneProtein', 'pump'), cell: role('cytosol') })
    expect(tiles()).toHaveLength(0)

    // A protein and a process are not one thing: no cartoons for both.
    wrapper.unmount()
    select('p', 'gly')
    mountPanel({ p: role('membraneProtein', 'pump'), gly: role('cytosolic') })
    expect(tiles()).toHaveLength(0)
  })
})
