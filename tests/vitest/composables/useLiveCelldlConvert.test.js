import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, ref } from 'vue'
import { createConversionWorker } from '@physiomelinks/bg2cellml/worker'

import { createLiveCelldlConvert } from '../../../src/composables/useLiveCelldlConvert.js'

const FRAMEWORK = { ontology: '@prefix bgf: <x#> .', templates: {} }

/** Stands in for the worker script: it records requests and answers them when the test says. */
function fakePort() {
  const listeners = { message: [], error: [] }
  const port = {
    requests: [],
    terminated: false,
    postMessage(message) {
      port.requests.push(message)
      if (message.type === 'init') queueMicrotask(() => port.emit({ type: 'ready', framework: {}, timings: {} }))
    },
    addEventListener(type, listener) {
      listeners[type].push(listener)
    },
    terminate() {
      port.terminated = true
    },
    emit(data) {
      listeners.message.forEach((listener) => listener({ data }))
    },
    /** The conversions asked for, in order. */
    converts: () => port.requests.filter((request) => request.type === 'convert'),
    /** Answers a conversion with a result. */
    answer(request, result = {}) {
      port.emit({ type: 'result', seq: request.seq, result: conversion(result), timings: { queued: 0, convert: 1 } })
    },
  }
  return port
}

const conversion = ({ errors = [], warnings = [], elements = {}, cellml = '<model/>', runnable } = {}) => ({
  ok: !errors.length,
  cellml,
  runnable,
  elements,
  issues: [...errors, ...warnings],
  errors,
  warnings,
})

function fakeHost() {
  let listener = null
  return {
    onChange: vi.fn((next) => {
      listener = next
      return () => (listener = null)
    }),
    highlight: vi.fn(),
    setLiveAnnotations: vi.fn(),
    change: (rdf, { isOpened = false, documentUri = 'https://phlynx.example/rc.celldl' } = {}) =>
      listener?.({ rdf, documentUri, isOpened }),
    isListening: () => listener !== null,
  }
}

/** Lets the client's and composable's promise chains run. */
const flush = async () => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}

describe('useLiveCelldlConvert', () => {
  let port, host, units, live

  beforeEach(async () => {
    vi.useFakeTimers()
    port = fakePort()
    host = fakeHost()
    units = ref(['<model name="lib"/>'])
    live = createLiveCelldlConvert({
      host,
      knownUnits: () => units.value,
      createWorker: async (framework, knownUnits) =>
        createConversionWorker(port, { framework, defaults: { knownUnits } }),
      loadFramework: async () => FRAMEWORK,
      loadAnnotations: async (elements) => ({ annotated: Object.keys(elements) }),
      isAvailable: true,
    })
    await live.start()
  })

  afterEach(() => {
    live.stop()
    vi.useRealTimers()
  })

  it('starts the worker with the framework and the known units, once', async () => {
    await live.start()
    const inits = port.requests.filter((request) => request.type === 'init')
    expect(inits).toEqual([{ type: 'init', framework: FRAMEWORK, defaults: { knownUnits: ['<model name="lib"/>'] } }])
    expect(host.onChange).toHaveBeenCalledTimes(1)
  })

  it('converts once edits pause, without checks', async () => {
    host.change('rdf 1')
    await vi.advanceTimersByTimeAsync(100)
    host.change('rdf 2')
    await vi.advanceTimersByTimeAsync(149)
    expect(port.converts()).toEqual([])
    expect(live.isPending.value).toBe(true)
    await vi.advanceTimersByTimeAsync(1)
    expect(port.converts()).toMatchObject([
      { source: 'rdf 2', options: { rdfSource: true, checks: 'none', sourceUri: 'https://phlynx.example/rc.celldl' } },
    ])
  })

  it('checks fully once the diagram is left alone', async () => {
    host.change('rdf')
    await vi.advanceTimersByTimeAsync(150)
    port.answer(port.converts()[0])
    await flush()
    expect(live.latest.value.pass).toBe('cheap')
    expect(live.isPending.value).toBe(false)
    expect(live.isChecking.value).toBe(true)
    await vi.advanceTimersByTimeAsync(850)
    expect(port.converts().map((request) => request.options.checks)).toEqual(['none', 'full'])
    port.answer(port.converts()[1], { runnable: true })
    await flush()
    expect(live.latest.value).toMatchObject({ pass: 'full', result: { runnable: true } })
    expect(live.isChecking.value).toBe(false)
  })

  it('sends only the newest of the edits made while a conversion runs', async () => {
    host.change('rdf 1')
    await vi.advanceTimersByTimeAsync(150)
    for (const rdf of ['rdf 2', 'rdf 3', 'rdf 4']) {
      host.change(rdf)
      await vi.advanceTimersByTimeAsync(150)
    }
    expect(port.converts().map((request) => request.source)).toEqual(['rdf 1'])
    port.answer(port.converts()[0])
    await flush()
    expect(port.converts().map((request) => request.source)).toEqual(['rdf 1', 'rdf 4'])
    // The first result was for an older diagram.
    expect(live.latest.value).toBeNull()
    port.answer(port.converts()[1], { cellml: '<model name="4"/>' })
    await flush()
    expect(live.result.value.cellml).toBe('<model name="4"/>')
  })

  it("drops a result for a diagram that's changed since", async () => {
    host.change('rdf 1')
    await vi.advanceTimersByTimeAsync(150)
    host.change('rdf 2')
    port.answer(port.converts()[0], { errors: [{ message: 'bad', elementId: 'R' }] })
    await flush()
    expect(live.latest.value).toBeNull()
    expect(host.highlight).not.toHaveBeenCalled()
    expect(live.isPending.value).toBe(true)
  })

  it('marks the elements with issues and annotates the diagram as converted', async () => {
    host.change('rdf')
    await vi.advanceTimersByTimeAsync(150)
    port.answer(port.converts()[0], {
      errors: [{ message: 'bad', elementId: 'R' }, { message: 'no element' }],
      warnings: [{ message: 'odd', elementId: 'R' }],
      elements: { R: { primary: 'v_R' } },
    })
    await flush()
    expect(live.issues.value).toHaveLength(3)
    expect(host.highlight).toHaveBeenCalledWith(['R'], { isLive: true })
    expect(host.setLiveAnnotations).toHaveBeenCalledWith({ annotated: ['R'] })
  })

  it('keeps the annotations when the model could not be built', async () => {
    host.change('rdf')
    await vi.advanceTimersByTimeAsync(150)
    port.answer(port.converts()[0], { errors: [{ message: 'no template', elementId: 'X' }] })
    await flush()
    expect(host.highlight).toHaveBeenCalledWith(['X'], { isLive: true })
    expect(host.setLiveAnnotations).not.toHaveBeenCalled()
  })

  it('converts a diagram just opened at once, starting afresh', async () => {
    host.change('rdf')
    await vi.advanceTimersByTimeAsync(150)
    port.answer(port.converts()[0])
    await flush()
    host.change('opened', { isOpened: true })
    expect(live.latest.value).toBeNull()
    await vi.advanceTimersByTimeAsync(0)
    expect(port.converts().at(-1)).toMatchObject({ source: 'opened', options: { checks: 'none' } })
  })

  it('drops what it was converting once another source starts opening', async () => {
    host.change('rdf')
    await vi.advanceTimersByTimeAsync(150)
    host.change(null)
    port.answer(port.converts()[0], { errors: [{ message: 'bad', elementId: 'R' }] })
    await vi.advanceTimersByTimeAsync(2000)
    expect(live.latest.value).toBeNull()
    expect(host.highlight).not.toHaveBeenCalled()
    expect(port.converts()).toHaveLength(1)
    expect(live.isChecking.value).toBe(false)
  })

  it('ends a worker that finished starting after it was stopped', async () => {
    live.stop()
    let resolveWorker
    const late = fakePort()
    live = createLiveCelldlConvert({
      host,
      createWorker: (framework) =>
        new Promise((resolve) => (resolveWorker = () => resolve(createConversionWorker(late, { framework })))),
      loadFramework: async () => FRAMEWORK,
      isAvailable: true,
    })
    const starting = live.start()
    await flush()
    live.stop()
    resolveWorker()
    await starting
    expect(late.terminated).toBe(true)
    expect(host.isListening()).toBe(false)
  })

  it('turns off if the worker dies, until started again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    host.change('rdf')
    await vi.advanceTimersByTimeAsync(150)
    port.emit({ type: 'error', seq: port.converts()[0].seq, error: 'out of memory' })
    await flush()
    expect(live.error.value).toBe('out of memory')
    expect(port.terminated).toBe(true)
    expect(host.isListening()).toBe(false)
  })

  it('sends the known units again only when they change', async () => {
    const defaults = () => port.requests.filter((request) => request.type === 'defaults')
    units.value = ['<model name="lib"/>']
    await nextTick()
    expect(defaults()).toEqual([])
    units.value = ['<model name="lib"/>', '<model name="other"/>']
    await nextTick()
    expect(defaults()).toEqual([
      { type: 'defaults', defaults: { knownUnits: ['<model name="lib"/>', '<model name="other"/>'] } },
    ])
  })

  it('generates the CellML as the module it is set to', async () => {
    live.setComponentName('rc')
    host.change('rdf')
    await vi.advanceTimersByTimeAsync(150)
    expect(port.converts()[0].options.componentName).toBe('rc')
  })

  it('keeps the newest CellML, with the component it was generated as, until another diagram opens', async () => {
    live.setComponentName('rc')
    host.change('rdf 1')
    await vi.advanceTimersByTimeAsync(150)
    port.answer(port.converts()[0], { cellml: '<model name="1"/>' })
    await flush()
    expect(live.cellml.value).toEqual({ cellml: '<model name="1"/>', componentName: 'rc', sections: [] })
    host.change('rdf 2')
    await vi.advanceTimersByTimeAsync(150)
    port.answer(port.converts()[1], { cellml: null, errors: [{ message: 'mid-edit' }] })
    await flush()
    expect(live.cellml.value.cellml).toBe('<model name="1"/>')
    host.change('opened', { isOpened: true })
    expect(live.cellml.value).toBeNull()
  })

  it('stops converting and ends the worker', async () => {
    host.change('rdf')
    live.stop()
    expect(port.terminated).toBe(true)
    expect(host.isListening()).toBe(false)
    await vi.advanceTimersByTimeAsync(2000)
    expect(port.converts()).toEqual([])
  })

  it('turns off if the worker fails to start', async () => {
    live.stop()
    const failing = fakePort()
    failing.postMessage = (message) => {
      if (message.type === 'init') queueMicrotask(() => failing.emit({ type: 'error', error: 'no wasm' }))
    }
    vi.spyOn(console, 'error').mockImplementation(() => {})
    live = createLiveCelldlConvert({
      host,
      createWorker: async (framework) => createConversionWorker(failing, { framework }),
      loadFramework: async () => FRAMEWORK,
      isAvailable: true,
    })
    await expect(live.start()).rejects.toThrow('no wasm')
    expect(live.error.value).toBe('no wasm')
    expect(failing.terminated).toBe(true)
    expect(host.isListening()).toBe(false)
  })

  it('does nothing where the build has no worker', async () => {
    const createWorker = vi.fn()
    const off = createLiveCelldlConvert({ host: fakeHost(), createWorker, isAvailable: false })
    await off.start()
    expect(createWorker).not.toHaveBeenCalled()
  })
})
