// @vitest-environment happy-dom
import { computed, nextTick, ref, shallowRef } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
import Select from 'primevue/select'
import SelectButton from 'primevue/selectbutton'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/services/export/protocolSedml', () => ({
  FEATURE_OPERATIONS: ['mean', 'min', 'max', 'max_minus_min'],
  countSharedSubexperiments: (view) => Math.min(...view.experiments.map(({ subs }) => subs.length)),
}))
vi.mock('../../../src/stores/protocolStore', async () => {
  const { reactive } = await import('vue')
  const protocolStore = reactive({ view: null })
  return { useProtocolStore: () => protocolStore }
})

const { default: ProtocolSedmlExportDialog } = await import('../../../src/components/simulation/ProtocolSedmlExportDialog.vue')
const { useProtocolStore } = await import('../../../src/stores/protocolStore.js')

const VIEW = {
  experiments: [
    { label: 'low', colour: null, subs: [{}, {}] },
    { label: null, colour: null, subs: [{}, {}] },
  ],
  controls: [{ parameter: 'a/k', cells: [] }],
}

let wrapper
afterEach(() => wrapper?.unmount())

/**
 * Gives an exporter as useProtocolSedmlExport does, prepared for nodes `a` and `b`.
 *
 * @param {Object} [overrides] - Values for its refs.
 * @returns {Object}
 */
function createExporter(overrides = {}) {
  const prepared = shallowRef({
    errors: [],
    warnings: [],
    scope: { nodes: [{ id: 'a' }, { id: 'b' }] },
    scopeNodeIds: null,
    plan: { experiments: [{}, {}] },
    inputs: new Map([['a/k', { name: 'a/k', isStepped: true }]]),
    settings: { solver: 'CVODE', tolerance: 1e-7, maxSteps: 500, timeStep: 0, pointInterval: 0.1 },
    voi: { name: 'm/t', unit: 'second' },
    ...overrides.prepared,
  })
  const features = ref([])
  const featureErrors = ref(overrides.featureErrors ?? [])
  return {
    visible: ref(true),
    isPreparing: ref(false),
    isExporting: ref(false),
    prepared,
    errors: computed(() => prepared.value.errors),
    warnings: computed(() => prepared.value.warnings),
    overlay: ref(false),
    includeInputs: ref(false),
    features,
    featurePlots: ref([]),
    featureErrors,
    groups: ref([{ id: 'plot-1', name: 'Voltage' }]),
    traces: ref([{ name: 'a/x', label: 'a/x', unit: 'mV', groupId: 'plot-1' }]),
    operands: ref([{ name: 'a/x', kind: 'state', unit: 'mV' }]),
    canExport: computed(() => !prepared.value.errors.length && !featureErrors.value.length),
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
  wrapper = mount(ProtocolSedmlExportDialog, { props: { exporter }, global: { plugins: [PrimeVue], stubs: { teleport: true } } })
  await nextTick()
  return wrapper
}

const button = (label) => wrapper.findAll('button').find((b) => b.text() === label)
const byLabel = (label) => wrapper.find(`[aria-label="${label}"]`)

describe('ProtocolSedmlExportDialog', () => {
  beforeEach(() => {
    useProtocolStore().view = VIEW
  })

  it('sums up the export and previews each plot', async () => {
    await mountDialog(createExporter())

    const summary = wrapper.find('.export-summary').text()
    expect(summary).toContain('The whole model: 2 instances')
    expect(summary).toContain('low, Experiment 2')
    expect(summary).toContain('CVODE · tolerance 1e-7 · at most 500 steps · a point every 0.1 second')
    expect(wrapper.find('.trace-preview').text()).toContain('Voltage')
    expect(wrapper.find('.trace-preview').text()).toContain('a/x')
    expect(button('Export ZIP').attributes('disabled')).toBeUndefined()
  })

  it('lists the inputs first when asked for', async () => {
    const exporter = createExporter()
    await mountDialog(exporter)
    exporter.includeInputs.value = true
    await nextTick()

    const names = wrapper.findAll('.trace-group-name').map((name) => name.text())
    expect(names).toEqual(['Inputs', 'Voltage'])
  })

  it("shows what stops the export, and doesn't export", async () => {
    await mountDialog(createExporter({ prepared: { errors: ['The protocol sets b/k.'], warnings: ['Watch out.'] } }))

    expect(wrapper.findAll('.p-message-error').map((message) => message.text())).toEqual(['The protocol sets b/k.'])
    expect(wrapper.findAll('.p-message-warn').map((message) => message.text())).toEqual(['Watch out.'])
    expect(button('Export ZIP').attributes('disabled')).toBeDefined()
  })

  it('adds features, numbering sub-experiments from 1', async () => {
    const exporter = createExporter()
    await mountDialog(exporter)
    await button('Add feature').trigger('click')

    expect(exporter.features.value).toEqual([{ name: 'feature_1', operation: 'mean', operand: null, subexperiment: 0 }])
    expect(byLabel('Feature 1 name').exists()).toBe(true)
    expect(byLabel('Feature 1 variable').exists()).toBe(true)
    const [operation, sub] = wrapper.findAllComponents(Select)
    expect(operation.props('options').map(({ label }) => label)).toEqual(['mean', 'min', 'max', 'max − min'])
    expect(sub.props('options')).toEqual([
      { label: 'Sub-experiment 1', value: 0 },
      { label: 'Sub-experiment 2', value: 1 },
    ])

    await button('Add feature').trigger('click')
    expect(exporter.features.value[1].name).toBe('feature_2')
    await byLabel('Remove feature 1').trigger('click')
    expect(exporter.features.value.map(({ name }) => name)).toEqual(['feature_2'])
  })

  it('offers only the sub-experiments every experiment has', async () => {
    useProtocolStore().view = { ...VIEW, experiments: [...VIEW.experiments, { label: 'long', colour: null, subs: [{}, {}, {}] }] }
    await mountDialog(createExporter())
    await button('Add feature').trigger('click')

    const [, sub] = wrapper.findAllComponents(Select)
    expect(sub.props('options').map(({ value }) => value)).toEqual([0, 1])
  })

  it('offers the features to plot by their names trimmed, as the export reads them', async () => {
    const exporter = createExporter()
    await mountDialog(exporter)
    await button('Add feature').trigger('click')
    exporter.features.value[0].name = 'peak '
    await button('Add feature plot').trigger('click')

    expect(exporter.featurePlots.value[0].y).toBe('peak')
  })

  it('plots a feature against a protocol input, with a line per value of another', async () => {
    const exporter = createExporter()
    await mountDialog(exporter)
    await button('Add feature').trigger('click')
    await button('Add feature plot').trigger('click')
    expect(exporter.featurePlots.value).toEqual([{ title: '', y: 'feature_1', x: { kind: 'experiment' }, series: null }])

    wrapper.findComponent(SelectButton).vm.$emit('update:modelValue', 'input')
    await nextTick()
    expect(exporter.featurePlots.value[0].x).toEqual({ kind: 'input', parameter: 'a/k', subexperiment: 0 })
    expect(byLabel('Feature plot 1 x parameter').exists()).toBe(true)

    await wrapper.find('#sedml-series-0').setValue(true)
    expect(exporter.featurePlots.value[0].series).toEqual({ parameter: 'a/k', subexperiment: 0 })
    expect(byLabel('Feature plot 1 series parameter').exists()).toBe(true)
  })

  it("shows the features' problems and blocks the export", async () => {
    await mountDialog(createExporter({ featureErrors: [{ path: 'features[0].operand', message: 'Choose a variable.' }] }))

    expect(wrapper.findAll('.p-message-error').map((message) => message.text())).toEqual(['Choose a variable.'])
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
