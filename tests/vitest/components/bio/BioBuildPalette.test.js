// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import BioBuildPalette from '../../../../src/components/bio/BioBuildPalette.vue'
import { TILE_DRAG_TYPE } from '../../../../src/services/bioView/palette.js'

const TEMPLATES = [{ id: 'epithelial', name: 'Epithelial cell' }]
let wrapper
// Opened, as a viewer who uses it leaves it, unless a test says otherwise.
const mountPalette = (props = {}, isOpen = true) => {
  if (isOpen) localStorage.setItem('phlynx.bioPalette.collapsed', '0')
  return (wrapper = mount(BioBuildPalette, { props: { templates: TEMPLATES, ...props } }))
}
const tile = (kind) => wrapper.find(`[data-testid="bio-palette-tile"][data-kind="${kind}"]`)

afterEach(() => {
  wrapper.unmount()
  localStorage.clear()
})

describe('the build palette', () => {
  it('offers the empty pieces a view is built from', () => {
    mountPalette()
    expect(wrapper.findAll('[data-testid="bio-palette-tile"]').map((each) => each.attributes('data-kind'))).toEqual(['cell', 'compartment', 'organelle', 'microdomain', 'fold', 'site', 'zone'])
  })

  it('arms a tile on a click, and lets go of it on another', async () => {
    mountPalette()
    await tile('site').trigger('click')
    expect(wrapper.emitted('arm')).toEqual([[{ kind: 'site' }]])
    await wrapper.setProps({ armed: { kind: 'site' } })
    expect(tile('site').attributes('aria-pressed')).toBe('true')
    await tile('site').trigger('click')
    expect(wrapper.emitted('arm').at(-1)).toEqual([null])
  })

  it('carries a dragged tile, and says when the drag ends', async () => {
    mountPalette({ armed: { kind: 'zone' } })
    const data = {}
    await tile('cell').trigger('dragstart', { dataTransfer: { setData: (type, value) => (data[type] = value) } })
    expect(JSON.parse(data[TILE_DRAG_TYPE])).toEqual({ kind: 'cell' })
    expect(wrapper.emitted('arm')).toEqual([[null]])
    expect(wrapper.emitted('drag')).toEqual([[{ kind: 'cell' }]])
    await tile('cell').trigger('dragend')
    expect(wrapper.emitted('drag').at(-1)).toEqual([null])
  })

  it('lists the templates to place once opened, and offers to load a file', async () => {
    mountPalette()
    expect(wrapper.find('[data-testid="bio-palette-template"]').exists()).toBe(false)
    await wrapper.find('[data-testid="bio-palette-templates"]').trigger('click')
    const template = wrapper.find('[data-testid="bio-palette-template"]')
    expect(template.text()).toBe('Epithelial cell')
    await template.trigger('click')
    expect(wrapper.emitted('arm')).toEqual([[{ kind: 'template', template: 'epithelial' }]])
    await wrapper.findAll('.bio-palette__tile--template').at(-1).trigger('click')
    expect(wrapper.emitted('load-template')).toHaveLength(1)
  })

  it('starts folded away, and once opened stays so the next time', async () => {
    mountPalette({}, false)
    expect(wrapper.findAll('[data-testid="bio-palette-tile"]')).toHaveLength(0)
    await wrapper.find('[data-testid="bio-palette-toggle"]').trigger('click')
    expect(wrapper.findAll('[data-testid="bio-palette-tile"]')).toHaveLength(7)
    wrapper.unmount()
    mountPalette({}, false)
    expect(wrapper.findAll('[data-testid="bio-palette-tile"]')).toHaveLength(7)
  })
})
