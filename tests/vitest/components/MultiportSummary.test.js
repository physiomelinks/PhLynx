// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import MultiportSummary from '../../../src/components/MultiportSummary.vue'

// Records each tooltip's text on its element.
const tooltip = {
  mounted: (el, { value }) => (el.dataset.tooltip = value),
  updated: (el, { value }) => (el.dataset.tooltip = value),
}

const term = (variable, nodeName, extra = {}) => ({
  nodeId: `${nodeName}-id`,
  nodeName,
  edgeId: `e-${nodeName}`,
  portLabel: 'flow',
  variable,
  factor: 1,
  role: 'term',
  ...extra,
})

const sum = (terms, extra = {}) => ({
  variable: 'v_sum',
  portLabel: 'in',
  type: 'Sum',
  factor: null,
  terms,
  issues: [],
  pending: false,
  connected: terms.length > 0,
  linkedElsewhere: false,
  ...extra,
})

let wrapper
beforeEach(() => window.localStorage.clear())
afterEach(() => wrapper?.unmount())

/**
 * Mounts the summary.
 *
 * @param {Object} props
 * @returns {import('@vue/test-utils').VueWrapper}
 */
function mountSummary(props) {
  wrapper = mount(MultiportSummary, { props, global: { directives: { tooltip } } })
  return wrapper
}

// Each part of a row, spaced as read.
const rowText = (row) => [...row.element.children].map((part) => part.textContent.trim()).join(' ')

describe('MultiportSummary', () => {
  it('shows nothing when there is nothing to summarise', () => {
    expect(mountSummary({ entries: [] }).find('section').exists()).toBe(false)
  })

  it('writes a Sum variable as the sum of its terms, each telling where it comes from', () => {
    mountSummary({ entries: [sum([term('v_a', 'artery'), term('v_b', 'vein', { factor: 2 })])] })
    expect(rowText(wrapper.find('.multiport-summary__row'))).toBe('v_sum = v_a + 2 × v_b')
    expect(wrapper.find('[data-multiport="Sum"]').text()).toBe('v_sum')
    const terms = wrapper.findAll('.multiport-chip:not([data-multiport])')
    expect(terms.map((chip) => chip.attributes('data-tooltip'))).toEqual([
      'v_a from artery (port flow)',
      'v_b from vein (port flow)',
    ])
  })

  it('writes a Sum variable nothing is connected to as 0', () => {
    mountSummary({ entries: [sum([])] })
    expect(rowText(wrapper.find('.multiport-summary__row'))).toMatch(/^v_sum = 0 nothing connected/)
  })

  it('writes a Multiply variable as what it sends each neighbour', () => {
    mountSummary({
      entries: [
        {
          variable: 'q',
          portLabel: 'out',
          type: 'Multiply',
          factor: 3,
          terms: [term('q_in', 'leaf', { factor: 3, role: 'scaled' }), term('q_sum', 'hub', { factor: 3, role: 'feedsSum' })],
          issues: [],
          pending: false,
        },
      ],
    })
    expect(wrapper.findAll('.multiport-summary__row').map(rowText)).toEqual(['q_in = 3 × q', 'q_sum = … + 3 × q'])
  })

  it('writes no 0 for a Sum variable connected another way, or only to conflicts', () => {
    mountSummary({ entries: [sum([], { linkedElsewhere: true }), sum([], { connected: true, issues: ['Both Sum.'] })] })
    const rows = wrapper.findAll('.multiport-summary__row').map(rowText)
    expect(rows).toEqual(['v_sum = not connected through this port', 'v_sum = …'])
  })

  it('lists issues and pending ports', () => {
    mountSummary({ entries: [sum([], { pending: true, issues: ['Something is wrong.'] })] })
    expect(rowText(wrapper.find('.multiport-summary__row'))).toBe('v_sum = …')
    expect(wrapper.text()).toContain('connections shown once the port is saved')
    expect(wrapper.find('.multiport-summary__issue').text()).toBe('Something is wrong.')
    expect(wrapper.text()).not.toContain('nothing connected')
  })

  it('has nothing to edit', () => {
    mountSummary({ entries: [sum([term('v_a', 'artery')])] })
    expect(wrapper.find('input, textarea, [contenteditable]').exists()).toBe(false)
    expect(wrapper.findAll('button')).toHaveLength(1) // the collapse toggle
  })

  it('asks to go to a term’s instance only when navigable', async () => {
    mountSummary({ entries: [sum([term('v_a', 'artery')])] })
    await wrapper.find('.multiport-chip:not([data-multiport])').trigger('click')
    expect(wrapper.emitted('navigate')).toBeUndefined()

    await wrapper.setProps({ navigable: true })
    await wrapper.find('button.multiport-chip').trigger('click')
    expect(wrapper.emitted('navigate')).toEqual([[{ nodeId: 'artery-id', edgeId: 'e-artery', variable: 'v_a' }]])
  })

  it('collapses, remembering it for next time', async () => {
    mountSummary({ entries: [sum([])] })
    await wrapper.find('.multiport-summary__header').trigger('click')
    expect(wrapper.find('.multiport-summary__body').exists()).toBe(false)
    wrapper.unmount()

    mountSummary({ entries: [sum([])] })
    expect(wrapper.find('.multiport-summary__body').exists()).toBe(false)
  })
})
