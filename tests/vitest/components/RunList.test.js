// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { beforeEach, describe, expect, it } from 'vitest'

import RunList from '../../../src/components/simulation/RunList.vue'
import { useSimulationResultsStore } from '../../../src/stores/simulationResultsStore.js'

describe('RunList', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useSimulationResultsStore()
    store.startRun(null)
    store.finishRun({
      results: { voi: { name: 'm/t', unit: 'second', values: new Float64Array([0, 1]) }, variables: new Map(), isStopped: false },
      mapping: new Map(),
      signature: 's',
      inspectionOutputs: [],
      inputs: { settings: {}, overrides: null },
    })
  })

  it('names a tracked run in place, by its number until it has a name', async () => {
    const run = store.trackRun()
    const wrapper = mount(RunList, { global: { plugins: [PrimeVue] } })
    expect(wrapper.find('.run-name--editable').text()).toBe('Run #1')
    expect(wrapper.find('[aria-label="Hide Run #1"]').exists()).toBe(true)
    expect(wrapper.findAll('button').some((button) => button.text() === 'Track run')).toBe(false)

    await wrapper.find('.run-name--editable').trigger('click')
    const input = wrapper.find('input')
    await input.setValue('Low gain')
    await input.trigger('keydown', { key: 'Enter' })

    expect(store.trackedRuns[0]).toMatchObject({ id: run.id, name: 'Low gain' })
    expect(wrapper.find('.run-name--editable').text()).toBe('Low gain')
    expect(wrapper.find('[aria-label="Stop tracking Low gain"]').exists()).toBe(true)
    wrapper.unmount()
  })
})
