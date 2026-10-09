// @vitest-environment happy-dom
import { nextTick, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const nodes = ref([])
vi.mock('@vue-flow/core', async (importOriginal) => ({ ...(await importOriginal()), useVueFlow: () => ({ nodes }) }))

const simulation = vi.hoisted(() => ({ prepareProtocolExport: null }))
vi.mock('../../../src/composables/useSimulation', () => ({
  useSimulation: () => ({ prepareProtocolExport: (...args) => simulation.prepareProtocolExport(...args) }),
}))
const builder = vi.hoisted(() => ({
  validateExportFeatures: vi.fn(() => ({ errors: [] })),
  buildProtocolSedml: vi.fn(() => '<sedML/>'),
  buildBundleReadme: vi.fn(() => '# README'),
  generateProtocolSedmlZip: vi.fn(async () => new Blob(['zip'])),
}))
vi.mock('../../../src/services/export/protocolSedml', () => ({ FEATURE_OPERATIONS: ['mean', 'min', 'max', 'max_minus_min'], ...builder }))
vi.mock('../../../src/services/export/templates/run_sedml.py?raw', () => ({ default: '# run_sedml.py' }))
const saving = vi.hoisted(() => ({ order: [], getFileHandle: null, saveWithDialog: null }))
vi.mock('../../../src/utils/save', async (importOriginal) => ({
  ...(await importOriginal()),
  getFileHandle: (...args) => saving.getFileHandle(...args),
  saveWithDialog: (...args) => saving.saveWithDialog(...args),
}))
const notified = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('../../../src/utils/notify', () => ({ notify: notified }))

const { useProtocolSedmlExport } = await import('../../../src/composables/useProtocolSedmlExport.js')
const { ALL_EXPERIMENTS, useProtocolStore } = await import('../../../src/stores/protocolStore.js')
const { useOmexStore } = await import('../../../src/stores/omexStore.js')
const { useSessionMetadataStore } = await import('../../../src/stores/sessionMetadataStore.js')
const { useSimulationSettingsStore } = await import('../../../src/stores/simulationSettingsStore.js')

const PROTOCOL = { pre_times: [0, 0], sim_times: [[1, 1], [1, 1]], params_to_change: { 'a/k': [[2, 0], [3, 0]] }, experiment_labels: ['low', 'high'] }
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Gives the workspace an obs_data file with a protocol.
 *
 * @param {Object} protocolInfo
 * @returns {ArrayBuffer} The file, as the workspace has it.
 */
function useProtocol(protocolInfo) {
  const payload = new TextEncoder().encode(JSON.stringify({ protocol_info: protocolInfo, data_items: [] })).buffer
  useOmexStore().setArchive({ extras: [{ location: 'model_obs_data.json', format: 'application/json', payload }] })
  return payload
}

/**
 * Gives what prepareProtocolExport gives for nodes `a` and `b`.
 *
 * @param {Object} [overrides]
 * @returns {Object}
 */
const createPrepared = (overrides = {}) => ({
  errors: [],
  warnings: ['A warning from the plan.'],
  cellml: '<model/>',
  scope: { nodes: nodes.value },
  scopeNodeIds: null,
  plan: { experiments: [{}, {}] },
  targets: new Map([['a/k', 'a/k']]),
  inputs: new Map([['a/k', { name: 'a/k', isStepped: true }]]),
  drivers: [],
  settings: { solver: 'CVODE', pointInterval: 0.1 },
  mapping: new Map([
    ['a::x', 'a/x'],
    ['a::t', 'm/t'],
    ['a::k', 'a/k'],
  ]),
  variables: new Map([
    ['a/x', { kind: 'state', unit: 'mV' }],
    ['a/k', { kind: 'constant', unit: 'dimensionless' }],
    ['protocol_clock/experiment_time', { kind: 'algebraic', unit: 'second' }],
  ]),
  inspectionOutputs: [],
  voi: { name: 'm/t', unit: 'second' },
  ...overrides,
})

const node = (id, variables) => ({ id, data: { name: id, variables } })

describe('useProtocolSedmlExport', () => {
  let payload
  // Features are remembered by protocol for the session, so each test has a protocol of its own.
  let testCount = 0

  beforeEach(() => {
    setActivePinia(createPinia())
    testCount++
    payload = useProtocol({ ...PROTOCOL, pre_times: [testCount, testCount] })
    nodes.value = [
      node('a', [
        { name: 'x', type: 'variable', units: 'mV' },
        { name: 't', type: 'variable', units: 'second' },
        { name: 'k', type: 'constant', units: 'dimensionless' },
      ]),
      node('b', [{ name: 'y', type: 'variable' }]),
    ]
    useSimulationSettingsStore().setPlotConfig({
      groups: [{ id: 'plot-1', name: 'Voltage' }],
      selections: [
        { key: 'a::x', nodeId: 'a', nodeName: 'a', variableName: 'x', groupId: 'plot-1' },
        { key: 'a::t', nodeId: 'a', nodeName: 'a', variableName: 't', groupId: 'plot-1' },
        { key: 'b::y', nodeId: 'b', nodeName: 'b', variableName: 'y', groupId: null },
      ],
    })
    simulation.prepareProtocolExport = vi.fn(async () => createPrepared())
    saving.order = []
    saving.getFileHandle = vi.fn(async (baseName) => {
      saving.order.push('pick')
      return { success: true, handle: { name: `${baseName}.zip` }, cleanName: baseName, method: 'system' }
    })
    saving.saveWithDialog = vi.fn(async () => ({ success: true }))
    vi.clearAllMocks()
    builder.validateExportFeatures.mockImplementation(() => ({ errors: [] }))
    builder.buildProtocolSedml.mockImplementation(() => {
      saving.order.push('build')
      return '<sedML/>'
    })
  })

  it('prefills from the results view: all experiments overlaid, and the inputs shown', async () => {
    const protocolStore = useProtocolStore()
    protocolStore.setActiveExperiment(ALL_EXPERIMENTS)
    protocolStore.isShowingInputs = true
    const exporter = useProtocolSedmlExport()

    const opening = exporter.open()
    expect(exporter.visible.value).toBe(true)
    expect(exporter.isPreparing.value).toBe(true)
    await opening

    expect(exporter.isPreparing.value).toBe(false)
    expect(exporter.overlay.value).toBe(true)
    expect(exporter.includeInputs.value).toBe(true)
    expect(exporter.inputs.value).toEqual([{ name: 'a/k', label: 'a/k', unit: 'dimensionless' }])

    protocolStore.setActiveExperiment(1)
    protocolStore.isShowingInputs = false
    await exporter.open()
    expect(exporter.overlay.value).toBe(false)
    expect(exporter.inputs.value).toBeNull()
  })

  it('exports the plotted variables by their reported names, leaving out time and what the model lacks', async () => {
    const exporter = useProtocolSedmlExport()
    await exporter.open()

    expect(exporter.groups.value).toEqual([{ id: 'plot-1', name: 'Voltage' }])
    expect(exporter.traces.value).toEqual([{ name: 'a/x', label: 'a/x', unit: 'mV', groupId: 'plot-1' }])
    expect(exporter.warnings.value).toEqual([
      'A warning from the plan.',
      "a/t is time, which every plot has along its x axis, so it isn't plotted.",
      "b/y isn't in the exported model, so it isn't plotted.",
    ])
  })

  it('offers every variable but time to reduce, and validates the features against them', async () => {
    const exporter = useProtocolSedmlExport()
    await exporter.open()

    expect(exporter.operands.value.map(({ name }) => name)).toEqual(['a/x', 'a/k'])
    exporter.features.value.push({ name: 'peak', operation: 'max', operand: 'a/x', subexperiment: 0 })
    builder.validateExportFeatures.mockImplementation(({ features }) => ({ errors: features.length ? [{ path: 'features[0]', message: 'Bad.' }] : [] }))
    expect(exporter.featureErrors.value).toEqual([{ path: 'features[0]', message: 'Bad.' }])
    expect(exporter.canExport.value).toBe(false)
    const [[options]] = builder.validateExportFeatures.mock.calls.slice(-1)
    expect(options.view).toBe(useProtocolStore().view)
    expect([...options.operandNames]).toEqual(['a/x', 'a/k'])
  })

  it('remembers the features for the protocol, for the session', async () => {
    const first = useProtocolSedmlExport()
    await first.open()
    first.features.value.push({ name: 'peak', operation: 'max', operand: 'a/x', subexperiment: 1 })
    first.featurePlots.value.push({ title: 'Peaks', y: 'peak', x: { kind: 'experiment' }, series: null })
    await nextTick()

    const second = useProtocolSedmlExport()
    await second.open()
    expect(second.features.value).toEqual([{ name: 'peak', operation: 'max', operand: 'a/x', subexperiment: 1 }])
    expect(second.featurePlots.value).toHaveLength(1)

    useProtocol({ ...PROTOCOL, pre_times: [testCount, testCount], experiment_labels: ['one', 'two'] })
    await second.open()
    expect(second.features.value).toEqual([])
  })

  it("can't export what couldn't be prepared", async () => {
    simulation.prepareProtocolExport = vi.fn(async () => ({ errors: ['The protocol sets b/k, which isn’t in the model.'], warnings: [] }))
    const exporter = useProtocolSedmlExport()
    await exporter.open()

    expect(exporter.errors.value).toEqual(['The protocol sets b/k, which isn’t in the model.'])
    expect(exporter.canExport.value).toBe(false)
    await exporter.exportZip()
    expect(saving.getFileHandle).not.toHaveBeenCalled()
  })

  it('asks where to save before building, then saves the zip with the obs_data file as it is', async () => {
    useSessionMetadataStore().setLastSaveName('heart.json')
    const exporter = useProtocolSedmlExport()
    await exporter.open()
    exporter.overlay.value = true

    const exporting = exporter.exportZip()
    // Asked at once, while the click still counts.
    expect(saving.getFileHandle).toHaveBeenCalledWith('heart_protocol', expect.any(Array), '.zip')
    await exporting

    expect(saving.order).toEqual(['pick', 'build'])
    const [[options]] = builder.buildProtocolSedml.mock.calls
    expect(options).toMatchObject({
      experiments: [
        { label: 'low', colour: null },
        { label: 'high', colour: null },
      ],
      time: { unit: 'second' },
      groups: [{ id: 'plot-1', name: 'Voltage' }],
      traces: [{ name: 'a/x' }],
      inputs: null,
      features: [],
      featurePlots: [],
      overlay: true,
      drivers: [],
    })
    expect(builder.buildBundleReadme).toHaveBeenCalledWith(expect.objectContaining({ stem: 'heart_protocol', hasDrivers: false }))
    const [[zip]] = builder.generateProtocolSedmlZip.mock.calls
    expect(zip).toEqual({ sedml: '<sedML/>', cellml: '<model/>', script: '# run_sedml.py', obsDataPayload: payload, readme: '# README' })
    expect(saving.saveWithDialog).toHaveBeenCalledWith(expect.any(Blob), { name: 'heart_protocol.zip' }, 'heart_protocol', '.zip')
    expect(notified.success).toHaveBeenCalled()
    expect(exporter.visible.value).toBe(false)
  })

  it('does nothing more when the save is cancelled, and reports a failure', async () => {
    const exporter = useProtocolSedmlExport()
    await exporter.open()
    saving.getFileHandle = vi.fn(async () => ({ success: false, cancelled: true }))
    await exporter.exportZip()
    expect(builder.buildProtocolSedml).not.toHaveBeenCalled()
    expect(exporter.visible.value).toBe(true)

    saving.getFileHandle = vi.fn(async () => ({ success: false, needsLegacyDialog: true, method: 'legacy' }))
    builder.generateProtocolSedmlZip.mockRejectedValueOnce(new Error('No room.'))
    await exporter.exportZip()
    expect(notified.error).toHaveBeenCalledWith({ title: 'Export failed', message: 'No room.' })
    expect(exporter.isExporting.value).toBe(false)
    await settle()
  })
})
