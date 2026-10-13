// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import SimulationSettingsSection from '../../../src/components/simulation/SimulationSettingsSection.vue'
import { useSimulationSettingsStore } from '../../../src/stores/simulationSettingsStore'

let wrapper

/**
 * Mounts the section, folded unless it was left open.
 *
 * @returns {import('@vue/test-utils').VueWrapper}
 */
function mountSection() {
  wrapper = mount(SimulationSettingsSection, { global: { plugins: [PrimeVue] } })
  return wrapper
}

beforeEach(() => {
  localStorage.clear()
  setActivePinia(createPinia())
})
afterEach(() => wrapper?.unmount())

describe('SimulationSettingsSection', () => {
  it('starts folded, with a summary, and unfolds to the fields', async () => {
    mountSection()
    expect(wrapper.find('[data-testid="side-ending-point"]').exists()).toBe(false)
    expect(wrapper.find('.settings-summary').exists()).toBe(true)

    await wrapper.find('[data-testid="sim-settings-toggle"]').trigger('click')
    expect(wrapper.find('[data-testid="sim-settings-toggle"]').attributes('aria-expanded')).toBe('true')
    expect(wrapper.find('[data-testid="side-ending-point"]').exists()).toBe(true)
  })

  it('remembers that it was left open', async () => {
    mountSection()
    await wrapper.find('[data-testid="sim-settings-toggle"]').trigger('click')
    wrapper.unmount()

    mountSection()
    expect(wrapper.find('[data-testid="side-ending-point"]').exists()).toBe(true)
  })

  it('saves a change to the settings', async () => {
    const store = useSimulationSettingsStore()
    mountSection()
    await wrapper.find('[data-testid="sim-settings-toggle"]').trigger('click')

    const input = wrapper.find('[data-testid="side-ending-point"]')
    await input.setValue('42')
    await input.trigger('blur')
    expect(store.simulationSettings.endingPoint).toBe(42)
  })

  it('shows what it follows from the store when the settings change elsewhere', async () => {
    const store = useSimulationSettingsStore()
    mountSection()
    await wrapper.find('[data-testid="sim-settings-toggle"]').trigger('click')

    store.setSimulationSettings({ ...store.simulationSettings, endingPoint: 7 })
    await wrapper.vm.$nextTick()
    expect(wrapper.find('[data-testid="side-ending-point"]').element.value).toContain('7')
  })
})
