// @vitest-environment happy-dom
import { computed, nextTick, ref, shallowRef } from 'vue'
import { mount } from '@vue/test-utils'
import PrimeVue from 'primevue/config'
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
  return {
    visible: ref(true),
    isPreparing: ref(false),
    isExporting: ref(false),
    prepared,
    errors: computed(() => prepared.value.errors),
    warnings: computed(() => prepared.value.warnings),
    predictionPlots: ref(overrides.predictionPlots ?? []),
    solverInfo: ref({ MaximumStep: 0.01, rtol: 1e-7, atol: 1e-7 }),
    files: ref(['run_protocol.py', 'model.cellml', 'cell_obs_data.json']),
    canExport: computed(() => !prepared.value.errors.length),
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

  it("lists the obs_data's feature plots read-only, pointing to the protocol editor, and those the script skips", async () => {
    await mountDialog(
      createExporter({
        predictionPlots: [
          { name: 'I–V', pairing: 'I_peak against a/k (sub-experiment 2)', series: 'a line per value of a/g (sub-experiment 1)', errors: [] },
          { name: 'Odd', pairing: 'I_peak against V_step', series: null, errors: ['x and y cover different experiments.'] },
        ],
      })
    )

    const rows = wrapper.findAll('.feature-plot')
    expect(rows.map((row) => row.find('.plot-name').text())).toEqual(['I–V', 'Odd'])
    expect(rows[0].find('.plot-pairing').text()).toBe('I_peak against a/k (sub-experiment 2), a line per value of a/g (sub-experiment 1)')
    expect(rows[0].find('.plot-skipped').exists()).toBe(false)
    expect(rows[1].find('.plot-skipped').exists()).toBe(true)
    expect(wrapper.text()).toContain('Add or change them under Outputs in the protocol editor (Edit the protocol).')
    // Nothing to edit here.
    expect(wrapper.findAll('input, select')).toHaveLength(0)
    expect(button('Add feature plot')).toBeUndefined()
    expect(button('Export ZIP').attributes('disabled')).toBeUndefined()
  })

  it('says when the protocol has no feature plots of its own', async () => {
    await mountDialog(createExporter())
    expect(wrapper.text()).toContain('The protocol has no feature plots of its own.')
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
