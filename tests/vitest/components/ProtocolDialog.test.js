// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import PrimeVue from 'primevue/config'
import ConfirmationService from 'primevue/confirmationservice'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { addPredictionItem, createPredictionItem, ensureProtocol } from '@physiomelinks/protocol-kit'
import { isSettable, searchVariables } from '@physiomelinks/protocol-kit/editor'

import ProtocolDialog from '../../../src/components/ProtocolDialog.vue'
import { SERIES_COLOURS } from '../../../src/services/simulation/seriesSlots.js'
import { buildVariableIndex, searchVariableIndex } from '../../../src/services/simulation/variableIndex.js'
import { defaultAppSettings } from '../../../src/utils/appSettings.js'
import { useAppSettings } from '../../../src/composables/useAppSettings.js'
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

const { saveAppSettings } = useAppSettings()

let wrapper
afterEach(() => wrapper?.unmount())
beforeEach(() => {
  setActivePinia(createPinia())
  saveAppSettings(defaultAppSettings())
})

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
      stubs: { Dialog: { template: '<div><slot /><slot name="footer" /></div>' }, ObsDataEditor: true },
      directives: { tooltip: {} },
    },
  })
  return wrapper.findComponent({ name: 'ObsDataEditor' }).props()
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

  it("lists the data items read-only, without a calibration's columns, as PhLynx's preset does", () => {
    expect(mountEditor()).toMatchObject({ preset: 'phlynx', showDataItems: true })
  })

  it("hides the data items when the settings say, and shows them again when they're turned back on", async () => {
    saveAppSettings({ showDataItems: false })
    expect(mountEditor().showDataItems).toBe(false)
    saveAppSettings({ showDataItems: true })
    await wrapper.vm.$nextTick()
    expect(wrapper.findComponent({ name: 'ObsDataEditor' }).props('showDataItems')).toBe(true)
  })

  it("lists the obs_data's data items in the editor without a way to change them, counts them, and lists none once the settings hide them", async () => {
    const document = {
      protocol_info: { pre_times: [0], sim_times: [[1, 1]], params_to_change: { 'cell/g_Na': [[120, 240]] } },
      data_items: [
        { variable: 'V_peak', data_type: 'constant', unit: 'mV', operation: 'max', operands: ['cell/V'], value: 30, std: 2, experiment_idx: 0, subexperiment_idx: 1 },
        // A series is kept as it is, and counted by the kit's note, not as a row.
        { variable: 'V_trace', data_type: 'series', unit: 'mV', operands: ['cell/V'], value: [1, 2], std: 1, obs_dt: 0.5, experiment_idx: 0, subexperiment_idx: 1 },
      ],
    }
    useProtocolStore().saveDocument(document)
    /** Opens the dialog with the real editor. */
    const open = async () => {
      wrapper?.unmount()
      wrapper = mount(ProtocolDialog, {
        props: { modelValue: false, nodes: NODES },
        global: { plugins: [PrimeVue, ConfirmationService], stubs: { Dialog: { template: '<div><slot /><slot name="footer" /></div>' } }, directives: { tooltip: {} } },
      })
      await wrapper.setProps({ modelValue: true })
    }

    await open()
    const section = wrapper.find('section[aria-label="data_items"]')
    const row = section.find('[data-testid="od-data-row"]')
    expect(row.text()).toContain('V_peak')
    expect(row.text()).toContain('max')
    expect(row.findAll('input, select')).toHaveLength(0)
    expect(row.find('button[aria-label="remove"]').exists()).toBe(false)
    expect(wrapper.find('.footer-count').text()).toBe('1 data item(s)')
    expect(section.find('[data-testid="od-preserved"]').text()).toContain('1 non-editable item(s)')

    saveAppSettings({ showDataItems: false })
    await open()
    expect(wrapper.find('section[aria-label="data_items"]').exists()).toBe(false)
  })

  it("checks prediction items' ranges against the run's point interval", () => {
    useSimulationSettingsStore().setSimulationSettings({ pointInterval: 0.25 })
    expect(mountEditor().dt).toBe(0.25)
  })

  it("saves the prediction items the editor adds into the workspace's obs_data, undoably until then", async () => {
    mountEditor()
    const editor = wrapper.findComponent({ name: 'ObsDataEditor' })
    const withItem = addPredictionItem(ensureProtocol(null), { ...createPredictionItem(), operands: ['cell/V'], unit: 'mV', operation: 'mean' })
    editor.vm.$emit('update:document', withItem)
    await wrapper.vm.$nextTick()
    expect(editor.props('document')).toEqual(withItem)

    await wrapper.find('button[aria-label="Undo"]').trigger('click')
    expect(editor.props('document')).toBeNull()
    await wrapper.find('button[aria-label="Redo"]').trigger('click')
    await wrapper.findAll('button').find((button) => button.text() === 'Save').trigger('click')

    const [extra] = useOmexStore().preservedExtras
    expect(extra.location).toMatch(/obs_data\.json$/)
    expect(useProtocolStore().source.document.prediction_items).toEqual(withItem.prediction_items)
    expect(withItem.prediction_items).toEqual([expect.objectContaining({ data_item_name: 'cell/V', operands: ['cell/V'], operation: 'mean', experiment_idx: 0 })])
  })
})
