// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import { describe, expect, it } from 'vitest'

import RecoveryPanel from '../../../src/components/RecoveryPanel.vue'

const drafts = [
  { id: 'a', savedAt: Date.UTC(2026, 10, 16, 2, 30), name: 'heart', nodeCount: 3 },
  { id: 'b', savedAt: Date.UTC(2026, 10, 15, 2, 30), name: null, nodeCount: 1 },
]

const mountPanel = (props, options = {}) =>
  mount(RecoveryPanel, {
    props: { drafts, ...props },
    global: { plugins: [PrimeVue], directives: { hint: {} } },
    ...options,
  })

describe('RecoveryPanel', () => {
  it('lists each draft by name, or as untitled, with its module count', () => {
    const rows = mountPanel().findAll('[data-testid="recovery-draft"]')
    expect(rows.map((row) => row.find('.draft-name').text())).toEqual(['heart', 'Untitled workspace'])
    expect(rows[0].find('.draft-meta').text()).toMatch(/^3 modules · /)
    expect(rows[1].find('.draft-meta').text()).toMatch(/^1 module · /)
  })

  it('says the undo history does not come back', () => {
    expect(mountPanel().text()).toContain('does not bring back its undo history')
  })

  it('asks to restore or discard the draft clicked', async () => {
    const wrapper = mountPanel()
    await wrapper.findAll('[data-testid="recovery-restore"]')[1].trigger('click')
    await wrapper.findAll('[data-testid="recovery-discard"]')[0].trigger('click')
    expect(wrapper.emitted('restore')).toEqual([['b']])
    expect(wrapper.emitted('discard')).toEqual([['a']])
  })

  it('holds every button while a draft is restoring', () => {
    const wrapper = mountPanel({ restoring: 'a' })
    for (const button of wrapper.findAll('button')) expect(button.attributes('disabled')).toBeDefined()
  })

  it('asks to be hidden from its close button or Escape', async () => {
    const wrapper = mountPanel()
    await wrapper.find('[data-testid="recovery-dismiss"]').trigger('click')
    await wrapper.find('[data-testid="recovery-panel"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('dismiss')).toHaveLength(2)
  })

  it('focuses the newest draft’s Restore, so Enter restores it', () => {
    const wrapper = mountPanel({}, { attachTo: document.body })
    expect(document.activeElement).toBe(wrapper.findAll('[data-testid="recovery-restore"]')[0].element)
    wrapper.unmount()
  })

  it('leaves the focus where it is when something already has it', () => {
    const input = document.createElement('input')
    document.body.append(input)
    input.focus()
    const wrapper = mountPanel({}, { attachTo: document.body })
    expect(document.activeElement).toBe(input)
    wrapper.unmount()
    input.remove()
  })
})
