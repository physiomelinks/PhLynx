// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ConfirmationService from 'primevue/confirmationservice'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addOutput, addPredictionPlot, ensureProtocol } from '@physiomelinks/protocol-kit'
import { isSettable, searchVariables } from '@physiomelinks/protocol-kit/editor'

import ProtocolDialog from '../../../src/components/ProtocolDialog.vue'
import { SERIES_COLOURS } from '../../../src/services/simulation/seriesSlots.js'
import { buildVariableIndex, searchVariableIndex } from '../../../src/services/simulation/variableIndex.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { useOmexStore } from '../../../src/stores/omexStore.js'
import { useProtocolStore } from '../../../src/stores/protocolStore.js'
import { useSimulationSettingsStore } from '../../../src/stores/simulationSettingsStore.js'

const NODES = [
  {
    id: 'n1',
    data: {
      name: 'cell',
      variables: [
        { name: 'g_Na', type: 'constant', units: 'mS', value: '120' },
        { name: 'V', type: 'state', units: 'mV', value: '-80' },
        { name: 'R', type: 'global_constant', units: 'J_per_K_mol', value: '1' },
      ],
    },
  },
  { id: 'n2', data: { name: 'pump', variables: [{ name: 'g_NaK', type: 'constant', units: 'mS', value: '' }, { name: 'R', type: 'global_constant', value: '1' }] } },
]

let wrapper
afterEach(() => wrapper?.unmount())
beforeEach(() => setActivePinia(createPinia()))

/**
 * Mounts the dialog open, its editor stubbed to show what PhLynx gives it.
 *
 * @returns {Object} The stubbed editor's props.
 */
function mountEditor() {
  wrapper = mount(ProtocolDialog, {
    props: { modelValue: true, nodes: NODES },
    global: {
      plugins: [PrimeVue, ConfirmationService],
      stubs: { Dialog: { template: '<div><slot /><slot name="footer" /></div>' }, ProtocolEditor: true },
      directives: { tooltip: {} },
    },
  })
  return wrapper.findComponent({ name: 'ProtocolEditor' }).props()
}

describe('ProtocolDialog', () => {
  it("lists the model's variables to the editor by the names a protocol gives them, a global constant once", () => {
    expect(mountEditor().variables).toEqual([
      { name: 'cell/g_Na', label: 'cell/g_Na', unit: 'mS', kind: 'constant', value: '120' },
      { name: 'cell/V', label: 'cell/V', unit: 'mV', kind: 'state', value: '-80' },
      { name: 'global_parameters/R', label: 'global_parameters/R', unit: 'J_per_K_mol', kind: 'global_constant', value: '1' },
      { name: 'pump/g_NaK', label: 'pump/g_NaK', unit: 'mS', kind: 'constant', value: '' },
    ])
  })

  it('offers the parameters to set as the variable index did, in the same order', () => {
    const { variables } = mountEditor()
    const index = buildVariableIndex(NODES)
    for (const query of ['', 'g', 'na', 'cell', 'r', 'global']) {
      const before = searchVariableIndex(index, query, { filter: (entry) => entry.slidable }).map(({ path }) => path)
      expect(searchVariables(variables, query, { filter: isSettable }).map(({ name }) => name)).toEqual(before)
    }
  })

  it("reads a global constant's value from the library, and a node's own from its row", () => {
    useLibraryStore().assignGlobalConstant('R', '8.314', 'J_per_K_mol')
    const { getValue } = mountEditor()
    expect(getValue('global_parameters/R')).toBe('8.314')
    expect(getValue('cell/g_Na')).toBe('120')
    expect(getValue('nowhere/x')).toBeUndefined()
  })

  it("asks through PhLynx's own confirm dialog and colours experiments with its palette", () => {
    const { confirm, palette } = mountEditor()
    expect(confirm).toBeTypeOf('function')
    expect(palette).toEqual(SERIES_COLOURS.light)
  })

  it("checks outputs' ranges against the run's point interval", () => {
    useSimulationSettingsStore().setSimulationSettings({ pointInterval: 0.25 })
    expect(mountEditor().dt).toBe(0.25)
  })

  it("saves the outputs the editor adds into the workspace's obs_data, undoably until then", async () => {
    mountEditor()
    const editor = wrapper.findComponent({ name: 'ProtocolEditor' })
    const withOutput = addOutput(ensureProtocol(null), { name: 'V_mean', operands: ['cell/V'], unit: 'mV', experiments: [0], operation: 'mean' })
    editor.vm.$emit('update:document', withOutput)
    await wrapper.vm.$nextTick()
    expect(editor.props('document')).toEqual(withOutput)

    await wrapper.find('button[aria-label="Undo"]').trigger('click')
    expect(editor.props('document')).toBeNull()
    await wrapper.find('button[aria-label="Redo"]').trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')

    const [extra] = useOmexStore().preservedExtras
    expect(extra.location).toMatch(/obs_data\.json$/)
    expect(useProtocolStore().source.document.prediction_items).toEqual(withOutput.prediction_items)
    expect(withOutput.prediction_items).toEqual([
      expect.objectContaining({ data_item_name: 'V_mean', operands: ['cell/V'], operation: 'mean', experiment_idx: 0, item_name_for_plotting: 'V_mean' }),
    ])
  })

  it("saves the feature plots the Outputs editor adds as the obs_data's prediction_plots, undoably until then", async () => {
    mountEditor()
    const editor = wrapper.findComponent({ name: 'ProtocolEditor' })
    const withOutput = addOutput(ensureProtocol(null), { name: 'V_mean', operands: ['cell/V'], unit: 'mV', experiments: [0], operation: 'mean' })
    editor.vm.$emit('update:document', withOutput)
    await wrapper.vm.$nextTick()
    const withPlot = addPredictionPlot(editor.props('document'), { name: 'V_mean by experiment', kind: 'feature_vs_experiment', y: 'V_mean' })
    editor.vm.$emit('update:document', withPlot)
    await wrapper.vm.$nextTick()
    await wrapper.find('button[aria-label="Undo"]').trigger('click')
    expect(editor.props('document').prediction_plots).toBeUndefined()
    await wrapper.find('button[aria-label="Redo"]').trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')

    expect(useProtocolStore().source.document.prediction_plots).toEqual([{ name: 'V_mean by experiment', kind: 'feature_vs_experiment', x: null, y: 'V_mean', series: null }])
    expect(useProtocolStore().source.document.prediction_items).toEqual(withOutput.prediction_items)
  })
})
