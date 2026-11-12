// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
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
  updated(el, binding) {
    el.dataset.tooltip = binding.value
  },
}

/** Mounts the panel with a slot body, overlay by default. */
function mountPanel(props = {}) {
  wrapper = mount(ResizableLibraryPanel, {
    props: { initialWidth: 280, ...props },
    slots: { default: '<div class="library-slot">Library</div>' },
    attachTo: document.body,
    global: { plugins: [PrimeVue], directives: { tooltip: tooltipStub, hint: tooltipStub } },
  })
  return wrapper
}

const collapseButton = () => wrapper.find('button[aria-label="Hide module library"]')
const expandButton = () => wrapper.find('button[aria-label="Show module library"]')
const panelBody = () => wrapper.find('.library-panel-body')

const toggle = () => wrapper.find('button.library-toggle')

describe('ResizableLibraryPanel', () => {
  it('starts expanded with the toggle open and outside the panel header', () => {
    mountPanel()

    expect(wrapper.vm.isCollapsed).toBe(false)
    expect(panelBody().isVisible()).toBe(true)
    expect(wrapper.findAll('button')).toHaveLength(1)
    expect(wrapper.find('.module-aside-header button').exists()).toBe(false)

    const button = collapseButton()
    expect(button.exists()).toBe(true)
    expect(button.attributes('aria-expanded')).toBe('true')
    expect(button.classes()).toContain('library-toggle--open')
    expect(button.findAll('svg line')).toHaveLength(3)
    expect(button.attributes('data-tooltip')).toBe('Hide module library')
    expect(button.attributes('data-tooltip-position')).toBe('right')
  })

  it('does not put a toggle on the resize handle', () => {
    mountPanel()

    expect(wrapper.find('.resize-handle button').exists()).toBe(false)
  })

  it('collapses from the toggle and shows it as a hamburger', async () => {
    mountPanel()

    await collapseButton().trigger('click')

    expect(wrapper.vm.isCollapsed).toBe(true)
    expect(panelBody().attributes('style')).toContain('display: none')
    const button = expandButton()
    expect(button.exists()).toBe(true)
    expect(button.attributes('aria-expanded')).toBe('false')
    expect(button.classes()).not.toContain('library-toggle--open')
    expect(button.attributes('data-tooltip')).toBe('Show module library')
  })

  it('keeps the same toggle element, and its focus, across toggles', async () => {
    mountPanel()
    const el = toggle().element
    el.focus()

    await toggle().trigger('click')
    expect(toggle().element).toBe(el)
    expect(document.activeElement).toBe(el)

    await toggle().trigger('click')
    expect(toggle().element).toBe(el)
    expect(document.activeElement).toBe(el)
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

  it('docks right with a left-facing tooltip and a mirrored tornado', () => {
    mountPanel({ side: 'right' })

    expect(wrapper.classes()).toContain('resizable-library-panel--right')
    expect(toggle().attributes('data-tooltip-position')).toBe('left')
    // Lines run from the outer (right) edge inward, so the tornado tapers toward the canvas.
    expect(toggle().find('line').attributes('x1')).toBe('20')
  })

  it('opens and closes from a bound collapsed model', async () => {
    mountPanel({ collapsed: true })
    expect(panelBody().attributes('style')).toContain('display: none')

    await wrapper.setProps({ collapsed: false })
    expect(panelBody().isVisible()).toBe(true)

    await toggle().trigger('click')
    expect(wrapper.emitted('update:collapsed').at(-1)).toEqual([true])
  })

  it('shows the hamburger inline when not an overlay', async () => {
    mountPanel({ overlay: false })
    expect(wrapper.classes()).toContain('resizable-library-panel--inline')

    await collapseButton().trigger('click')

    expect(wrapper.classes()).toContain('resizable-library-panel--collapsed')
    expect(expandButton().exists()).toBe(true)
  })

  it('names what it shows and hides in its toggle', async () => {
    mountPanel({ title: 'User Guide', subject: 'user guide menu' })

    const hide = wrapper.find('button[aria-label="Hide user guide menu"]')
    expect(hide.attributes('data-tooltip')).toBe('Hide user guide menu')
    await hide.trigger('click')

    const show = wrapper.find('button[aria-label="Show user guide menu"]')
    expect(show.exists()).toBe(true)
    expect(show.attributes('data-tooltip')).toBe('Show user guide menu')
  })
})
