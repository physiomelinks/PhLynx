// @vitest-environment happy-dom
import { ref } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Menu from 'primevue/menu'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const edges = ref([])
vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({ edges }),
}))

const { default: SweepEditor } = await import('../../../src/components/simulation/SweepEditor.vue')
const { useSimulationResultsStore } = await import('../../../src/stores/simulationResultsStore.js')
const { useSimulationSettingsStore } = await import('../../../src/stores/simulationSettingsStore.js')
const { default: VariablePathPicker } = await import('../../../src/components/simulation/VariablePathPicker.vue')
const { useLibraryStore } = await import('../../../src/stores/libraryStore.js')

// Keeps a tooltip's text where a test can read it.
const tooltip = {
  mounted: (el, binding) => (el.dataset.tooltip = binding.value),
  updated: (el, binding) => (el.dataset.tooltip = binding.value),
}
const ODE_MATH = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="m"><component name="m">
  <variable name="t" units="second"/><variable name="x" units="dimensionless" initial_value="1"/>
  <math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply><cn>1</cn></apply></math>
</component></model>`
const ALGEBRAIC_MATH = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="m"><component name="m">
  <variable name="x" units="dimensionless"/><variable name="k" units="dimensionless"/>
  <math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><ci>x</ci><apply><times/><cn>2</cn><ci>k</ci></apply></apply></math>
</component></model>`

const nodes = [
  {
    id: 'n1',
    data: {
      name: 'channel',
      variables: [
        { name: 'g', type: 'constant', units: 'siemens', value: '2' },
        { name: 'I', type: 'variable', units: 'ampere' },
      ],
    },
  },
]

let wrapper
beforeEach(() => {
  setActivePinia(createPinia())
  edges.value = []
})
afterEach(() => wrapper?.unmount())

/**
 * Mounts the editor, keeping its sweep in step with what it emits.
 *
 * @param {Object|null} sweep
 */
function mountEditor(sweep = null, props = {}) {
  wrapper = mount(SweepEditor, {
    props: { nodes, sweep, 'onUpdate:sweep': (next) => wrapper.setProps({ sweep: next }), ...props },
    global: { plugins: [PrimeVue], directives: { tooltip } },
  })
}

const addButton = () => wrapper.findAll('button').find((button) => button.text() === 'Sweep a parameter')

describe('SweepEditor', () => {
  it('adds a sweep from the + button, then hides it', async () => {
    mountEditor()
    expect(wrapper.findComponent(VariablePathPicker).exists()).toBe(false)

    await addButton().trigger('click')
    const picker = wrapper.findComponent(VariablePathPicker)
    // Only the parameter is offered, not what the model computes.
    const offered = picker.props('index').filter(picker.props('filter')).map((entry) => entry.path)
    expect(offered).toEqual(['channel/g'])

    picker.vm.$emit('pick', picker.props('index').find((entry) => entry.path === 'channel/g'))
    await flushPromises()
    expect(wrapper.props('sweep')).toMatchObject({ key: 'n1::g', parameterName: 'g', from: 1, to: 3 })
    expect(wrapper.findComponent(VariablePathPicker).exists()).toBe(false)
    expect(addButton()).toBeUndefined()
  })

  it('stops sweeping from its menu', async () => {
    mountEditor({ key: 'n1::g', nodeId: 'n1', nodeName: 'channel', parameterName: 'g', units: 'siemens', type: 'constant', from: 1, to: 3, points: 51 })
    expect(wrapper.find('[data-testid="sim-sweep-parameter"]').exists()).toBe(true)

    wrapper.findComponent(Menu).props('model').find((item) => item.label === 'Stop sweeping').command()
    await flushPromises()
    expect(wrapper.props('sweep')).toBeNull()
    expect(addButton()).toBeDefined()
  })

  it('explains itself in a tooltip beside its button, or its parameter, not in text always shown', async () => {
    mountEditor(null)
    expect(wrapper.text().trim()).toBe('Sweep a parameter')
    expect(wrapper.find('[data-testid="sim-sweep-about"]').exists()).toBe(true)

    await wrapper.setProps({ sweep: { key: 'n1::g', nodeId: 'n1', nodeName: 'channel', parameterName: 'g', units: 'siemens', type: 'constant', from: 1, to: 3, points: 51 } })
    const about = wrapper.get('[data-testid="sim-sweep-parameter"] [data-testid="sim-sweep-about"]')
    expect(about.find('.pi-info-circle').exists()).toBe(true)
    expect(about.attributes('data-tooltip')).toMatch(/read between the plots’ Start and End/)
    expect(about.attributes('data-tooltip')).toMatch(/Web OpenCOR can’t run sweeps/)
    expect(about.attributes('aria-label')).toBe(about.attributes('data-tooltip'))
    expect(about.element.tagName).toBe('BUTTON')
    expect(wrapper.text()).not.toMatch(/Web OpenCOR|of each time course|No sweep yet/)
  })

  describe('its scope', () => {
    // The membrane's V is a boundary condition the cell, connected to it, supplies.
    const connected = [
      { id: 'cell', data: { name: 'cell', variables: [{ name: 'V', type: 'variable', units: 'volt' }] } },
      { id: 'mem', data: { name: 'mem', variables: [{ name: 'V', type: 'boundary_condition', units: 'volt', value: '-80' }] } },
    ]
    const port = { label: 'p', variables: ['V'] }
    const BC_SWEEP = { key: 'mem::V', nodeId: 'mem', nodeName: 'mem', parameterName: 'V', units: 'volt', type: 'boundary_condition', from: -100, to: 0, points: 51 }

    beforeEach(() => {
      edges.value = [{ source: 'cell', target: 'mem', data: { couplings: [{ sourcePort: port, targetPort: port }] } }]
    })

    /**
     * Lists the paths the picker offers.
     *
     * @returns {string[]}
     */
    async function offered() {
      await addButton().trigger('click')
      const picker = wrapper.findComponent(VariablePathPicker)
      return picker.props('index').filter(picker.props('filter')).map((entry) => entry.path)
    }

    it('offers a connected boundary condition when its instance runs on its own, not with the whole model', async () => {
      mountEditor(null, { nodes: connected })
      expect(await offered()).toEqual([])
      wrapper.unmount()

      mountEditor(null, { nodes: connected, playScopeNodeIds: ['mem'] })
      expect(await offered()).toEqual(['mem/V'])
    })

    it('warns that the whole model supplies a boundary condition swept on its own', async () => {
      mountEditor(BC_SWEEP, { nodes: connected, playScopeNodeIds: ['mem'] })
      expect(wrapper.text()).not.toMatch(/supplied through a connection/)

      await wrapper.setProps({ playScopeNodeIds: null })
      expect(wrapper.text()).toMatch(/mem\/V is supplied through a connection in this run: simulate mem on its own to sweep it\./)
    })

    it('leaves the run to warn where the scope play runs isn’t known, as in Simulation Settings', () => {
      mountEditor(BC_SWEEP, { nodes: connected })
      expect(wrapper.text()).not.toMatch(/supplied through a connection/)
    })
  })

  describe('its reading', () => {
    const SWEEP = { key: 'n1::g', nodeId: 'n1', nodeName: 'channel', parameterName: 'g', units: 'siemens', type: 'constant', from: 1, to: 3, points: 51 }

    /**
     * Finishes a run, as the sweep's cost and notes go by the last run's.
     *
     * @param {Object} results
     */
    const finish = (results) =>
      useSimulationResultsStore().finishRun({ results: { variables: new Map(), voi: { values: new Float64Array(1) }, ...results }, mapping: new Map(), signature: 's', inspectionOutputs: [], inputs: {} })

    it('reads each time course’s end unless another reading is chosen', async () => {
      mountEditor(SWEEP)
      const readout = wrapper.get('[data-testid="sim-sweep-readout"]')
      expect(readout.find('[aria-pressed="true"]').text()).toBe('End')

      await readout.findAll('button').find((button) => button.text() === 'Min').trigger('click')
      expect(wrapper.props('sweep')).toMatchObject({ readout: 'min' })
    })

    it('says how many time courses it runs, and about how long, going by the last run', async () => {
      mountEditor(SWEEP)
      expect(wrapper.get('[data-testid="sim-sweep-cost"]').text()).toBe('51 time courses.')

      finish({ elapsedMs: 2000, isSteadyState: false })
      await flushPromises()
      expect(wrapper.get('[data-testid="sim-sweep-cost"]').text()).toBe('51 time courses, about 2 min.')

      finish({ elapsedMs: 4, isSteadyState: true })
      await flushPromises()
      expect(wrapper.get('[data-testid="sim-sweep-cost"]').text()).toBe('51 solves, under a second.')
    })

    it('warns of a long sweep, and of a peak a time course settling before the plots start can’t read', async () => {
      mountEditor({ ...SWEEP, points: 201, readout: 'min' })
      expect(wrapper.find('[data-testid="sim-sweep-long"]').exists()).toBe(true)
      expect(wrapper.find('[data-testid="sim-sweep-transient"]').exists()).toBe(false)

      const settingsStore = useSimulationSettingsStore()
      settingsStore.setSimulationSettings({ ...settingsStore.simulationSettings, initialPoint: 0, startingPoint: 1, endingPoint: 2 })
      await flushPromises()
      const transient = wrapper.get('[data-testid="sim-sweep-transient"]')
      expect(transient.attributes('data-tooltip')).toMatch(/a min in the first moments/)
      expect(transient.attributes('aria-label')).toBe(transient.attributes('data-tooltip'))
      expect(transient.element.tagName).toBe('BUTTON')

      await wrapper.setProps({ sweep: { ...SWEEP, readout: 'end' } })
      expect(wrapper.find('[data-testid="sim-sweep-transient"]').exists()).toBe(false)
    })

    it('reads only a scope with ODEs, going by its math, or while that isn’t known, its last run', async () => {
      const libraryStore = useLibraryStore()
      libraryStore.addMath('file:ode', ODE_MATH)
      libraryStore.addMath('file:algebraic', ALGEBRAIC_MATH)
      const withMath = [
        { id: 'n1', data: { ...nodes[0].data, mathRef: 'file:algebraic' } },
        { id: 'n2', data: { name: 'clock', mathRef: 'file:ode', variables: [] } },
      ]
      mountEditor(SWEEP, { nodes: withMath, playScopeNodeIds: ['n1'] })
      expect(wrapper.find('[data-testid="sim-sweep-readout"]').exists()).toBe(false)
      expect(wrapper.get('[data-testid="sim-sweep-cost"]').text()).toBe('51 solves.')

      await wrapper.setProps({ playScopeNodeIds: null })
      expect(wrapper.find('[data-testid="sim-sweep-readout"]').exists()).toBe(true)

      // An edit to the math shows at once, whatever the last run of this scope found.
      finish({ elapsedMs: 4, isSteadyState: true })
      await flushPromises()
      expect(wrapper.find('[data-testid="sim-sweep-readout"]').exists()).toBe(true)

      // Without the math's analysis, the run says.
      await wrapper.setProps({ nodes: [withMath[0], { id: 'n2', data: { name: 'clock', mathRef: 'file:unknown', variables: [] } }] })
      expect(wrapper.find('[data-testid="sim-sweep-readout"]').exists()).toBe(false)
    })
  })

  describe('its curves', () => {
    const SWEEP = { key: 'n1::g', nodeId: 'n1', nodeName: 'channel', parameterName: 'g', units: 'siemens', type: 'constant', from: 1, to: 3, points: 51 }
    const twoParameters = [{ ...nodes[0], data: { ...nodes[0].data, variables: [...nodes[0].data.variables, { name: 'Ko', type: 'constant', units: 'mM', value: '5.4' }] } }]

    /** Mounts the editor on a channel with g and Ko. */
    function mountWithKo(sweep) {
      wrapper = mount(SweepEditor, {
        props: { nodes: twoParameters, sweep, 'onUpdate:sweep': (next) => wrapper.setProps({ sweep: next }) },
        global: { plugins: [PrimeVue], directives: { tooltip } },
      })
    }

    it('adds a curve for each value of another parameter, from its own value, keeping the sweep', async () => {
      mountWithKo({ ...SWEEP, readout: 'min' })
      wrapper.findComponent(Menu).props('model').find((item) => item.label === 'Add a curve for each value of…').command()
      await flushPromises()
      const picker = wrapper.findComponent(VariablePathPicker)
      expect(picker.props('ariaLabel') ?? picker.attributes('aria-label')).toBe('Choose a parameter for the curves')
      expect(picker.props('index').filter((entry) => picker.props('filter')(entry)).map((entry) => entry.path)).toEqual(['channel/Ko'])
      picker.vm.$emit('pick', picker.props('index').find((entry) => entry.path === 'channel/Ko'))
      await flushPromises()

      expect(wrapper.props('sweep')).toMatchObject({ key: 'n1::g', readout: 'min', family: { key: 'n1::Ko', parameterName: 'Ko', values: [5.4] } })
      expect(wrapper.get('[data-testid="sim-sweep-family-values"]').element.value).toBe('5.4')
      expect(wrapper.get('[data-testid="sim-sweep-cost"]').text()).toBe('51 time courses.')
    })

    it('reads the values typed, or says which isn’t a number', async () => {
      mountWithKo({ ...SWEEP, family: { key: 'n1::Ko', nodeId: 'n1', nodeName: 'channel', parameterName: 'Ko', units: 'mM', type: 'constant', values: [5.4] } })
      const input = wrapper.get('[data-testid="sim-sweep-family-values"]')

      await input.setValue('2, 5.4 10')
      await input.trigger('change')
      expect(wrapper.props('sweep').family.values).toEqual([2, 5.4, 10])
      expect(wrapper.get('[data-testid="sim-sweep-cost"]').text()).toBe('51 × 3 = 153 time courses.')

      await input.setValue('2, high')
      await input.trigger('change')
      expect(wrapper.props('sweep').family.values).toEqual([2, 5.4, 10])
      expect(wrapper.get('[role="alert"]').text()).toBe('high isn’t a number.')

      // A change elsewhere, saved as a copy of the sweep, keeps what was typed, and why it can't be read.
      const sweep = wrapper.props('sweep')
      await wrapper.setProps({ sweep: { ...sweep, points: 11, family: { ...sweep.family, values: [...sweep.family.values] } } })
      expect(input.element.value).toBe('2, high')
      expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    })

    it('draws one curve again from the curves’ menu', async () => {
      mountWithKo({ ...SWEEP, family: { key: 'n1::Ko', nodeId: 'n1', nodeName: 'channel', parameterName: 'Ko', units: 'mM', type: 'constant', values: [5.4] } })
      wrapper.findAllComponents(Menu)[1].props('model').find((item) => item.label === 'Draw one curve').command()
      await flushPromises()
      expect(wrapper.props('sweep')).not.toHaveProperty('family')
      expect(wrapper.find('[data-testid="sim-sweep-family"]').exists()).toBe(false)
    })
  })
})
