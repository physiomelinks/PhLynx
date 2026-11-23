// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const CELLML = '../../../src/utils/cellml.js'
const { createLibCellML } = vi.hoisted(() => ({ createLibCellML: vi.fn() }))

vi.mock('libcellml.js/libcellml.js', () => ({ default: createLibCellML }))
vi.mock('libcellml.js/libcellml.wasm?url', () => ({ default: '/assets/libcellml.wasm' }))

describe('loadLibCellML', () => {
  let cellml

  beforeEach(async () => {
    vi.resetModules()
    createLibCellML.mockReset()
    cellml = await import(CELLML)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('loads libCellML once, on first call, and shares it', async () => {
    const instance = { isFake: true }
    createLibCellML.mockResolvedValue(instance)
    expect(createLibCellML).not.toHaveBeenCalled()

    const loads = await Promise.all([cellml.loadLibCellML(), cellml.loadLibCellML()])

    expect(loads).toEqual([instance, instance])
    expect(await cellml.loadLibCellML()).toBe(instance)
    expect(createLibCellML).toHaveBeenCalledTimes(1)
    expect(createLibCellML.mock.calls[0][0].locateFile()).toBe('/assets/libcellml.wasm')
    expect(cellml.getLibCellML()).toBe(instance)
  })

  it('tries again after a failed load', async () => {
    const instance = { isFake: true }
    createLibCellML.mockRejectedValueOnce(new Error('no wasm')).mockResolvedValueOnce(instance)

    await expect(cellml.loadLibCellML()).rejects.toThrow('no wasm')
    expect(await cellml.loadLibCellML()).toBe(instance)
    expect(createLibCellML).toHaveBeenCalledTimes(2)
  })

  it('uses an instance already bound with initLibCellML', async () => {
    const instance = { isBound: true }
    cellml.initLibCellML(instance)

    expect(await cellml.loadLibCellML()).toBe(instance)
    expect(createLibCellML).not.toHaveBeenCalled()
  })
})
