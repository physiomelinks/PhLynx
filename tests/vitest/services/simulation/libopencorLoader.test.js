import { reactive } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { libopencor, loadLibOpenCOR, resetLibOpenCORLoader, whenLibOpenCORReady } from '../../../../src/services/simulation/libopencorLoader.js'
import { SimulationError } from '../../../../src/services/simulation/engine.js'

const ISOLATED = { crossOriginIsolated: true }
const NOT_ISOLATED = { crossOriginIsolated: false, isSecureContext: true, navigator: {} }

/**
 * Stands in for the simulator's worker: records what it is sent, and lets a test reply.
 *
 * @returns {Object}
 */
function createFakeWorker() {
  const worker = {
    sent: [],
    postMessage: vi.fn((message) => worker.sent.push(message)),
    reply: (data) => worker.onmessage({ data }),
  }
  return worker
}

describe('loadLibOpenCOR', () => {
  afterEach(() => resetLibOpenCORLoader())

  it('loads libOpenCOR in a worker from where the build serves it, and reports ready', async () => {
    const worker = createFakeWorker()

    const loading = loadLibOpenCOR({ scope: ISOLATED, createWorker: () => worker })
    expect(libopencor.status).toBe('loading')
    expect(worker.sent).toEqual([{ type: 'load', base: expect.stringMatching(/^\/libopencor\/[\d.]+\/$/) }])
    worker.reply({ type: 'ready', versionString: '1.2.3' })

    expect(await loading).toEqual({ startSimulation: expect.any(Function) })
    expect({ ...libopencor }).toEqual({ status: 'ready', reason: null, versionString: '1.2.3' })
  })

  it('loads once, however often it is asked', () => {
    const createWorker = vi.fn(createFakeWorker)
    const first = loadLibOpenCOR({ scope: ISOLATED, createWorker })

    expect(loadLibOpenCOR({ scope: ISOLATED, createWorker })).toBe(first)
    expect(whenLibOpenCORReady()).toBe(first)
    expect(createWorker).toHaveBeenCalledTimes(1)
  })

  it('reports why it can’t load in a page that isn’t isolated, without starting a worker', async () => {
    const createWorker = vi.fn(createFakeWorker)

    expect(await loadLibOpenCOR({ scope: NOT_ISOLATED, createWorker })).toBeNull()

    expect(createWorker).not.toHaveBeenCalled()
    expect(libopencor).toMatchObject({ status: 'unavailable', reason: expect.stringMatching(/service workers/) })
  })

  it('reports a failed load', async () => {
    const worker = createFakeWorker()
    const loading = loadLibOpenCOR({ scope: ISOLATED, createWorker: () => worker })
    worker.reply({ type: 'failed', message: 'Failed to fetch' })

    expect(await loading).toBeNull()
    expect({ ...libopencor }).toEqual({ status: 'error', reason: 'Failed to fetch', versionString: null })
  })

  describe('its client', () => {
    async function loadClient() {
      const worker = createFakeWorker()
      const loading = loadLibOpenCOR({ scope: ISOLATED, createWorker: () => worker })
      worker.reply({ type: 'ready', versionString: '1' })
      return { worker, client: await loading }
    }

    it('runs a simulation in the worker, passing on progress and results', async () => {
      const { worker, client } = await loadClient()
      const onProgress = vi.fn()

      const run = client.startSimulation({ cellml: '<model/>', settings: { endingPoint: 1 }, onProgress })
      const { id } = worker.sent.at(-1)
      expect(worker.sent.at(-1)).toEqual({ type: 'run', id, cellml: '<model/>', key: null, settings: { endingPoint: 1 }, changes: [], sweep: null })
      worker.reply({ type: 'progress', id, value: 0.5 })
      const values = new Float64Array([1, 2])
      worker.reply({ type: 'done', id, results: { voi: { name: 't', values }, variables: [['c/x', { kind: 'state', values }]], isStopped: false } })

      const results = await run.promise
      expect(onProgress).toHaveBeenCalledWith(0.5)
      expect(results.variables).toBeInstanceOf(Map)
      expect(results.variables.get('c/x').kind).toBe('state')
    })

    it('sends the store’s reactive settings as plain data a worker message can carry', async () => {
      const { worker, client } = await loadClient()
      const settings = reactive({ endingPoint: 1, sweep: { parameterName: 'V', from: -1, to: 1, points: 3 } })

      client.startSimulation({ key: 3, settings: { ...settings } })

      expect(() => structuredClone(worker.sent.at(-1))).not.toThrow()
      expect(worker.sent.at(-1).settings).toEqual({ endingPoint: 1, sweep: { parameterName: 'V', from: -1, to: 1, points: 3 } })
    })

    it('reruns the model the worker keeps by its key, with parameter changes', async () => {
      const { worker, client } = await loadClient()
      const changes = [{ component: 'instance_parameters', variable: 'k', value: 2 }]

      const run = client.startSimulation({ key: 3, settings: {}, changes })
      const { id } = worker.sent.at(-1)
      expect(worker.sent.at(-1)).toEqual({ type: 'run', id, cellml: null, key: 3, settings: {}, changes, sweep: null })
      worker.reply({ type: 'error', id, message: 'The model needs reading again.', issues: [], code: 'no-session' })

      expect((await run.promise.catch((reason) => reason)).code).toBe('no-session')
    })

    it('rejects a failed run with a SimulationError, and stops a run by its id', async () => {
      const { worker, client } = await loadClient()

      const run = client.startSimulation({ cellml: '<model/>', settings: {} })
      const { id } = worker.sent.at(-1)
      run.stop()
      expect(worker.sent.at(-1)).toEqual({ type: 'stop', id })
      worker.reply({ type: 'error', id, message: 'The simulation failed.', issues: [{ type: 'Error', description: 'mxstep' }] })

      const error = await run.promise.catch((reason) => reason)
      expect(error).toBeInstanceOf(SimulationError)
      expect(error.issues).toEqual([{ type: 'Error', description: 'mxstep' }])
      expect(error.partialResults).toBeNull()
    })

    it('passes on the results a failed run computed before failing', async () => {
      const { worker, client } = await loadClient()
      const run = client.startSimulation({ cellml: '<model/>', settings: {} })
      const { id } = worker.sent.at(-1)
      const values = new Float64Array([0, 1])
      worker.reply({ type: 'error', id, message: 'failed', issues: [], partialResults: { voi: { name: 't', values }, variables: [['c/x', { values }]] } })

      const error = await run.promise.catch((reason) => reason)
      expect(error.partialResults.variables.get('c/x').values).toBe(values)
    })

    it('fails every run when the worker stops working', async () => {
      const { worker, client } = await loadClient()
      const run = client.startSimulation({ cellml: '<model/>', settings: {} })

      worker.onerror({ message: 'out of memory' })

      await expect(run.promise).rejects.toThrow('out of memory')
      expect(libopencor).toMatchObject({ status: 'error', reason: 'out of memory' })
    })
  })
})
