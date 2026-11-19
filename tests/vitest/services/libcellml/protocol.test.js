// @vitest-environment node
import { describe, expect, it } from 'vitest'

import { deserialiseError, handleRequest, serialiseError } from '../../../../src/services/libcellml/protocol.js'

const LIBCELLML = {} // checkModel returns early on empty math, so needs nothing from it

describe('serialiseError and deserialiseError', () => {
  it('keep the name, message and plain-data properties, through a structured clone', () => {
    const thrown = Object.assign(new TypeError('Bad model'), {
      code: 'no-session',
      details: [{ title: 'Units', items: ['a', 'b'] }],
      unrelated: true,
      callback: () => {},
      when: new Date(),
    })
    const data = structuredClone(serialiseError(thrown))
    const error = deserialiseError(data)

    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('TypeError')
    expect(error.message).toBe('Bad model')
    expect(error).toMatchObject({ code: 'no-session', details: [{ title: 'Units', items: ['a', 'b'] }], unrelated: true })
    expect(error).not.toHaveProperty('callback')
    expect(error).not.toHaveProperty('when')
  })

  it('turn a thrown non-Error into an Error with its text', () => {
    const error = deserialiseError(serialiseError('plain text'))
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('Error')
    expect(error.message).toBe('plain text')
  })
})

describe('handleRequest', () => {
  it('replies with the operation result', async () => {
    const reply = await handleRequest({ id: 7, op: 'checkModel', args: [''] }, async () => LIBCELLML)
    expect(reply).toEqual({ id: 7, result: { invalid: [], imbalances: [] } })
  })

  it('replies with an error for an unknown operation', async () => {
    const reply = await handleRequest({ id: 8, op: 'noSuchOp' }, async () => LIBCELLML)
    expect(reply).toEqual({ id: 8, error: { name: 'Error', message: 'Unknown libCellML operation: noSuchOp', props: {} } })
  })

  it('replies with an error when libCellML fails to load', async () => {
    const reply = await handleRequest({ id: 9, op: 'checkModel', args: [''] }, () =>
      Promise.reject(new Error('wasm failed'))
    )
    expect(reply.error.message).toBe('wasm failed')
  })
})
