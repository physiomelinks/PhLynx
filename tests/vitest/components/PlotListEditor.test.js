// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ConfirmationService from 'primevue/confirmationservice'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import PlotListEditor from '../../../src/components/simulation/PlotListEditor.vue'
import { addPlotSelection, createSinglePlotConfig } from '../../../src/services/simulation/plotSelections.js'

const variable = { name: 'membrane_potential', units: 'mV', type: 'variable' }
const nodes = [{ id: 'a', data: { name: 'a_very_long_instance_name', variables: [variable] } }]

let wrapper
beforeEach(() => setActivePinia(createPinia()))
afterEach(() => wrapper?.unmount())

describe('PlotListEditor', () => {
  it('lays a variable out as its instance, which can shrink, then its name', () => {
    wrapper = mount(PlotListEditor, {
      props: { nodes, isSinglePlot: true, plotConfig: addPlotSelection(createSinglePlotConfig(), nodes[0], variable, null) },
      global: { plugins: [PrimeVue, ConfirmationService], directives: { tooltip: {} } },
    })
    const text = wrapper.find('.plot-variable-text')
    expect(text.find('.plot-variable-component').text()).toBe('a_very_long_instance_name/')
    expect(text.find('.plot-variable-name').text()).toBe('membrane_potential')
  })
})
