// @vitest-environment happy-dom
import JSZip from 'jszip'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const nodes = ref([])
vi.mock('@vue-flow/core', async (importOriginal) => ({ ...(await importOriginal()), useVueFlow: () => ({ nodes }) }))

const simulation = vi.hoisted(() => ({ prepareProtocolExport: null }))
vi.mock('../../../src/composables/useSimulation', () => ({
  useSimulation: () => ({ prepareProtocolExport: (...args) => simulation.prepareProtocolExport(...args) }),
}))
const builder = vi.hoisted(() => ({ buildProtocolSedml: null }))
vi.mock('../../../src/services/export/protocolSedml', async (importOriginal) => ({
  ...(await importOriginal()),
  buildProtocolSedml: (...args) => builder.buildProtocolSedml(...args),
}))
const saving = vi.hoisted(() => ({ order: [], getFileHandle: null, saveWithDialog: null }))
vi.mock('../../../src/utils/save', async (importOriginal) => ({
  ...(await importOriginal()),
  getFileHandle: (...args) => saving.getFileHandle(...args),
  saveWithDialog: (...args) => saving.saveWithDialog(...args),
}))
const notified = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('../../../src/utils/notify', () => ({ notify: notified }))

const { useProtocolExport } = await import('../../../src/composables/useProtocolExport.js')
const { ALL_EXPERIMENTS, useProtocolStore } = await import('../../../src/stores/protocolStore.js')
const { useOmexStore } = await import('../../../src/stores/omexStore.js')
const { useSessionMetadataStore } = await import('../../../src/stores/sessionMetadataStore.js')
const { useSimulationSettingsStore } = await import('../../../src/stores/simulationSettingsStore.js')

const OBS_DATA = {
  protocol_info: {
    pre_times: [0, 0],
    sim_times: [
      [1, 1],
      [1, 1],
    ],
    params_to_change: { 'a/k': [[2, 0], [3, 0]], 'engine/pace': [[0, 1], [0, 1]] },
    experiment_labels: ['low', 'high'],
  },
  data_items: [],
  prediction_items: [
    { data_item_name: 'x', operands: ['a/x'], unit: 'mV', experiment_idx: 0 },
    { data_item_name: 'peak_e0', operands: ['a/x'], unit: 'mV', item_name_for_plotting: 'peak', operation: 'max', experiment_idx: 0, subexperiment_idx: 1 },
    { data_item_name: 'peak_e1', operands: ['a/x'], unit: 'mV', item_name_for_plotting: 'peak', operation: 'max', experiment_idx: 1, subexperiment_idx: 1 },
  ],
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/**
 * Gives the workspace an obs_data file, in a folder of the archive.
 *
 * @param {Object} document
 * @returns {ArrayBuffer} The file, as the workspace has it.
 */
function useObsData(document) {
  const payload = new TextEncoder().encode(`${JSON.stringify(document, null, 1)}\n\n`).buffer
  useOmexStore().setArchive({ extras: [{ location: 'resources/heart_obs_data.json', format: 'application/json', payload }] })
  return payload
}

/**
 * Gives what prepareProtocolExport gives for node `a`, its k kept in instance_parameters.
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
  settings: { solver: 'CVODE', tolerance: 1e-7, maxSteps: 500, timeStep: 0.01, pointInterval: 0.1 },
  mapping: new Map([
    ['a::x', 'a/x'],
    ['a::t', 'm/t'],
    ['a::k', 'instance_parameters/a_k'],
  ]),
  variables: new Map([
    ['a/x', { kind: 'state', unit: 'mV' }],
    ['a/k', { kind: 'constant', unit: 'dimensionless' }],
    ['instance_parameters/a_k', { kind: 'constant', unit: 'dimensionless' }],
    ['protocol_clock/experiment_time', { kind: 'algebraic', unit: 'second' }],
    // Only as the SED-ML's model has it, so not the script's.
    ['protocol_drivers/pace', { kind: 'constant', unit: 'dimensionless' }],
  ]),
  inspectionOutputs: [],
  voi: { name: 'm/t', unit: 'second' },
  sedml: {
    cellml: '<model clocked/>',
    plan: { experiments: [{}, {}] },
    targets: new Map([['a/k', 'instance_parameters/a_k']]),
    inputs: new Map([['a/k', { name: 'instance_parameters/a_k', isStepped: true }]]),
    drivers: [],
  },
  sedmlProblem: null,
  ...overrides,
})

const node = (id, variables) => ({ id, data: { name: id, variables } })

/** Reads a zip's files. */
const readZip = async (blob) => JSZip.loadAsync(await blob.arrayBuffer())

describe('useProtocolExport', () => {
  let payload

  beforeEach(() => {
    setActivePinia(createPinia())
    payload = useObsData(OBS_DATA)
    nodes.value = [
      node('a', [
        { name: 'x', type: 'variable', units: 'mV' },
        { name: 't', type: 'variable', units: 'second' },
        { name: 'k', type: 'constant', units: 'dimensionless' },
      ]),
    ]
    useSimulationSettingsStore().setPlotConfig({
      groups: [{ id: 'plot-1', name: 'Voltage' }],
      selections: [
        { key: 'a::x', nodeId: 'a', nodeName: 'a', variableName: 'x', groupId: 'plot-1' },
        { key: 'a::t', nodeId: 'a', nodeName: 'a', variableName: 't', groupId: 'plot-1' },
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
    builder.buildProtocolSedml = vi.fn(() => {
      saving.order.push('build')
      return '<sedML/>'
    })
  })

  it('prepares the export, and says what to know: CA #536, renamed and missing parameters, and the plan', async () => {
    const exporter = useProtocolExport()
    const opening = exporter.open()
    expect(exporter.visible.value).toBe(true)
    expect(exporter.isPreparing.value).toBe(true)
    await opening

    expect(exporter.isPreparing.value).toBe(false)
    expect(exporter.featureGroups.value).toEqual([{ name: 'peak', experiments: [0, 1] }])
    // engine/pace is only in the SED-ML's model, so the script's can't set it.
    expect(exporter.parameterNames.value).toEqual({ names: { 'a/k': 'instance_parameters/a_k' }, unresolved: ['engine/pace'] })
    expect(exporter.solverInfo.value).toEqual({ MaximumStep: 0.01, rtol: 1e-7, atol: 1e-7 })
    expect(exporter.files.value).toEqual([
      'run_protocol.py',
      'model.cellml',
      'heart_obs_data.json',
      'requirements.txt',
      'README.md',
      'protocol.sedml',
      'protocol_model.cellml',
      'manifest.xml',
    ])
    expect(exporter.warnings.value).toEqual([
      'A warning from the plan.',
      "Some outputs are features, or of one sub-experiment, which need libcuflynx from circulatory_autogen #536. requirements.txt installs it; released libcuflynx 0.7.3 and CUFLynx refuse this obs_data until it's released.",
      "The script gives libcuflynx the model's names for a/k → instance_parameters/a_k, in PARAMETER_NAMES.",
      "PhLynx found no variable in the model for engine/pace: name it in the script's PARAMETER_NAMES before running it.",
    ])
    expect(exporter.canExport.value).toBe(true)
  })

  it('builds the SED-ML of the results view: its plotted variables but time, overlaid when it shows every experiment', async () => {
    const protocolStore = useProtocolStore()
    protocolStore.setActiveExperiment(ALL_EXPERIMENTS)
    protocolStore.isShowingInputs = true
    const exporter = useProtocolExport()
    await exporter.open()

    expect(exporter.sedml.value).toEqual({ sedml: '<sedML/>', problem: null })
    const [[options]] = builder.buildProtocolSedml.mock.calls
    expect(options).toMatchObject({
      experiments: [
        { label: 'low', colour: null },
        { label: 'high', colour: null },
      ],
      time: { unit: 'second' },
      groups: [{ id: 'plot-1', name: 'Voltage' }],
      traces: [{ name: 'a/x', label: 'a/x', unit: 'mV', groupId: 'plot-1' }],
      inputs: [{ name: 'instance_parameters/a_k', label: 'a/k', unit: 'dimensionless' }],
      overlay: true,
    })
  })

  it('leaves the SED-ML out, with why, when the run has no plan or its builder refuses', async () => {
    simulation.prepareProtocolExport = vi.fn(async () => createPrepared({ sedml: null, sedmlProblem: 'The plan has 2001 segments.' }))
    const exporter = useProtocolExport()
    await exporter.open()
    expect(exporter.sedml.value).toEqual({ sedml: null, problem: 'The plan has 2001 segments.' })
    expect(exporter.files.value).not.toContain('protocol.sedml')
    expect(exporter.warnings.value).toContain("protocol.sedml, PhLynx's own run, is left out: The plan has 2001 segments.")
    expect(exporter.canExport.value).toBe(true)

    simulation.prepareProtocolExport = vi.fn(async () => createPrepared())
    builder.buildProtocolSedml = vi.fn(() => {
      throw new Error('No variable.')
    })
    await exporter.open()
    expect(exporter.sedml.value).toEqual({ sedml: null, problem: 'No variable.' })
  })

  it('checks the feature plots against the features the obs_data records, and forgets them on opening again', async () => {
    const exporter = useProtocolExport()
    await exporter.open()
    exporter.featurePlots.value.push({ title: '', y: 'trough', x: { kind: 'input', input: 'engine/pace', subexperiment: 1 }, series: null })

    expect(exporter.plotErrors.value).toEqual([{ path: 'featurePlots[0].y', message: 'The protocol records no feature called trough.' }])
    expect(exporter.canExport.value).toBe(false)
    exporter.featurePlots.value[0].y = 'peak'
    expect(exporter.plotErrors.value).toEqual([])

    await exporter.open()
    expect(exporter.featurePlots.value).toEqual([])
  })

  it('warns when the protocol records no outputs', async () => {
    useObsData({ ...OBS_DATA, prediction_items: [] })
    const exporter = useProtocolExport()
    await exporter.open()
    expect(exporter.warnings.value).toContain('The protocol records no outputs, so the script has nothing to plot. Add some to its prediction_items.')
    expect(exporter.warnings.value.some((warning) => warning.includes('#536'))).toBe(false)
  })

  it("can't export what couldn't be prepared", async () => {
    simulation.prepareProtocolExport = vi.fn(async () => ({ errors: ['Wait for the run to finish.'], warnings: [] }))
    const exporter = useProtocolExport()
    await exporter.open()

    expect(exporter.errors.value).toEqual(['Wait for the run to finish.'])
    expect(exporter.canExport.value).toBe(false)
    await exporter.exportZip()
    expect(saving.getFileHandle).not.toHaveBeenCalled()
  })

  it('asks where to save first, then saves the script, the plain model and the obs_data as it is, by its name', async () => {
    useSessionMetadataStore().setLastSaveName('heart.json')
    const exporter = useProtocolExport()
    await exporter.open()
    exporter.featurePlots.value.push({ title: 'Peaks', y: 'peak', x: { kind: 'input', input: 'a/k', subexperiment: 0 }, series: null })

    const exporting = exporter.exportZip()
    // Asked at once, while the click still counts.
    expect(saving.getFileHandle).toHaveBeenCalledWith('heart_protocol', expect.any(Array), '.zip')
    await exporting

    expect(saving.order).toEqual(['pick', 'build'])
    const [[blob, handle, stem, extension]] = saving.saveWithDialog.mock.calls
    expect([handle, stem, extension]).toEqual([{ name: 'heart_protocol.zip' }, 'heart_protocol', '.zip'])
    const zip = await readZip(blob)
    expect(Object.keys(zip.files).sort()).toEqual(
      ['README.md', 'heart_obs_data.json', 'manifest.xml', 'model.cellml', 'protocol.sedml', 'protocol_model.cellml', 'requirements.txt', 'run_protocol.py'].sort()
    )
    expect(new Uint8Array(await zip.file('heart_obs_data.json').async('uint8array'))).toEqual(new Uint8Array(payload))
    expect(await zip.file('model.cellml').async('string')).toBe('<model/>')
    expect(await zip.file('protocol_model.cellml').async('string')).toBe('<model clocked/>')
    const script = await zip.file('run_protocol.py').async('string')
    expect(script).toContain("OBS_DATA = 'heart_obs_data.json'")
    expect(script).toContain('DT = 0.1  #')
    expect(script).toContain("    'a/k': 'instance_parameters/a_k',\n    # 'engine/pace': 'component/variable',")
    expect(script).toContain("    {'title': 'Peaks', 'x': {'input': 'a/k', 'subexperiment_idx': 0}, 'y': 'peak', 'series': None},")
    const readme = await zip.file('README.md').async('string')
    expect(readme.startsWith('# heart_protocol')).toBe(true)
    expect(readme).toContain('- A warning from the plan.')
    expect(notified.success).toHaveBeenCalled()
    expect(exporter.visible.value).toBe(false)
  })

  it('does nothing more when the save is cancelled, and reports a failure', async () => {
    const exporter = useProtocolExport()
    await exporter.open()
    saving.getFileHandle = vi.fn(async () => ({ success: false, cancelled: true }))
    await exporter.exportZip()
    expect(saving.saveWithDialog).not.toHaveBeenCalled()
    expect(exporter.visible.value).toBe(true)

    saving.getFileHandle = vi.fn(async () => ({ success: false, needsLegacyDialog: true, method: 'legacy' }))
    saving.saveWithDialog = vi.fn(async () => {
      throw new Error('No room.')
    })
    await exporter.exportZip()
    expect(notified.error).toHaveBeenCalledWith({ title: 'Export failed', message: 'No room.' })
    expect(exporter.isExporting.value).toBe(false)
    await settle()
  })
})
