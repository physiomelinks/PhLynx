// @vitest-environment happy-dom
import { flushPromises, mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { afterEach, describe, expect, it } from 'vitest'

import ResizableLibraryPanel from '../../../src/components/ResizableLibraryPanel.vue'

let wrapper
afterEach(() => wrapper?.unmount())

/** Tooltip stub that records the text and placement as data attributes. */
const tooltipStub = {
  mounted(el, binding) {
    el.dataset.tooltip = binding.value
    el.dataset.tooltipPosition = Object.keys(binding.modifiers).join(' ')
  },
}

/** Mounts the panel with a slot body, overlay by default. */
function mountPanel(props = {}) {
  wrapper = mount(ResizableLibraryPanel, {
    props: { initialWidth: 280, ...props },
    slots: { default: '<div class="library-slot">Library</div>' },
    attachTo: document.body,
    global: { plugins: [PrimeVue], directives: { tooltip: tooltipStub } },
  })
  return wrapper
}

const collapseButton = () => wrapper.find('button[aria-label="Hide module library"]')
const expandButton = () => wrapper.find('button[aria-label="Show module library"]')
const panelBody = () => wrapper.find('.library-panel-body')

describe('ResizableLibraryPanel', () => {
  // happy-dom has no layout, so DOM order stands in for the top-right placement.
  it('starts expanded with a left chevron last in the panel header', () => {
    mountPanel()

    expect(wrapper.vm.isCollapsed).toBe(false)
    expect(panelBody().isVisible()).toBe(true)
    expect(expandButton().exists()).toBe(false)

    const header = wrapper.find('.module-aside-header')
    const button = header.find('button')
    expect(button.attributes('aria-label')).toBe('Hide module library')
    expect(button.attributes('aria-expanded')).toBe('true')
    expect(button.find('i').classes()).toContain('pi-chevron-left')
    // Title first, collapse button last, so the chevron sits top-right.
    expect(header.element.lastElementChild).toBe(button.element)
    expect(button.attributes('data-tooltip')).toBe('Hide module library')
  })

  it('does not put a toggle on the resize handle', () => {
    mountPanel()

    expect(wrapper.find('.resize-handle button').exists()).toBe(false)
  })

  it('collapses from the chevron and shows the hamburger', async () => {
    mountPanel()

    await collapseButton().trigger('click')

    expect(wrapper.vm.isCollapsed).toBe(true)
    expect(panelBody().attributes('style')).toContain('display: none')
    const button = expandButton()
    expect(button.exists()).toBe(true)
    expect(button.attributes('aria-expanded')).toBe('false')
    expect(button.find('i').classes()).toContain('pi-bars')
    expect(button.attributes('data-tooltip')).toBe('Show module library')
  })

  it('moves focus to the toggle that appears after each toggle', async () => {
    mountPanel()

    await collapseButton().trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(expandButton().element)

    await expandButton().trigger('click')
    await flushPromises()
    expect(document.activeElement).toBe(collapseButton().element)
  })

  it('expands again from the hamburger', async () => {
    mountPanel()
    await collapseButton().trigger('click')

    await expandButton().trigger('click')

    expect(wrapper.vm.isCollapsed).toBe(false)
    expect(expandButton().exists()).toBe(false)
    expect(panelBody().isVisible()).toBe(true)
    expect(collapseButton().attributes('aria-expanded')).toBe('true')
  })

  it('emits its width when expanded and 0 when collapsed', async () => {
    mountPanel()
    expect(wrapper.emitted('resize').at(-1)).toEqual([280])

    await wrapper.vm.toggleCollapsed()
    expect(wrapper.emitted('resize').at(-1)).toEqual([0])

    await wrapper.vm.toggleCollapsed()
    expect(wrapper.emitted('resize').at(-1)).toEqual([280])
  })

  it('shows the hamburger inline when not an overlay', async () => {
    mountPanel({ overlay: false })
    expect(wrapper.classes()).toContain('resizable-library-panel--inline')

    await collapseButton().trigger('click')

    expect(wrapper.classes()).toContain('resizable-library-panel--collapsed')
    expect(expandButton().exists()).toBe(true)
  })

  it('names what it shows and hides in its toggles', async () => {
    mountPanel({ title: 'User Guide', subject: 'user guide menu' })

    const hide = wrapper.find('button[aria-label="Hide user guide menu"]')
    expect(hide.attributes('data-tooltip')).toBe('Hide user guide menu')
    await hide.trigger('click')

    const show = wrapper.find('button[aria-label="Show user guide menu"]')
    expect(show.exists()).toBe(true)
    expect(show.attributes('data-tooltip')).toBe('Show user guide menu')
  })
})
