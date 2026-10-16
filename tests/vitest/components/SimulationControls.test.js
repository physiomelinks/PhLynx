// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import SimulationControls from '../../../src/components/simulation/SimulationControls.vue'
import { addPlotSelection, createSinglePlotConfig } from '../../../src/services/simulation/plotSelections.js'

const variables = [
  { name: 'V', units: 'mV', type: 'variable' },
  { name: 'E', units: 'mV', type: 'variable' },
  { name: 'i', units: 'uA', type: 'variable' },
  { name: 'n', units: '', type: 'variable' },
]
const nodes = [{ id: 'a', data: { name: 'a', variables } }]

let wrapper
afterEach(() => wrapper?.unmount())

/**
 * Mounts the controls on a single plot of instance a, with the plot list stubbed.
 *
 * @param {Object} props
 * @returns {import('@vue/test-utils').VueWrapper}
 */
function mountControls(props) {
  wrapper = mount(SimulationControls, {
    props: { nodes, plotNodeId: 'a', ...props },
    global: { plugins: [PrimeVue], directives: { tooltip: {} }, stubs: { PlotListEditor: true } },
  })
  return wrapper
}

/**
 * Builds a single plot showing the named variables of instance a.
 *
 * @param {string[]} names
 * @returns {Object}
 */
function buildPlot(names) {
  return names.reduce(
    (config, name) => addPlotSelection(config, nodes[0], variables.find((row) => row.name === name), null),
    createSinglePlotConfig()
  )
}

/**
 * Finds the names a filter lets through from the picker's index.
 *
 * @param {Function} filter
 * @returns {string[]}
 */
function getOffered(filter) {
  const picker = wrapper.findComponent({ name: 'VariablePathPicker' })
  return picker.props('index').filter(filter).map((entry) => entry.path)
}

const findPicker = () => wrapper.findComponent({ name: 'VariablePathPicker' })

describe('SimulationControls unit filter', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('offers only variables in the plotted units, and says so', () => {
    mountControls({ plotConfig: buildPlot(['V']), isUnitFiltered: true })
    expect(getOffered(findPicker().props('filter'))).toEqual(['a/E', 'a/V'])
    expect(findPicker().props('placeholder')).toBe('Add a variable in mV…')
    expect(findPicker().props('emptyMessage')).toBe('No variable in mV matches.')
  })

  it('accepts each of the units a plot already mixes', () => {
    mountControls({ plotConfig: buildPlot(['V', 'n']), isUnitFiltered: true })
    expect(getOffered(findPicker().props('filter'))).toEqual(['a/E', 'a/n', 'a/V'])
    expect(findPicker().props('placeholder')).toBe('Add a variable in mV or no units…')
  })

  it('offers every variable unfiltered, or with nothing plotted yet', async () => {
    mountControls({ plotConfig: buildPlot(['V']) })
    expect(getOffered(findPicker().props('filter'))).toHaveLength(4)
    expect(findPicker().props('placeholder')).toBe('Add a variable…')
    expect(findPicker().props('emptyMessage')).toBe('No variable matches.')

    await wrapper.setProps({ plotConfig: createSinglePlotConfig(), isUnitFiltered: true })
    expect(getOffered(findPicker().props('filter'))).toHaveLength(4)
    expect(findPicker().props('placeholder')).toBe('Add a variable…')
  })

  it('still plots against a variable in other units', () => {
    mountControls({ plotConfig: buildPlot(['V']), isUnitFiltered: true })
    expect(getOffered(wrapper.findComponent({ name: 'PlotListEditor' }).props('isPlottable'))).toHaveLength(4)
  })
})

describe('SimulationControls sweep', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('gives the sweep editor the scope play runs next', async () => {
    wrapper = mount(SimulationControls, {
      props: { nodes, view: 'sweep', playScopeNodeIds: ['a'] },
      global: { plugins: [PrimeVue], directives: { tooltip: {} }, stubs: { SweepEditor: true } },
    })
    const editor = () => wrapper.findComponent({ name: 'SweepEditor' })
    expect(editor().props('playScopeNodeIds')).toEqual(['a'])

    await wrapper.setProps({ playScopeNodeIds: null })
    expect(editor().props('playScopeNodeIds')).toBeNull()
  })
})

describe('SimulationControls constants', () => {
  beforeEach(() => setActivePinia(createPinia()))

  const withConstants = [
    { id: 'a', data: { name: 'a', variables: [...variables, { name: 'R', units: 'J', type: 'global_constant' }] } },
    { id: 'b', data: { name: 'b', variables: [{ name: 'k', units: 'per_s', type: 'constant' }, { name: 'R', units: 'J', type: 'global_constant' }] } },
  ]

  it('plots a global constant as the plot’s own instance’s, and notes it once plotted', async () => {
    mountControls({ nodes: withConstants, plotNodeId: 'b', plotConfig: createSinglePlotConfig() })
    expect(getOffered(findPicker().props('filter'))).toEqual(['b/k', 'global_parameters/R'])

    const global = findPicker().props('index').find((entry) => entry.key === 'global::R')
    findPicker().vm.$emit('pick', global)
    const [[plotConfig]] = wrapper.emitted('update:plotConfig')
    expect(plotConfig.selections.map((selection) => selection.key)).toEqual(['b::R'])

    await wrapper.setProps({ plotConfig })
    expect(findPicker().props('describe')(global)).toBe('On Plot 1')
  })

  it('sets a plot against a global constant as the plot’s own instance’s', () => {
    mountControls({ nodes: withConstants, plotNodeId: 'b', plotConfig: createSinglePlotConfig() })
    const list = wrapper.findComponent({ name: 'PlotListEditor' })
    const global = findPicker().props('index').find((entry) => entry.key === 'global::R')
    expect(list.props('isPlottable')(global)).toBe(true)
    expect(list.props('resolveEntry')(global).node.id).toBe('b')
  })
})
