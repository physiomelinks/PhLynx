// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import FlowMiniMap from '../../../src/components/FlowMiniMap.vue'
import { useAppSettings } from '../../../src/composables/useAppSettings'

const { settings, saveAppSettings } = useAppSettings()

// Vue Flow's own parts need a flow around them; these stand in for them.
const stubs = {
  MiniMap: { template: '<div class="vue-flow__minimap" />' },
  Panel: { template: '<div class="vue-flow__panel"><slot /></div>' },
}

let wrapper
afterEach(() => wrapper?.unmount())
beforeEach(() => {
  window.localStorage.clear()
  saveAppSettings({ showMiniMap: true })
})

const mountMiniMap = () => {
  wrapper = mount(FlowMiniMap, { attrs: { class: 'mini-map', pannable: true }, global: { stubs } })
  return wrapper
}
const button = (label) => wrapper.find(`button[aria-label="${label}"]`)

describe('FlowMiniMap', () => {
  it('shows the minimap, given what the view gives it, with a button to hide it', () => {
    mountMiniMap()
    const minimap = wrapper.find('.vue-flow__minimap')
    expect(minimap.exists()).toBe(true)
    expect(minimap.classes()).toContain('mini-map')
    expect(minimap.attributes('pannable')).toBe('true')
    expect(button('Hide minimap').exists()).toBe(true)
    expect(button('Show minimap').exists()).toBe(false)
    // The view's class is the minimap's alone.
    expect(wrapper.find('.minimap-toggle').classes()).not.toContain('mini-map')
  })

  it('shrinks to a button that brings it back, remembered with the app settings', async () => {
    mountMiniMap()
    await button('Hide minimap').trigger('click')
    expect(settings.showMiniMap).toBe(false)
    expect(JSON.parse(window.localStorage.getItem('phlynx-settings'))).toMatchObject({ showMiniMap: false })
    expect(wrapper.find('.vue-flow__minimap').exists()).toBe(false)
    expect(button('Hide minimap').exists()).toBe(false)

    await button('Show minimap').trigger('click')
    expect(settings.showMiniMap).toBe(true)
    expect(wrapper.find('.vue-flow__minimap').exists()).toBe(true)
  })

  it('starts hidden where the minimap was last left hidden', () => {
    saveAppSettings({ showMiniMap: false })
    mountMiniMap()
    expect(wrapper.find('.vue-flow__minimap').exists()).toBe(false)
    expect(button('Show minimap').exists()).toBe(true)
  })
})
