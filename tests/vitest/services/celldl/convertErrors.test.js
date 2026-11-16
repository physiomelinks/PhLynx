// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

const result = vi.hoisted(() => ({ current: null }))

vi.mock('../../../../src/services/celldl/runtime.js', () => ({
  getConverter: async () => ({ convert: async () => result.current }),
}))
vi.mock('@physiomelinks/bg2cellml', () => ({ toViewerAnnotations: () => ({}) }))

import { convertCelldl } from '../../../../src/services/celldl/convert.js'

/** A failed conversion that gives no error of its own. */
const failed = (fields) => ({
  ok: false,
  runnable: false,
  baseUri: 'https://example.org/rc.celldl',
  elements: {},
  units: { renamed: {} },
  errors: [],
  warnings: [],
  generator: {},
  framework: {},
  ...fields,
})

describe('convertCelldl without an error from the converter', () => {
  it.each([
    ['an exception', { exception: 'TypeError: boom\n    at x' }, /converter failed: TypeError: boom$/],
    ['no CellML', {}, /gave no CellML/],
    ['a model that cannot run', { cellml: '<model/>', modelType: 'nla' }, /can't be simulated \(its type is nla\)/],
  ])('blocks %s with an error to show', async (_, fields, message) => {
    result.current = failed(fields)

    const converted = await convertCelldl('<svg/>', { componentName: 'rc' })

    expect(converted).toMatchObject({ ok: false, components: null, unitsModel: null, frameworkVersion: null })
    expect(converted.errors).toEqual([expect.objectContaining({ severity: 'error', message: expect.stringMatching(message) })])
  })
})
