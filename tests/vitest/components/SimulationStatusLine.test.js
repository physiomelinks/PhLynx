// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { describe, expect, it } from 'vitest'

import SimulationStatusLine from '../../../src/components/simulation/SimulationStatusLine.vue'

/**
 * Mounts the status line, its tooltip's text kept on the element it is on.
 *
 * @param {Object} status
 * @returns {import('@vue/test-utils').VueWrapper}
 */
function mountLine(status) {
  const tooltip = { mounted: (el, { value }) => (el.dataset.tooltip = value), updated: (el, { value }) => (el.dataset.tooltip = value) }
  return mount(SimulationStatusLine, { props: { status }, global: { plugins: [PrimeVue], directives: { tooltip } } })
}

describe('SimulationStatusLine', () => {
  it('lists the notes in an info icon’s tooltip, without warning', () => {
    const notes = ['"a.u" uses its own value, since what supplies it is outside the selection.', '"b.v" uses its own value.']
    const wrapper = mountLine({ severity: 'info', icon: null, text: 'Simulated this instance.', details: [], notes })

    expect(wrapper.classes()).toContain('simulation-status--info')
    expect(wrapper.find('.pi-exclamation-triangle').exists()).toBe(false)
    const note = wrapper.find('button.status-note')
    expect(note.find('.pi-info-circle').exists()).toBe(true)
    expect(note.attributes('aria-label')).toBe(`Notes: ${notes.join(' ')}`)
    expect(note.element.dataset.tooltip).toBe(notes.join('\n'))
  })

  it('shows the notes’ tooltip on keyboard focus as on hover, and hides it on blur', async () => {
    const wrapper = mountLine({ severity: 'info', icon: null, text: 'Simulated this instance.', details: [], notes: ['"a.u" uses its own value.'] })
    const note = wrapper.find('button.status-note').element
    const events = []
    note.addEventListener('mouseenter', () => events.push('mouseenter'))
    note.addEventListener('mouseleave', () => events.push('mouseleave'))

    await wrapper.find('button.status-note').trigger('focus')
    await wrapper.find('button.status-note').trigger('blur')
    expect(events).toEqual(['mouseenter', 'mouseleave'])
  })

  it('shows no info icon without notes', () => {
    const wrapper = mountLine({ severity: 'info', icon: null, text: 'Press play.', details: [] })
    expect(wrapper.find('.pi-info-circle').exists()).toBe(false)
  })

  it('keeps the notes beside warnings, whose list is a click away', () => {
    const wrapper = mountLine({
      severity: 'warn',
      icon: 'pi-exclamation-triangle',
      text: 'Simulated this instance. 1 warning.',
      details: [{ title: 'Warnings', lines: ['"a.w" is set to 0.'] }],
      notes: ['"a.u" uses its own value.'],
    })
    expect(wrapper.find('button.status-button').exists()).toBe(true)
    expect(wrapper.find('.pi-info-circle').exists()).toBe(true)
  })

  it('shows a hint on a line of its own', () => {
    const hint = 'Turn off Whole model to simulate this instance alone.'
    const wrapper = mountLine({ severity: 'error', icon: 'pi-exclamation-circle', text: 'The solver failed.', details: [], hint })
    expect(wrapper.find('.status-hint').text()).toBe(hint)
    expect(wrapper.classes()).toContain('simulation-status--hinted')

    const plain = mountLine({ severity: 'error', icon: 'pi-exclamation-circle', text: 'The solver failed.', details: [] })
    expect(plain.find('.status-hint').exists()).toBe(false)
  })
})
