// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import BioBuildPalette from '../../../../src/components/bio/BioBuildPalette.vue'
import { TILE_DRAG_TYPE } from '../../../../src/services/bioView/palette.js'
import { useViewModeStore } from '../../../../src/stores/viewModeStore.js'

let wrapper
let viewMode
const tile = (kind) => wrapper.find(`[data-testid="bio-palette-tile"][data-kind="${kind}"]`)

beforeEach(() => {
  setActivePinia(createPinia())
  viewMode = useViewModeStore()
  wrapper = mount(BioBuildPalette)
})
afterEach(() => wrapper.unmount())

describe('the build palette', () => {
  it('offers the empty pieces a view is built from', () => {
    expect(wrapper.findAll('[data-testid="bio-palette-tile"]').map((each) => each.attributes('data-kind'))).toEqual(['cell', 'tube', 'link', 'compartment', 'organelle', 'microdomain', 'junction', 'fold', 'zone'])
  })

  it('arms a tile on a click, for the view to place, and lets go of it on another', async () => {
    await tile('zone').trigger('click')
    expect(viewMode.armedTile).toEqual({ kind: 'zone' })
    expect(tile('zone').attributes('aria-pressed')).toBe('true')
    await tile('zone').trigger('click')
    expect(viewMode.armedTile).toBeNull()
  })

  it('carries a dragged tile, lets go of the one armed, and forgets it as the drag ends', async () => {
    viewMode.armedTile = { kind: 'zone' }
    const data = {}
    await tile('cell').trigger('dragstart', { dataTransfer: { setData: (type, value) => (data[type] = value) } })
    expect(JSON.parse(data[TILE_DRAG_TYPE])).toEqual({ kind: 'cell' })
    expect(viewMode.armedTile).toBeNull()
    expect(viewMode.draggedTile).toEqual({ kind: 'cell' })
    await tile('cell').trigger('dragend')
    expect(viewMode.draggedTile).toBeNull()
  })

  it('lists the templates to place, and asks the view to load one from a file', async () => {
    const templates = wrapper.findAll('[data-testid="bio-palette-template"]')
    expect(templates.map((each) => each.text())).toContain('Epithelial cell')
    await templates.find((each) => each.text() === 'Cardiomyocyte').trigger('click')
    expect(viewMode.armedTile).toEqual({ kind: 'template', template: 'cardiomyocyte' })
    await wrapper.find('[data-testid="bio-palette-load-template"]').trigger('click')
    expect(viewMode.templateFileRequests).toBe(1)
  })

  it('leaves nothing armed once it is gone', () => {
    viewMode.armedTile = { kind: 'cell' }
    wrapper.unmount()
    expect(viewMode.armedTile).toBeNull()
    wrapper = mount(BioBuildPalette)
  })
})
