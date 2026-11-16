// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const RUNTIME = '../../../../src/services/celldl/runtime.js'

/** Mocks the editor, bg2cellml and libCellML, the editor's RDF initialiser running `init`. */
function mockModules({ init, frameworkIssues = [] }) {
  const initialiseRdf = vi.fn(init)
  const loadFramework = vi.fn(() => frameworkIssues)
  const Converter = vi.fn(function (runtime) {
    this.runtime = runtime
    this.loadFramework = loadFramework
  })
  vi.doMock('../../../../src/utils/cellml.js', () => ({ whenLibCellMLReady: () => Promise.resolve('libcellml') }))
  vi.doMock('@celldl/editor', () => ({ initialiseRdf, bgRdfStatements: () => ['quad'] }))
  vi.doMock('@physiomelinks/bg2cellml', () => ({ Converter }))
  return { initialiseRdf, loadFramework, Converter }
}

const startRdf = async () => 'oxigraph'

describe('getConverter', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.doUnmock('../../../../src/utils/cellml.js')
    vi.doUnmock('@celldl/editor')
    vi.doUnmock('@physiomelinks/bg2cellml')
  })

  it("builds one converter on the editor's oxigraph and framework", async () => {
    const { initialiseRdf, loadFramework, Converter } = mockModules({ init: startRdf })
    const { getConverter } = await import(RUNTIME)

    const converter = await getConverter()

    expect(await getConverter()).toBe(converter)
    expect(initialiseRdf).toHaveBeenCalledTimes(1)
    expect(Converter).toHaveBeenCalledWith({ libcellml: 'libcellml', oxigraph: 'oxigraph' })
    expect(loadFramework).toHaveBeenCalledWith({ quads: ['quad'] })
  })

  it("fails, and tries again next time, when the editor's RDF layer doesn't start", async () => {
    const { initialiseRdf } = mockModules({
      init: async () => {
        throw new Error('no wasm')
      },
    })
    const { getConverter } = await import(RUNTIME)

    await expect(getConverter()).rejects.toThrow('no wasm')
    initialiseRdf.mockImplementation(startRdf)
    await expect(getConverter()).resolves.toBeTruthy()
    expect(initialiseRdf).toHaveBeenCalledTimes(2)
  })

  it("fails when the framework doesn't load", async () => {
    mockModules({ init: startRdf, frameworkIssues: ['No ontology'] })
    const { getConverter } = await import(RUNTIME)

    await expect(getConverter()).rejects.toThrow(/framework didn't load: No ontology/)
  })
})
