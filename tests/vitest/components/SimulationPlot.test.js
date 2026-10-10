import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SimulationPlot from '../../../src/components/simulation/SimulationPlot.vue'

describe('SimulationPlot', () => {
  it('lists a steady state’s values, as there is no time to plot them against', () => {
    const wrapper = mount(SimulationPlot, {
      props: {
        title: 'lever/y, lever/z',
        unit: 'metre',
        x: { label: '', unit: '', values: new Float64Array(), isSteadyState: true },
        series: [
          { key: 'lever::y', label: 'lever/y', slot: 0, values: new Float64Array([6]) },
          { key: 'lever::z', label: 'lever/z', slot: 1, values: new Float64Array([0.123456789]) },
        ],
      },
    })

    const rows = wrapper.findAll('.plot-values li').map((row) => [row.find('.plot-values-label').text(), row.find('.plot-values-value').text()])
    expect(rows).toEqual([
      ['lever/y', '6'],
      ['lever/z', '0.12346'],
    ])
    expect(wrapper.find('.plot-chart').exists()).toBe(false)
    wrapper.unmount()
  })
})
