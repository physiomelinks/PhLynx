// @vitest-environment happy-dom
import { computed, reactive, ref } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BUILT_IN_GLYPHS, NO_GLYPH } from '../../../../src/services/bioView/glyphs.js'

const nodes = ref([])

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({ nodes, getSelectedNodes: computed(() => nodes.value.filter((node) => node.selected)) }),
}))

const { default: BioPropertiesPanel } = await import('../../../../src/components/bio/BioPropertiesPanel.vue')

const role = (value, glyph = null) => ({ role: value, glyph })

let wrapper
let properties

function mountPanel(roles) {
  properties = { roles: ref(new Map(Object.entries(roles))), chooseRole: vi.fn(), chooseGlyph: vi.fn() }
  wrapper = mount(BioPropertiesPanel, { props: { properties }, global: { plugins: [PrimeVue] } })
}

const select = (...ids) => {
  nodes.value = ['p', 'q', 'gly', 'cell'].map((id) => reactive({ id, selected: ids.includes(id), data: { name: id } }))
}
const tiles = () => wrapper.findAll('.glyph-tile')
const tile = (glyph) => wrapper.find(`.glyph-tile[data-glyph="${glyph}"]`)

describe('BioPropertiesPanel', () => {
  beforeEach(() => setActivePinia(createPinia()))
  afterEach(() => wrapper?.unmount())

  it('asks for a selection until there is one', () => {
    select()
    mountPanel({})
    expect(wrapper.text()).toContain('Select one or more instances')
    expect(wrapper.find('[data-testid="bio-properties-role"]').exists()).toBe(false)
  })

  it('offers a protein’s cartoons, its own marked, with no None', () => {
    select('p')
    mountPanel({ p: role('membraneProtein', 'pump') })
    expect(tiles().map((t) => t.attributes('data-glyph'))).toEqual(BUILT_IN_GLYPHS.map((g) => g.id))
    expect(tile('pump').classes()).toContain('glyph-tile--active')
  })

  it('offers a process None, marked while it has no cartoon, and sets the choice for the whole selection', async () => {
    select('gly')
    mountPanel({ gly: role('cytosolic') })
    expect(tile(NO_GLYPH).classes()).toContain('glyph-tile--active')
    await tile('mitochondrion').trigger('click')
    expect(properties.chooseGlyph).toHaveBeenCalledWith(['gly'], 'mitochondrion')
  })

  it('shows a mixed selection’s cartoons as mixed, and none for what has no cartoon', () => {
    select('p', 'q')
    mountPanel({ p: role('membraneProtein', 'pump'), q: role('membraneProtein', 'channel') })
    expect(wrapper.text()).toContain('more than one cartoon')
    expect(wrapper.findAll('.glyph-tile--active')).toHaveLength(0)

    wrapper.unmount()
    select('p', 'cell')
    mountPanel({ p: role('membraneProtein', 'pump'), cell: role('cytosol') })
    expect(tiles()).toHaveLength(0)
  })
})
