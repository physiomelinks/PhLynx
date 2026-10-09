// @vitest-environment happy-dom
import { computed, nextTick, ref, shallowRef } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Select from 'primevue/select'
import SelectButton from 'primevue/selectbutton'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/stores/protocolStore', async () => {
  const { reactive } = await import('vue')
  const protocolStore = reactive({ view: null })
  return { useProtocolStore: () => protocolStore }
})

const { default: ProtocolExportDialog } = await import('../../../src/components/simulation/ProtocolExportDialog.vue')
const { useProtocolStore } = await import('../../../src/stores/protocolStore.js')

const VIEW = {
  experiments: [
    { label: 'low', colour: null, subs: [{}, {}] },
    { label: null, colour: null, subs: [{}, {}, {}] },
  ],
  controls: [{ parameter: 'a/k', cells: [] }],
}

let wrapper
afterEach(() => wrapper?.unmount())

/**
 * Gives an exporter as useProtocolExport does, prepared for nodes `a` and `b`.
 *
 * @param {Object} [overrides] - Values for its refs.
 * @returns {Object}
 */
function createExporter(overrides = {}) {
  const prepared = shallowRef({
    errors: [],
    warnings: [],
    cellml: '<model/>',
    scope: { nodes: [{ id: 'a' }, { id: 'b' }] },
    scopeNodeIds: null,
    settings: { solver: 'CVODE', tolerance: 1e-7, maxSteps: 500, timeStep: 0.01, pointInterval: 0.1 },
    voi: { name: 'm/t', unit: 'second' },
    ...overrides.prepared,
  })
  const plotErrors = ref(overrides.plotErrors ?? [])
  return {
    visible: ref(true),
    isPreparing: ref(false),
    isExporting: ref(false),
    prepared,
    errors: computed(() => prepared.value.errors),
    warnings: computed(() => prepared.value.warnings),
    featurePlots: ref([]),
    plotErrors,
    featureGroups: ref(overrides.featureGroups ?? [{ name: 'I_peak', experiments: [0, 1] }, { name: 'V_step', experiments: [0, 1] }]),
    solverInfo: ref({ MaximumStep: 0.01, rtol: 1e-7, atol: 1e-7 }),
    files: ref(['run_protocol.py', 'model.cellml', 'cell_obs_data.json']),
    canExport: computed(() => !prepared.value.errors.length && !plotErrors.value.length),
    open: vi.fn(),
    close: vi.fn(),
    exportZip: vi.fn(),
  }
}

/**
 * Mounts the dialog open, its content kept in place rather than teleported.
 *
 * @param {Object} exporter
 * @returns {Promise<import('@vue/test-utils').VueWrapper>}
 */
async function mountDialog(exporter) {
  wrapper = mount(ProtocolExportDialog, { props: { exporter }, global: { plugins: [PrimeVue], stubs: { teleport: true } } })
  await nextTick()
  return wrapper
}

const button = (label) => wrapper.findAll('button').find((b) => b.text() === label)
const byLabel = (label) => wrapper.find(`[aria-label="${label}"]`)

describe('ProtocolExportDialog', () => {
  beforeEach(() => {
    useProtocolStore().view = VIEW
  })

  it('sums up the export: the model, experiments, solver and files', async () => {
    await mountDialog(createExporter())

    const summary = wrapper.find('.export-summary').text()
    expect(summary).toContain('The whole model: 2 instances')
    expect(summary).toContain('low, Experiment 2')
    expect(summary).toContain('CVODE · tolerances 1e-7 (relative), 1e-7 (absolute) · largest step 0.01 · a point every 0.1 second')
    expect(summary).toContain('run_protocol.py, model.cellml, cell_obs_data.json')
    expect(button('Export ZIP').attributes('disabled')).toBeUndefined()
  })

  it("shows what stops the export and what to know, and doesn't export when stopped", async () => {
    await mountDialog(createExporter({ prepared: { errors: ['Wait for the run to finish.'], warnings: ['protocol.sedml is left out.'] } }))

    expect(wrapper.findAll('.p-message-error').map((message) => message.text())).toEqual(['Wait for the run to finish.'])
    expect(wrapper.findAll('.p-message-warn').map((message) => message.text())).toEqual(['protocol.sedml is left out.'])
    expect(button('Export ZIP').attributes('disabled')).toBeDefined()
  })

  it('pairs the first feature with the experiments, then with a protocol input and a line per value of another', async () => {
    const exporter = createExporter()
    await mountDialog(exporter)
    await button('Add feature plot').trigger('click')
    expect(exporter.featurePlots.value).toEqual([{ title: '', y: 'I_peak', x: { kind: 'experiment' }, series: null }])
    expect(wrapper.findComponent(Select).props('options')).toEqual(['I_peak', 'V_step'])

    wrapper.findComponent(SelectButton).vm.$emit('update:modelValue', 'feature')
    await nextTick()
    expect(exporter.featurePlots.value[0].x).toEqual({ kind: 'feature', feature: 'V_step' })

    wrapper.findComponent(SelectButton).vm.$emit('update:modelValue', 'input')
    await nextTick()
    expect(exporter.featurePlots.value[0].x).toEqual({ kind: 'input', input: 'a/k', subexperiment: 0 })
    expect(byLabel('Feature plot 1 x input').exists()).toBe(true)
    // Up to the most sub-experiments any experiment has.
    const [, , sub] = wrapper.findAllComponents(Select)
    expect(sub.props('options').map(({ value }) => value)).toEqual([0, 1, 2])

    await wrapper.find('#export-series-0').setValue(true)
    expect(exporter.featurePlots.value[0].series).toEqual({ input: 'a/k', subexperiment: 0 })
    expect(byLabel('Feature plot 1 series input').exists()).toBe(true)

    await byLabel('Remove feature plot 1').trigger('click')
    expect(exporter.featurePlots.value).toEqual([])
  })

  it('says how to get features when the protocol records none, and offers no plot of them', async () => {
    await mountDialog(createExporter({ featureGroups: [] }))

    expect(wrapper.text()).toContain('The protocol records no features.')
    expect(button('Add feature plot').attributes('disabled')).toBeDefined()
  })

  it("shows the plots' problems and blocks the export", async () => {
    await mountDialog(createExporter({ plotErrors: [{ path: 'featurePlots[0].y', message: 'Choose a feature to plot.' }] }))

    expect(wrapper.findAll('.p-message-error').map((message) => message.text())).toEqual(['Choose a feature to plot.'])
    expect(button('Export ZIP').attributes('disabled')).toBeDefined()
  })

  it('exports, or closes, when asked', async () => {
    const exporter = createExporter()
    await mountDialog(exporter)

    await button('Export ZIP').trigger('click')
    expect(exporter.exportZip).toHaveBeenCalled()
    await button('Cancel').trigger('click')
    expect(exporter.close).toHaveBeenCalled()
  })

  it('says it is reading the model while it prepares', async () => {
    const exporter = createExporter()
    exporter.isPreparing.value = true
    await mountDialog(exporter)

    expect(wrapper.find('[role="status"]').text()).toBe('Reading the model…')
    expect(wrapper.find('.export-summary').exists()).toBe(false)
  })
})
