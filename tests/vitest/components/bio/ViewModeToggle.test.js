// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { beforeEach, describe, expect, it } from 'vitest'

import ViewModeToggle from '../../../../src/components/bio/ViewModeToggle.vue'

const BETA_NOTE = 'Physiology view is in beta — behaviour may change.'

describe('ViewModeToggle', () => {
  beforeEach(() => setActivePinia(createPinia()))

  const mountToggle = () => mount(ViewModeToggle, { global: { plugins: [PrimeVue] } })

  it('marks only the Physiology option as Beta, with a tooltip and accessible label', () => {
    const wrapper = mountToggle()
    const badges = wrapper.findAll('[data-testid="view-mode-beta"]')
    expect(badges).toHaveLength(1)

    const badge = badges[0]
    expect(badge.text()).toBe('Beta')
    expect(badge.attributes('title')).toBe(BETA_NOTE)
    expect(badge.attributes('aria-label')).toBe(BETA_NOTE)

    const options = wrapper.findAll('[data-testid="view-mode"] > *')
    const physiology = options.find((o) => o.text().includes('Physiology'))
    const diagram = options.find((o) => o.text().includes('Diagram'))
    expect(physiology.find('[data-testid="view-mode-beta"]').exists()).toBe(true)
    expect(diagram.find('[data-testid="view-mode-beta"]').exists()).toBe(false)
  })
})
