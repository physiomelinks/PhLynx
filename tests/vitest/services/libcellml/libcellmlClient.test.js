// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const LIBCELLML = { isFake: true }

/** Test operations in place of the real registry, so the client's paths can be driven directly. */
vi.mock('../../../../src/services/libcellml/operations.js', () => {
  const operations = {
    echo: (libcellml, ...args) => ({ args, isFake: libcellml.isFake }),
    fail: () => {
      throw Object.assign(new RangeError('Out of range'), { details: ['x'], code: 'bad', callback: () => {} })
    },
  }
  return {
    operations,
    runOperation(libcellml, op, args = []) {
      if (!Object.hasOwn(operations, op)) throw new Error(`Unknown libCellML operation: ${op}`)
      return operations[op](libcellml, ...args)
    },
  }
})

/** Answers like workers/libcellmlWorker.js, cloning messages as postMessage does; or fails to start or run. */
class FakeWorker {
  static instances = []
  static failsToStart = false
  static failsOnMessage = false
  constructor(url, options) {
    if (FakeWorker.failsToStart) throw new Error('no workers here')
    this.url = String(url)
    this.options = options
    this.messages = []
    this.isTerminated = false
    FakeWorker.instances.push(this)
  }
  postMessage(message) {
    this.messages.push(structuredClone(message))
    queueMicrotask(async () => {
      if (FakeWorker.failsOnMessage) return this.onerror(new Event('error'))
      const { handleRequest } = await import('../../../../src/services/libcellml/protocol.js')
      const reply = await handleRequest(structuredClone(message), async () => LIBCELLML)
      this.onmessage({ data: structuredClone(reply) })
    })
  }
  terminate() {
    this.isTerminated = true
  }
}

describe('runLibCellML', () => {
  let runLibCellML

  /** A fresh client and utils/cellml, with the fake libCellML bound for the main-thread fallback. */
  async function loadClient() {
    vi.resetModules()
    const { initLibCellML } = await import('../../../../src/utils/cellml.js')
    initLibCellML(LIBCELLML)
    ;({ runLibCellML } = await import('../../../../src/services/libcellml/libcellmlClient.js'))
  }

  beforeEach(async () => {
    FakeWorker.instances = []
    FakeWorker.failsToStart = false
    FakeWorker.failsOnMessage = false
    vi.stubGlobal('Worker', FakeWorker)
    await loadClient()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('runs an operation in one module worker', async () => {
    const results = await Promise.all([runLibCellML('echo', 'a', { b: 1 }), runLibCellML('echo', 'c')])

    expect(results).toEqual([
      { args: ['a', { b: 1 }], isFake: true },
      { args: ['c'], isFake: true },
    ])
    expect(FakeWorker.instances).toHaveLength(1)
    const [worker] = FakeWorker.instances
    expect(worker.url).toMatch(/workers\/libcellmlWorker\.js/)
    expect(worker.options).toEqual({ type: 'module' })
    expect(worker.messages).toEqual([
      { id: 1, op: 'echo', args: ['a', { b: 1 }] },
      { id: 2, op: 'echo', args: ['c'] },
    ])
  })

  it("rejects with the worker's error, its name, message and plain-data properties restored", async () => {
    const error = await runLibCellML('fail').catch((thrown) => thrown)

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('RangeError')
    expect(error.message).toBe('Out of range')
    expect(error).toMatchObject({ details: ['x'], code: 'bad' })
    expect(error).not.toHaveProperty('callback')
  })

  it('rejects for an unknown operation', async () => {
    await expect(runLibCellML('noSuchOp')).rejects.toThrow('Unknown libCellML operation: noSuchOp')
  })

  it('runs on the main thread where there are no Workers', async () => {
    vi.stubGlobal('Worker', undefined)
    await loadClient()

    await expect(runLibCellML('echo', 1)).resolves.toEqual({ args: [1], isFake: true })
    const error = await runLibCellML('fail').catch((thrown) => thrown)
    expect(error).toBeInstanceOf(RangeError)
    expect(error.details).toEqual(['x'])
  })

  it('runs on the main thread when the worker fails to start', async () => {
    FakeWorker.failsToStart = true
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(runLibCellML('echo', 1)).resolves.toEqual({ args: [1], isFake: true })
    expect(console.warn).toHaveBeenCalledTimes(1)
    await runLibCellML('echo', 2)
    expect(console.warn).toHaveBeenCalledTimes(1) // doesn't try again
  })

  it('reruns pending requests on the main thread when the worker fails, and stops using it', async () => {
    FakeWorker.failsOnMessage = true
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const results = await Promise.all([runLibCellML('echo', 1), runLibCellML('echo', 2)])
    expect(results).toEqual([
      { args: [1], isFake: true },
      { args: [2], isFake: true },
    ])
    const [worker] = FakeWorker.instances
    expect(worker.isTerminated).toBe(true)

    await runLibCellML('echo', 3)
    expect(FakeWorker.instances).toHaveLength(1)
    expect(worker.messages).toHaveLength(2)
  })
})
