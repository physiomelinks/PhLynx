// @vitest-environment happy-dom
import JSZip from 'jszip'
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const nodes = ref([])
vi.mock('@vue-flow/core', async (importOriginal) => ({ ...(await importOriginal()), useVueFlow: () => ({ nodes }) }))

const simulation = vi.hoisted(() => ({ prepareProtocolExport: null, prepareRunExport: null }))
vi.mock('../../../src/composables/useSimulation', () => ({
  useSimulation: () => ({
    prepareProtocolExport: (...args) => simulation.prepareProtocolExport(...args),
    prepareRunExport: (...args) => simulation.prepareRunExport(...args),
  }),
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

const { useSedmlExport } = await import('../../../src/composables/useSedmlExport.js')
const { ALL_EXPERIMENTS, useProtocolStore } = await import('../../../src/stores/protocolStore.js')
const { useSessionMetadataStore } = await import('../../../src/stores/sessionMetadataStore.js')
const { useSimulationResultsStore } = await import('../../../src/stores/simulationResultsStore.js')
const { useSimulationSettingsStore } = await import('../../../src/stores/simulationSettingsStore.js')

const OBS_DATA = {
  protocol_info: {
    pre_times: [0, 0],
    sim_times: [
      [1, 1],
      [1, 1],
    ],
    params_to_change: { 'a/k': [[2, 0], [3, 0]] },
    experiment_labels: ['low', 'high'],
  },
}

/**
 * Gives what prepareProtocolExport gives for node `a`, its k kept in instance_parameters.
 *
 * @param {Object} [overrides]
 * @returns {Object}
 */
const createPrepared = (overrides = {}) => ({
  errors: [],
  settings: { solver: 'CVODE', tolerance: 1e-7, maxSteps: 500, timeStep: 0.01, pointInterval: 0.1 },
  mapping: new Map([
    ['a::x', 'a/x'],
    ['a::t', 'm/t'],
    ['a::k', 'instance_parameters/a_k'],
  ]),
  variables: new Map([
    ['a/x', { kind: 'state', unit: 'mV' }],
    ['instance_parameters/a_k', { kind: 'constant', unit: 'dimensionless' }],
    ['protocol_clock/experiment_time', { kind: 'algebraic', unit: 'second' }],
  ]),
  voi: { name: 'm/t', unit: 'second' },
  sedml: {
    cellml: '<model clocked/>',
    plan: { experiments: [{}, {}] },
    targets: new Map([['a/k', 'instance_parameters/a_k']]),
    inputs: new Map([['a/k', { name: 'instance_parameters/a_k', isStepped: true }]]),
  },
  ...overrides,
})

const node = (id, variables) => ({ id, data: { name: id, variables } })

describe('useSedmlExport', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    useProtocolStore().saveDocument(OBS_DATA)
    // With the protocol on, its run is exported.
    useProtocolStore().isProtocolMode = true
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
    vi.clearAllMocks()
    simulation.prepareProtocolExport = vi.fn(async () => createPrepared())
    saving.order = []
    saving.getFileHandle = vi.fn(async (baseName) => {
      saving.order.push('pick')
      return { success: true, handle: { name: `${baseName}.zip` }, cleanName: baseName, method: 'system' }
    })
    saving.saveWithDialog = vi.fn(async () => ({ success: true }))
    builder.buildProtocolSedml = vi.fn(() => {
      saving.order.push('build')
      return '<sedML/>'
    })
  })

  it('asks where to save first, then saves the SED-ML of the results view with the model it runs', async () => {
    useSessionMetadataStore().setLastSaveName('heart.json')
    const protocolStore = useProtocolStore()
    protocolStore.setActiveExperiment(ALL_EXPERIMENTS)
    protocolStore.isShowingInputs = true
    const exporter = useSedmlExport()
    expect(exporter.reason.value).toBeNull()

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
      // Time is the axis, not a trace.
      traces: [{ name: 'a/x', label: 'a/x', unit: 'mV', groupId: 'plot-1' }],
      inputs: [{ name: 'instance_parameters/a_k', label: 'a/k', unit: 'dimensionless' }],
      overlay: true,
    })
    const [[blob, handle, stem, extension]] = saving.saveWithDialog.mock.calls
    expect([handle, stem, extension]).toEqual([{ name: 'heart_protocol.zip' }, 'heart_protocol', '.zip'])
    const zip = await JSZip.loadAsync(await blob.arrayBuffer())
    expect(Object.keys(zip.files).sort()).toEqual(['manifest.xml', 'protocol.sedml', 'protocol_model.cellml'])
    expect(await zip.file('protocol_model.cellml').async('string')).toBe('<model clocked/>')
    expect(notified.success).toHaveBeenCalled()
  })

  it("saves nothing when PhLynx can't plan the run, says why, and stays disabled until the protocol changes", async () => {
    simulation.prepareProtocolExport = vi.fn(async () => createPrepared({ errors: ["The protocol sets b/q, which isn't in the model being simulated."] }))
    const exporter = useSedmlExport()
    await exporter.exportZip()

    expect(saving.saveWithDialog).not.toHaveBeenCalled()
    const reason = "PhLynx can’t plan the run: The protocol sets b/q, which isn't in the model being simulated."
    expect(notified.error).toHaveBeenCalledWith({ title: 'Export failed', message: reason })
    expect(exporter.reason.value).toBe(reason)
    expect(exporter.canExport.value).toBe(false)

    useProtocolStore().saveDocument({ ...OBS_DATA, protocol_info: { ...OBS_DATA.protocol_info, experiment_labels: ['a', 'b'] } })
    await Promise.resolve()
    expect(exporter.reason.value).toBeNull()
  })

  it("says why the builder refused, as a run PhLynx can't plan", async () => {
    builder.buildProtocolSedml = vi.fn(() => {
      throw new Error('No variable.')
    })
    const exporter = useSedmlExport()
    await exporter.exportZip()
    expect(saving.saveWithDialog).not.toHaveBeenCalled()
    expect(exporter.reason.value).toBe('PhLynx can’t plan the run: No variable.')
  })

  it("is disabled, with why, mid-run, while the protocol has errors, and when the last run couldn't be planned", () => {
    const exporter = useSedmlExport()
    const resultsStore = useSimulationResultsStore()
    resultsStore.startRun(null)
    expect(exporter.reason.value).toBe('Export the run as SED-ML once it finishes')
    expect(exporter.canExport.value).toBe(false)

    resultsStore.report = { errors: ['The plan has 2001 segments.'], warnings: [] }
    resultsStore.failRun('blocked')
    expect(exporter.reason.value).toBe('PhLynx can’t plan the run: The plan has 2001 segments.')

    useProtocolStore().saveDocument({ protocol_info: { ...OBS_DATA.protocol_info, unknown: 1 } })
    expect(exporter.reason.value).toBe('Fix the protocol’s errors to export its run as SED-ML')
  })

  it('does nothing more when the save is cancelled, and reports a failure', async () => {
    const exporter = useSedmlExport()
    saving.getFileHandle = vi.fn(async () => ({ success: false, cancelled: true }))
    await exporter.exportZip()
    expect(simulation.prepareProtocolExport).not.toHaveBeenCalled()

    saving.getFileHandle = vi.fn(async () => ({ success: false, needsLegacyDialog: true, method: 'legacy' }))
    saving.saveWithDialog = vi.fn(async () => {
      throw new Error('No room.')
    })
    await exporter.exportZip()
    expect(notified.error).toHaveBeenCalledWith({ title: 'Export failed', message: 'No room.' })
    expect(exporter.isExporting.value).toBe(false)
  })

  describe('without the protocol on', () => {
    /**
     * Gives what prepareRunExport gives for node `a`.
     *
     * @param {Object} [overrides]
     * @returns {Object}
     */
    const createRun = (overrides = {}) => ({
      errors: [],
      settings: { solver: 'CVODE', tolerance: 1e-7, maxSteps: 500, timeStep: 0.01, initialPoint: 0, startingPoint: 0, endingPoint: 1, pointInterval: 0.1 },
      mapping: new Map([
        ['a::x', 'a/x'],
        ['a::t', 'm/t'],
        ['a::y', 'a/y'],
      ]),
      variables: new Map([
        ['a/x', { kind: 'state', unit: 'mV' }],
        ['a/y', { kind: 'state', unit: 'mA' }],
      ]),
      voi: { name: 'm/t', unit: 'second' },
      isSteadyState: false,
      cellml: '<model sliders/>',
      ...overrides,
    })

    beforeEach(() => {
      useProtocolStore().isProtocolMode = false
      simulation.prepareRunExport = vi.fn(async () => createRun())
    })

    it('saves the time course’s SED-ML, with the results view’s plots and the model it runs', async () => {
      useSessionMetadataStore().setLastSaveName('heart.json')
      nodes.value = [
        node('a', [
          { name: 'x', type: 'variable', units: 'mV' },
          { name: 'y', type: 'variable', units: 'mA' },
          { name: 't', type: 'variable', units: 'second' },
        ]),
      ]
      // A plot of y against x, as a phase plot is.
      useSimulationSettingsStore().setPlotConfig({
        groups: [
          { id: 'plot-1', name: 'Voltage' },
          { id: 'plot-2', name: 'Phase', xAxis: { key: 'a::x', nodeId: 'a', nodeName: 'a', variableName: 'x', units: 'mV' } },
        ],
        selections: [
          { key: 'a::x', nodeId: 'a', nodeName: 'a', variableName: 'x', groupId: 'plot-1' },
          { key: 'a::y', nodeId: 'a', nodeName: 'a', variableName: 'y', groupId: 'plot-2' },
        ],
      })
      const exporter = useSedmlExport()
      expect(exporter.isProtocol.value).toBe(false)
      expect(exporter.reason.value).toBeNull()

      const exporting = exporter.exportZip()
      expect(saving.getFileHandle).toHaveBeenCalledWith('heart_simulation', expect.any(Array), '.zip')
      await exporting

      expect(simulation.prepareProtocolExport).not.toHaveBeenCalled()
      // The whole model, as the page's play runs it, whatever the sidebar ran last.
      expect(simulation.prepareRunExport).toHaveBeenCalledWith({ nodeIds: null })
      expect(builder.buildProtocolSedml).not.toHaveBeenCalled()
      const [[blob, , stem]] = saving.saveWithDialog.mock.calls
      expect(stem).toBe('heart_simulation')
      const zip = await JSZip.loadAsync(await blob.arrayBuffer())
      expect(Object.keys(zip.files).sort()).toEqual(['manifest.xml', 'model.cellml', 'simulation.sedml'])
      expect(await zip.file('model.cellml').async('string')).toBe('<model sliders/>')
      const sedml = await zip.file('simulation.sedml').async('string')
      expect(sedml).toContain('<uniformTimeCourse id="sim" initialTime="0" outputStartTime="0" outputEndTime="1" numberOfSteps="10">')
      expect(sedml).toContain('<plot2D id="plot0" name="Voltage" legend="true">')
      expect(sedml).toContain('<xAxis type="linear" name="m/t (second)"/>')
      // The phase plot is against x.
      expect(sedml).toContain('<plot2D id="plot1" name="Phase" legend="true">')
      expect(sedml).toContain('<xAxis type="linear" name="a/x (mV)"/>')
      expect(sedml).toContain('<yAxis type="linear" name="a/y (mA)"/>')
      expect(notified.success).toHaveBeenCalledWith(expect.objectContaining({ message: 'The run exported as SED-ML.' }))
    })

    it('plots an inspection module’s output, and against it, by the name the run reports it by', async () => {
      const output = { id: 'im1', name: 'ratio', units: 'dimensionless', reportedName: 'inspection_modules/ratio' }
      simulation.prepareRunExport = vi.fn(async () =>
        createRun({
          inspectionOutputs: [output],
          variables: new Map([
            ['a/x', { kind: 'state', unit: 'mV' }],
            ['inspection_modules/ratio', { kind: 'algebraic', unit: 'dimensionless' }],
          ]),
        })
      )
      const reference = { key: 'inspection::im1', nodeId: 'inspection:im1', nodeName: 'inspection_modules', variableName: 'ratio', units: 'dimensionless' }
      useSimulationSettingsStore().setPlotConfig({
        groups: [{ id: 'plot-1', name: 'Against the ratio', xAxis: reference }],
        selections: [
          { key: 'a::x', nodeId: 'a', nodeName: 'a', variableName: 'x', groupId: 'plot-1' },
          { ...reference, groupId: 'plot-1' },
        ],
      })
      await useSedmlExport().exportZip()

      const [[blob]] = saving.saveWithDialog.mock.calls
      const sedml = await (await JSZip.loadAsync(await blob.arrayBuffer())).file('simulation.sedml').async('string')
      expect(sedml).toContain('<xAxis type="linear" name="inspection_modules/ratio (dimensionless)"/>')
      expect(sedml).toContain("cellml:variable[@name='ratio']")
      expect(sedml).toContain('name="inspection_modules/ratio"')
    })

    it('plots a boundary condition and its owner from one data generator, and a constant', async () => {
      simulation.prepareRunExport = vi.fn(async () =>
        createRun({
          mapping: new Map([
            ['a::x', 'a/x'],
            ['b::x', 'a/x'],
            ['b::k', 'instance_parameters/b_k'],
          ]),
          variables: new Map([
            ['a/x', { kind: 'state', unit: 'mV' }],
            ['instance_parameters/b_k', { kind: 'constant', unit: 'dimensionless' }],
          ]),
        })
      )
      nodes.value = [
        node('a', [{ name: 'x', type: 'variable', units: 'mV' }]),
        node('b', [
          { name: 'x', type: 'boundary_condition', units: 'mV' },
          { name: 'k', type: 'constant', units: 'dimensionless' },
        ]),
      ]
      const selectionOf = (nodeId, variableName, type, groupId) => ({ key: `${nodeId}::${variableName}`, nodeId, nodeName: nodeId, variableName, type, groupId })
      useSimulationSettingsStore().setPlotConfig({
        groups: [
          { id: 'plot-1', name: 'Voltage' },
          { id: 'plot-2', name: 'Inputs' },
        ],
        selections: [
          selectionOf('a', 'x', 'variable', 'plot-1'),
          selectionOf('b', 'x', 'boundary_condition', 'plot-1'),
          selectionOf('b', 'x', 'boundary_condition', 'plot-2'),
          selectionOf('b', 'k', 'constant', 'plot-2'),
        ],
      })
      await useSedmlExport().exportZip()

      const [[blob]] = saving.saveWithDialog.mock.calls
      const sedml = await (await JSZip.loadAsync(await blob.arrayBuffer())).file('simulation.sedml').async('string')
      const ids = [...sedml.matchAll(/<dataGenerator id="([^"]+)"/g)].map(([, id]) => id)
      expect(new Set(ids).size).toBe(ids.length)
      expect(sedml.match(/<dataGenerator [^>]*name="a\/x"/g)).toHaveLength(1)
      expect(sedml).toContain("cellml:variable[@name='b_k']")
      // Once per plot: the owner's series on Voltage, and on Inputs under the boundary condition's name.
      expect(sedml.match(/<curve /g)).toHaveLength(3)
    })

    it('is disabled, with why, in sweep mode and without instances', () => {
      const exporter = useSedmlExport()
      const resultsStore = useSimulationResultsStore()
      useSimulationSettingsStore().simulationSettings.sweep = { component: 'a', variable: 'k', from: 0, to: 1, count: 3 }
      resultsStore.isSweepMode = true
      expect(exporter.reason.value).toBe('A sweep can’t be exported as SED-ML yet: switch back to the time course to export it')
      resultsStore.isSweepMode = false
      expect(exporter.reason.value).toBeNull()
      nodes.value = []
      expect(exporter.reason.value).toBe('Add instances to export their run as SED-ML')
    })
  })
})
