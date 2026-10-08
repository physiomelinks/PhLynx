// @vitest-environment happy-dom
import { ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const nodes = ref([])
const edges = ref([])
vi.mock('@vue-flow/core', async (importOriginal) => ({ ...(await importOriginal()), useVueFlow: () => ({ nodes, edges }) }))

const engine = vi.hoisted(() => ({ runs: [], described: [], protocolRuns: [] }))
// Stands in for the simulator's worker client, recording each run so a test can finish it.
const simulator = vi.hoisted(() => ({
  startSimulation: (options) => {
    let finish
    const promise = new Promise((resolve) => (finish = resolve))
    const run = { options, finish, stop: vi.fn(), promise }
    engine.runs.push(run)
    return run
  },
  describeModel: async (options) => {
    engine.described.push(options)
    const driven = options.cellml.includes('<!-- drivers -->')
    return {
      voi: { name: 'm/t', unit: 'second' },
      variables: new Map([
        ['a/x', { kind: 'state', unit: 'dimensionless' }],
        ['instance_parameters/k', { kind: driven ? 'algebraic' : 'constant', unit: 'dimensionless' }],
        ...(driven ? [['protocol_drivers/driver_1_selector', { kind: 'constant' }], ['protocol_drivers/driver_1_value', { kind: 'constant' }]] : []),
      ]),
    }
  },
  startProtocol: (options) => {
    let finish
    let fail
    const promise = new Promise((resolve, reject) => ([finish, fail] = [resolve, reject]))
    const run = { options, finish, fail, stop: vi.fn(), promise }
    engine.protocolRuns.push(run)
    return run
  },
}))
const loader = vi.hoisted(() => ({ module: simulator, reason: null, ready: null }))
vi.mock('../../../src/services/simulation/libopencorLoader', () => ({
  libopencor: { get reason() {
    return loader.reason
  } },
  whenLibOpenCORReady: () => loader.ready ?? Promise.resolve(loader.module),
}))


const built = vi.hoisted(() => ({ scopes: [] }))
vi.mock('../../../src/services/simulation/scopedModel', async (importOriginal) => ({
  ...(await importOriginal()),
  buildScopedModel: (scope) => {
    built.scopes.push(scope)
    return new Blob(['<model/>'])
  },
}))
vi.mock('../../../src/services/simulation/variableMapping', () => ({
  mappingKey: (nodeId, name) => `${nodeId}::${name}`,
  buildVariableMapping: () => new Map([['a::x', 'a/x'], ['a::k', 'instance_parameters/k']]),
  mapInspectionModules: () => [],
}))
vi.mock('../../../src/utils/cellml', () => ({ whenLibCellMLReady: async () => ({}) }))
const drivenModels = vi.hoisted(() => [])
vi.mock('../../../src/services/simulation/protocolDriverModel', async (importOriginal) => ({
  ...(await importOriginal()),
  addProtocolDrivers: ({ cellml, drivers }) => {
    drivenModels.push(drivers)
    return { cellml: `${cellml}<!-- drivers -->`, errors: [] }
  },
  addProtocolClock: ({ cellml }) => ({ cellml: `${cellml}<!-- clock -->`, errors: [] }),
}))

const { cancelSimulation, forgetSimulationSession, useSimulation } = await import('../../../src/composables/useSimulation.js')
const { useSimulationResultsStore } = await import('../../../src/stores/simulationResultsStore.js')
const { useSimulationSettingsStore } = await import('../../../src/stores/simulationSettingsStore.js')
const { useLibraryStore } = await import('../../../src/stores/libraryStore.js')
const { useOmexStore } = await import('../../../src/stores/omexStore.js')
const { useProtocolStore } = await import('../../../src/stores/protocolStore.js')

const ODE = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="m"><component name="m">
  <variable name="t" units="second"/><variable name="x" units="dimensionless" initial_value="1"/>
  <math xmlns="http://www.w3.org/1998/Math/MathML"><apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply><cn>1</cn></apply></math>
</component></model>`

const RESULTS = { voi: { name: 'm/t', unit: 'second', values: new Float64Array([0, 1]) }, variables: new Map(), isStopped: false }

/**
 * Creates a node on the test math.
 *
 * @param {string} id
 * @param {Array} [variables]
 * @returns {Object}
 */
const createNode = (id, variables = [{ name: 'x', type: 'variable' }]) => ({ id, data: { name: id, mathRef: 'file:m', variables, ports: [] } })

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('useSimulation', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    useLibraryStore().addMath('file:m', ODE)
    store = useSimulationResultsStore()
    nodes.value = [createNode('a'), createNode('b')]
    edges.value = []
    engine.runs = []
    engine.described = []
    engine.protocolRuns = []
    built.scopes = []
    Object.assign(loader, { module: simulator, reason: null, ready: null })
    forgetSimulationSession()
  })

  it('runs the selection with the current settings and keeps its mapped results', async () => {
    const { run } = useSimulation()

    const done = run(['a'])
    await settle()
    expect(store.status).toBe('running')
    expect(engine.runs[0].options.settings).toEqual(useSimulationSettingsStore().simulationSettings)

    engine.runs[0].options.onProgress(0.5)
    expect(store.progress).toBe(0.5)
    engine.runs[0].finish(RESULTS)
    await done

    expect(store.status).toBe('done')
    expect(store.scopeNodeIds).toEqual(['a'])
    expect(store.results).toBe(RESULTS)
    expect(store.mapping.get('a::x')).toBe('a/x')
  })

  it('stops before running when the pre-flight finds errors', async () => {
    nodes.value = [createNode('a', [{ name: 'k', type: 'constant', value: '' }])]
    const { run } = useSimulation()

    await run(['a'])

    expect(store.status).toBe('blocked')
    expect(store.report.errors).toEqual(['"a.k" needs a value.'])
    expect(engine.runs).toHaveLength(0)
  })

  it('reports a simulator that couldn’t load', async () => {
    Object.assign(loader, { module: null, reason: 'This browser window doesn’t allow service workers.' })
    const { run } = useSimulation()

    await run(null)

    expect(store.status).toBe('error')
    expect(store.error.message).toMatch(/service workers/)
  })

  it('stops a run superseded by another, and ignores its results', async () => {
    const { run } = useSimulation()

    const first = run(['a'])
    await settle()
    const second = run(['b'])
    await settle()
    expect(engine.runs[0].stop).toHaveBeenCalled()

    engine.runs[0].finish({ ...RESULTS, isStopped: true })
    await first
    expect(store.status).toBe('running')

    engine.runs[1].finish(RESULTS)
    await second
    expect(store.scopeNodeIds).toEqual(['b'])
    expect(store.status).toBe('done')
  })

  /** Holds the simulator back until `release` is called, as while it downloads. */
  function holdSimulator() {
    let release
    loader.ready = new Promise((resolve) => (release = () => resolve(loader.module)))
    return () => release()
  }

  it('abandons a run stopped while the simulator is still loading', async () => {
    const release = holdSimulator()
    const { run, stop } = useSimulation()

    const done = run(['a'])
    await settle()
    stop()
    expect(store.status).toBe('idle')
    release()
    await done

    expect(engine.runs).toHaveLength(0)
    expect(store.status).toBe('idle')
  })

  it('starts only the newer of two runs begun while the simulator loads', async () => {
    const release = holdSimulator()
    const { run } = useSimulation()

    const first = run(['a'])
    const second = run(['b'])
    release()
    await settle()

    expect(engine.runs).toHaveLength(1)
    engine.runs[0].finish(RESULTS)
    await Promise.all([first, second])
    expect(store.scopeNodeIds).toEqual(['b'])
  })

  it('ignores a run abandoned when the workspace is cleared', async () => {
    const { run } = useSimulation()
    const done = run(['a'])
    await settle()

    cancelSimulation()
    store.resetState()
    engine.runs[0].finish(RESULTS)
    await done

    expect(engine.runs[0].stop).toHaveBeenCalled()
    expect(store.status).toBe('idle')
    expect(store.results).toBeNull()
  })

  it('builds each run with the sliders’ values, and tells when a slider has moved since', async () => {
    nodes.value = [createNode('a', [{ name: 'x', type: 'variable' }, { name: 'k', type: 'constant', value: '1' }])]
    useSimulationSettingsStore().setParameterScanConfig({
      selections: [{ key: 'a::k', nodeId: 'a', nodeName: 'a', parameterName: 'k', type: 'constant', min: 0, default: 1, max: 2 }],
    })
    store.setSliderValue('a::k', 1.5)
    const { run, isStale, keepCurrent } = useSimulation()

    const done = run(['a'])
    await settle()
    engine.runs[0].finish(RESULTS)
    await done

    expect(built.scopes[0].nodes[0].data.variables.find((row) => row.name === 'k').value).toBe('1.5')
    expect(nodes.value[0].data.variables.find((row) => row.name === 'k').value).toBe('1')
    expect(isStale.value).toBe(false)

    store.setSliderValue('a::k', 1.8)
    expect(isStale.value).toBe(true)
    store.setSliderValue('a::k', 1.5)
    expect(isStale.value).toBe(false)

    // Applying the value to the model and dropping the slider value leaves the results true.
    keepCurrent(() => {
      nodes.value = [createNode('a', [{ name: 'x', type: 'variable' }, { name: 'k', type: 'constant', value: '1.5' }])]
      store.setSliderValue('a::k', null)
    })
    expect(isStale.value).toBe(false)

    // Results already stale stay stale through such a change.
    useSimulationSettingsStore().setSimulationSettings({ endingPoint: 5 })
    keepCurrent(() => store.setSliderValue('a::k', null))
    expect(isStale.value).toBe(true)
  })

  it('keeps showing a scope’s results while it reruns, and clears them when a run fails', async () => {
    const { run } = useSimulation()
    const first = run(['a'])
    await settle()
    engine.runs[0].finish(RESULTS)
    await first

    const rerun = run(['a'])
    await settle()
    expect(store.status).toBe('running')
    expect(store.results).toBe(RESULTS)

    engine.runs[1].finish(Promise.reject(Object.assign(new Error('The simulation failed.'), { issues: [] })))
    await rerun
    expect(store.status).toBe('error')
    expect(store.results).toBeNull()

    // A run that failed part-way keeps what it computed, mapped like finished results.
    const partial = { ...RESULTS, voi: { ...RESULTS.voi, values: new Float64Array([0]) } }
    const failing = run(['a'])
    await settle()
    engine.runs[2].finish(Promise.reject(Object.assign(new Error('The simulation failed.'), { issues: [], partialResults: partial })))
    await failing
    expect(store.status).toBe('error')
    expect(store.results).toBe(partial)
    expect(store.mapping.get('a::x')).toBe('a/x')
  })

  describe('reruns of the model the simulator keeps', () => {
    const K = { name: 'k', type: 'constant', value: '2' }
    const KEPT = { ...RESULTS, variables: new Map([['instance_parameters/k', { kind: 'constant', values: new Float64Array([2, 2]) }]]) }

    /**
     * Runs scope ['a'] once, flattening it.
     *
     * @returns {Promise<Function>} useSimulation's run.
     */
    async function runOnce() {
      nodes.value = [createNode('a', [{ name: 'x', type: 'variable' }, K])]
      useSimulationSettingsStore().setParameterScanConfig({
        selections: [{ key: 'a::k', nodeId: 'a', nodeName: 'a', parameterName: 'k', type: 'constant', min: 1, max: 3 }],
      })
      const { run } = useSimulation()
      const first = run(['a'])
      await settle()
      engine.runs[0].finish(KEPT)
      await first
      return run
    }

    it('reruns with a slider’s value as a change, without flattening again', async () => {
      const run = await runOnce()
      expect(engine.runs[0].options.cellml).toBe('<model/>')

      store.setSliderValue('a::k', 2.5)
      const rerun = run(['a'])
      await settle()
      expect(built.scopes).toHaveLength(1)
      expect(engine.runs[1].options.cellml).toBeUndefined()
      expect(engine.runs[1].options.key).toBe(engine.runs[0].options.key)
      expect(engine.runs[1].options.changes).toEqual([{ component: 'instance_parameters', variable: 'k', value: 2.5 }])
      engine.runs[1].finish(KEPT)
      await rerun
      expect(store.status).toBe('done')
      expect(store.mapping.get('a::x')).toBe('a/x')
    })

    it('puts back the model’s value for a slider flattened in but since reset', async () => {
      useSimulationResultsStore().setSliderValue('a::k', 2.5)
      const run = await runOnce()
      expect(built.scopes[0].nodes[0].data.variables.find((row) => row.name === 'k').value).toBe('2.5')

      store.setSliderValue('a::k', null)
      run(['a'])
      await settle()
      expect(engine.runs[1].options.changes).toEqual([{ component: 'instance_parameters', variable: 'k', value: 2 }])
    })

    it('flattens again once the model changes, or when the worker lost it', async () => {
      const run = await runOnce()
      nodes.value = [createNode('a', [{ name: 'x', type: 'variable' }, { ...K, value: '3' }])]
      const edited = run(['a'])
      await settle()
      expect(engine.runs[1].options.cellml).toBe('<model/>')
      engine.runs[1].finish(KEPT)
      await edited

      const lost = run(['a'])
      await settle()
      engine.runs[2].finish(Promise.reject(Object.assign(new Error('The model needs reading again.'), { issues: [], code: 'no-session' })))
      await lost
      run(['a'])
      await settle()
      expect(engine.runs[3].options.cellml).toBe('<model/>')
    })
  })

  it('tells when the scope or the settings change after a run', async () => {
    const { run, isStale } = useSimulation()
    const done = run(['a'])
    await settle()
    engine.runs[0].finish(RESULTS)
    await done
    expect(isStale.value).toBe(false)

    nodes.value = [createNode('a'), { ...createNode('b'), data: { ...createNode('b').data, name: 'renamed' } }]
    expect(isStale.value).toBe(false)

    useSimulationSettingsStore().setSimulationSettings({ endingPoint: 5 })
    expect(isStale.value).toBe(true)
  })

  describe('with a protocol', () => {
    const PROTOCOL = { pre_times: [0, 0], sim_times: [[1], [1]], params_to_change: { 'a/k': [[2], [3]] }, experiment_labels: ['low', 'high'] }

    /**
     * Gives the workspace an obs_data file with a protocol, and turns the protocol on.
     *
     * @param {Object} protocolInfo
     */
    function useProtocol(protocolInfo) {
      const payload = new TextEncoder().encode(JSON.stringify({ protocol_info: protocolInfo, data_items: [] })).buffer
      useOmexStore().setArchive({ extras: [{ location: 'model_obs_data.json', format: 'application/json', payload }] })
      useProtocolStore().isProtocolMode = true
    }

    /**
     * Gives an experiment's results.
     *
     * @param {number} k
     * @returns {Object}
     */
    const experiment = (k) => ({
      voi: { name: 'm/t', unit: 'second', values: new Float64Array([0, 1]) },
      variables: new Map([['instance_parameters/k', { kind: 'constant', unit: 'dimensionless', values: new Float64Array([k, k]) }]]),
      subs: [{ startIndex: 0, endIndex: 1 }],
    })
    const PROTOCOL_RESULTS = { experiments: [experiment(2), experiment(3)], issues: [], elapsedMs: 2, isStopped: false }

    beforeEach(() => {
      nodes.value = [createNode('a', [{ name: 'x', type: 'variable' }, { name: 'k', type: 'constant', value: '1' }])]
    })

    it("reads the model, finds the protocol's parameters in it, and runs each experiment", async () => {
      useProtocol(PROTOCOL)
      const { run } = useSimulation()

      const done = run(null)
      await settle()
      expect(engine.runs).toEqual([])
      expect(engine.described).toEqual([{ cellml: '<model/>', key: expect.any(Number) }])
      const [{ options }] = engine.protocolRuns
      expect(options.key).toBe(engine.described[0].key)
      expect(options.targets).toEqual(new Map([['a/k', 'instance_parameters/k']]))
      expect(options.baseChanges).toEqual([])
      expect(options.plan.experiments.map(({ segments }) => segments[0].values)).toEqual([[{ parameter: 'a/k', value: 2 }], [{ parameter: 'a/k', value: 3 }]])

      engine.protocolRuns[0].finish(PROTOCOL_RESULTS)
      await done
      expect(store.status).toBe('done')
      expect(store.protocolResults).toBe(PROTOCOL_RESULTS)
      expect(store.results.variables.get('instance_parameters/k').values[0]).toBe(2)
      store.showExperiment(1)
      expect(store.results.variables.get('instance_parameters/k').values[0]).toBe(3)
    })

    it('reruns the model it read, without reading it again', async () => {
      useProtocol(PROTOCOL)
      const { run } = useSimulation()
      const first = run(null)
      await settle()
      engine.protocolRuns[0].finish(PROTOCOL_RESULTS)
      await first

      const second = run(null)
      await settle()
      expect(engine.described).toHaveLength(1)
      expect(engine.protocolRuns[1].options).toMatchObject({ key: engine.described[0].key, baseChanges: [] })
      engine.protocolRuns[1].finish(PROTOCOL_RESULTS)
      await second
    })

    it("stops before running a protocol whose parameters the model doesn't have", async () => {
      useProtocol({ ...PROTOCOL, params_to_change: { 'b/k': [[2], [3]] } })
      const { run } = useSimulation()

      await run(null)

      expect(store.status).toBe('blocked')
      expect(store.report.errors).toEqual(["The protocol sets b/k, which isn't in the model being simulated."])
      expect(engine.protocolRuns).toEqual([])
    })

    it("stops before reading the model when the protocol isn't valid", async () => {
      useProtocol({ ...PROTOCOL, unknown: 1 })
      const { run } = useSimulation()

      await run(null)

      expect(store.status).toBe('blocked')
      expect(store.report.errors).toEqual(["Unknown protocol_info keys not in schema: ['unknown']"])
      expect(engine.described).toEqual([])
    })

    it('keeps the experiments run before a failure', async () => {
      useProtocol(PROTOCOL)
      const { run } = useSimulation()
      const done = run(null)
      await settle()
      const failure = Object.assign(new Error('Experiment 2: The simulation failed.'), { issues: [], partialResults: { experiments: [experiment(2)] } })
      engine.protocolRuns[0].fail(failure)
      await done

      expect(store.status).toBe('error')
      expect(store.error.message).toBe('Experiment 2: The simulation failed.')
      expect(store.protocolResults.experiments).toHaveLength(1)
      expect(store.results.variables.get('instance_parameters/k').values[0]).toBe(2)
    })

    it('writes a ramp into the model as a driver, and sets its selector and number in each sub-experiment', async () => {
      useProtocol({
        ...PROTOCOL,
        params_to_change: { 'a/k': [['up'], [3]] },
        protocol_shapes: { up: { type: 'ramp', from: 0, to: 1 } },
      })
      useSimulationSettingsStore().setSimulationSettings({ solver: 'CVODE', timeStep: 0 })
      const { run } = useSimulation()

      const done = run(null)
      await settle()
      expect(drivenModels.at(-1).map(({ parameter }) => parameter)).toEqual(['a/k'])
      expect(engine.described[0].cellml).toContain('<!-- drivers -->')
      const [{ options }] = engine.protocolRuns
      expect(options.targets).toEqual(
        new Map([
          ['protocol_drivers/driver_1_selector', 'protocol_drivers/driver_1_selector'],
          ['protocol_drivers/driver_1_value', 'protocol_drivers/driver_1_value'],
        ])
      )
      expect(options.plan.experiments.map(({ segments }) => segments.map(({ values }) => values.map(({ value }) => value)))).toEqual([[[1, 0]], [[0, 3]]])
      // CVODE mustn't step past the ramp, which lasts the sub-experiment.
      expect(options.settings.timeStep).toBe(1)
      engine.protocolRuns[0].finish(PROTOCOL_RESULTS)
      await done
    })

    it("runs the model as it is, without the sliders' values, and keeps them for the time course", async () => {
      useSimulationSettingsStore().setParameterScanConfig({
        selections: [{ key: 'a::k', nodeId: 'a', nodeName: 'a', parameterName: 'k', type: 'constant', min: 0, max: 4 }],
      })
      store.setSliderValue('a::k', 1.5)
      useProtocol(PROTOCOL)
      const { run, isStale } = useSimulation()

      const done = run(null)
      await settle()
      expect(built.scopes[0].nodes[0].data.variables.find((row) => row.name === 'k').value).toBe('1')
      expect(engine.protocolRuns[0].options.baseChanges).toEqual([])
      engine.protocolRuns[0].finish(PROTOCOL_RESULTS)
      await done

      // A slider moving doesn't touch the protocol's results.
      store.setSliderValue('a::k', 1.8)
      expect(isStale.value).toBe(false)

      useProtocolStore().isProtocolMode = false
      expect(store.sliderValues.get('a::k')).toBe(1.8)
      run(null)
      await settle()
      expect(engine.runs[0].options.changes).toEqual([{ component: 'instance_parameters', variable: 'k', value: 1.8 }])
    })

    it("puts back the model's values a time course flattened sliders' values over", async () => {
      useSimulationSettingsStore().setParameterScanConfig({
        selections: [{ key: 'a::k', nodeId: 'a', nodeName: 'a', parameterName: 'k', type: 'constant', min: 0, max: 4 }],
      })
      store.setSliderValue('a::k', 2.5)
      const { run } = useSimulation()
      const first = run(null)
      await settle()
      engine.runs[0].finish({ ...RESULTS, variables: new Map([['instance_parameters/k', { kind: 'constant', values: new Float64Array([2.5, 2.5]) }]]) })
      await first

      useProtocol(PROTOCOL)
      run(null)
      await settle()
      expect(engine.described).toEqual([])
      expect(engine.protocolRuns[0].options.baseChanges).toEqual([{ component: 'instance_parameters', variable: 'k', value: 1 }])
    })

    describe('prepareProtocolExport', () => {
      // Earlier tests leave runs going.
      beforeEach(() => cancelSimulation())

      it('flattens the model as a protocol run does, with its drivers and clock, and plans the run on it', async () => {
        useProtocol({ ...PROTOCOL, params_to_change: { 'a/k': [['up'], [3]] }, protocol_shapes: { up: { type: 'ramp', from: 0, to: 1 } } })
        const { prepareProtocolExport } = useSimulation()

        const prepared = await prepareProtocolExport({ nodeIds: null })

        expect(prepared.errors).toEqual([])
        expect(prepared.cellml).toBe('<model/><!-- drivers --><!-- clock -->')
        expect(engine.described).toEqual([{ cellml: prepared.cellml, key: expect.any(Number) }])
        expect(engine.protocolRuns).toEqual([])
        expect(prepared.targets).toEqual(
          new Map([
            ['protocol_drivers/driver_1_selector', 'protocol_drivers/driver_1_selector'],
            ['protocol_drivers/driver_1_value', 'protocol_drivers/driver_1_value'],
          ])
        )
        expect(prepared.drivers).toBe(drivenModels.at(-1))
        expect(prepared.drivers).toHaveLength(1)
        expect(prepared.plan.experiments).toHaveLength(2)
        expect(prepared.variables.get('a/x')).toEqual({ kind: 'state', unit: 'dimensionless' })
        expect(prepared.voi).toEqual({ name: 'm/t', unit: 'second' })
        expect(prepared.mapping.get('a::x')).toBe('a/x')
        expect(prepared.scopeNodeIds).toBeNull()
        expect(prepared.settings).toMatchObject({ pointInterval: expect.any(Number) })
      })

      it('exports the last run’s scope by default', async () => {
        useProtocol(PROTOCOL)
        nodes.value = [createNode('a', [{ name: 'x', type: 'variable' }, { name: 'k', type: 'constant', value: '1' }]), createNode('b')]
        const { run, prepareProtocolExport } = useSimulation()
        const done = run(['a'])
        await settle()
        engine.protocolRuns[0].finish(PROTOCOL_RESULTS)
        await done

        const prepared = await prepareProtocolExport()

        expect(prepared.scopeNodeIds).toEqual(['a'])
        expect(built.scopes.at(-1).nodes.map(({ id }) => id)).toEqual(['a'])
      })

      it('forgets the model the worker kept, so the next run reads its model again', async () => {
        useProtocol(PROTOCOL)
        const { run, prepareProtocolExport } = useSimulation()
        const first = run(null)
        await settle()
        engine.protocolRuns[0].finish(PROTOCOL_RESULTS)
        await first

        await prepareProtocolExport()
        const second = run(null)
        await settle()

        expect(engine.described).toHaveLength(3)
        expect(engine.protocolRuns[1].options.key).toBe(engine.described[2].key)
        engine.protocolRuns[1].finish(PROTOCOL_RESULTS)
        await second
      })

      it('refuses while a run is going', async () => {
        useProtocol(PROTOCOL)
        const { run, prepareProtocolExport } = useSimulation()
        run(null)
        await settle()

        const prepared = await prepareProtocolExport()

        expect(prepared.errors).toEqual(['Wait for the run to finish, or stop it, before exporting the protocol.'])
        expect(engine.described).toHaveLength(1)
        cancelSimulation()
      })

      it("stops before reading the model when the protocol isn't valid", async () => {
        useProtocol({ ...PROTOCOL, unknown: 1 })
        const { prepareProtocolExport } = useSimulation()

        const prepared = await prepareProtocolExport()

        expect(prepared.errors).toEqual(["Unknown protocol_info keys not in schema: ['unknown']"])
        expect(prepared.plan).toBeUndefined()
        expect(engine.described).toEqual([])
      })

      it("reports the protocol's parameters the model doesn't have", async () => {
        useProtocol({ ...PROTOCOL, params_to_change: { 'b/k': [[2], [3]] } })
        const { prepareProtocolExport } = useSimulation()

        const prepared = await prepareProtocolExport()

        expect(prepared.errors).toEqual(["The protocol sets b/k, which isn't in the model being simulated."])
      })
    })

    it('tells the results are out of date once the protocol is turned off', async () => {
      useProtocol(PROTOCOL)
      const { run, isStale } = useSimulation()
      const done = run(null)
      await settle()
      engine.protocolRuns[0].finish(PROTOCOL_RESULTS)
      await done
      expect(isStale.value).toBe(false)

      useProtocolStore().isProtocolMode = false
      expect(isStale.value).toBe(true)
    })
  })
})
