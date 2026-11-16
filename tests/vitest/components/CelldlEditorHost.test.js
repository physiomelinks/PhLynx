import { flushPromises, mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

const received = []
vi.mock('@celldl/editor', () => ({
  default: defineComponent({
    name: 'StubCellDLEditor',
    props: ['wheelMode', 'arrowStyle', 'unitSystem', 'chrome', 'elementInfo', 'annotations'],
    setup(props) {
      return () => {
        received.push(props.wheelMode)
        return h('div', {
          class: 'stub-editor',
          'data-wheel-mode': props.wheelMode,
          'data-location-shading': String(props.chrome?.locationShading),
          'data-palette': props.chrome?.palette,
          'data-element-info': JSON.stringify(props.elementInfo),
          'data-annotations': String(props.annotations),
        })
      }
    },
  }),
}))
vi.mock('@celldl/editor/style.css?inline', () => ({ default: '' }))

describe('CelldlEditorHost', () => {
  let wrapper
  afterEach(() => wrapper?.unmount())

  it('passes the scrolling setting to the editor as wheelMode, following changes', async () => {
    const { useAppSettings } = await import('../../../src/composables/useAppSettings')
    const { saveAppSettings } = useAppSettings()
    saveAppSettings({ celldlWheelMode: 'auto' })
    const { default: CelldlEditorHost } = await import('../../../src/components/celldl/CelldlEditorHost.vue')
    wrapper = mount(CelldlEditorHost, { attachTo: document.body })
    await vi.waitFor(async () => {
      await flushPromises()
      expect(document.querySelector('.stub-editor')).not.toBeNull()
    })
    expect(document.querySelector('.stub-editor').dataset.wheelMode).toBe('auto')

    saveAppSettings({ celldlWheelMode: 'zoom' })
    await flushPromises()
    expect(document.querySelector('.stub-editor').dataset.wheelMode).toBe('zoom')
    expect(received.at(-1)).toBe('zoom')
  })

  it("passes location shading as the chrome's option, following the setting, and element info as elementInfo", async () => {
    const { useAppSettings } = await import('../../../src/composables/useAppSettings')
    const { useCelldlEditorHost } = await import('../../../src/composables/useCelldlEditorHost')
    const { saveAppSettings } = useAppSettings()
    saveAppSettings({ celldlLocationShading: true })
    useCelldlEditorHost().setLiveAnnotations({ X: { primary: 'q_X' } })
    const { default: CelldlEditorHost } = await import('../../../src/components/celldl/CelldlEditorHost.vue')
    wrapper = mount(CelldlEditorHost, { attachTo: document.body })
    await vi.waitFor(async () => {
      await flushPromises()
      expect(document.querySelector('.stub-editor')).not.toBeNull()
    })
    const stub = () => document.querySelector('.stub-editor').dataset
    expect(stub().locationShading).toBe('true')
    expect(stub().palette).toBe('top')
    expect(JSON.parse(stub().elementInfo)).toEqual({ X: { primary: 'q_X' } })
    expect(stub().annotations).toBe('undefined')

    saveAppSettings({ celldlLocationShading: false })
    await flushPromises()
    expect(stub().locationShading).toBe('false')
    saveAppSettings({ celldlLocationShading: true })
  })
})
