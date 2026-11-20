/**
 * The libCellML worker's message protocol. Requests are `{ id, op, args }`, and replies are `{ id, result }` or
 * `{ id, error }`, where error is a serialised Error: its name, message, and own enumerable plain-data properties,
 * which callers may read (such as an `unrelated` or `code` flag).
 */
import { runOperation } from './operations'

/** Whether a value survives postMessage as it is: primitives, arrays and plain objects of them. */
function isPlainData(value) {
  if (value === null || ['string', 'number', 'boolean', 'undefined', 'bigint'].includes(typeof value)) return true
  if (Array.isArray(value)) return value.every(isPlainData)
  if (typeof value !== 'object') return false
  const prototype = Object.getPrototypeOf(value)
  return (prototype === Object.prototype || prototype === null) && Object.values(value).every(isPlainData)
}

/**
 * Turns a thrown value into plain data for postMessage.
 *
 * @param {*} error - Usually an Error.
 * @returns {{ name: string, message: string, props: Object }}
 */
export function serialiseError(error) {
  if (!(error instanceof Error)) return { name: 'Error', message: String(error), props: {} }
  const props = Object.fromEntries(
    Object.entries(error).filter(([key, value]) => key !== 'name' && key !== 'message' && isPlainData(value))
  )
  return { name: error.name, message: error.message, props }
}

/**
 * Rebuilds an Error from serialiseError's data.
 *
 * @param {{ name: string, message: string, props?: Object }} data
 * @returns {Error}
 */
export function deserialiseError({ name, message, props = {} }) {
  const error = Object.assign(new Error(message), props)
  if (name && name !== 'Error') error.name = name
  return error
}

/**
 * Answers a request, as the worker does.
 *
 * @param {{ id: number, op: string, args?: Array }} request
 * @param {() => Promise<Object>} loadLibCellML - Gives the libCellML instance.
 * @returns {Promise<{ id: number, result: * }|{ id: number, error: Object }>}
 */
export async function handleRequest(request, loadLibCellML) {
  const { id, op, args = [] } = request ?? {}
  try {
    return { id, result: await runOperation(await loadLibCellML(), op, args) }
  } catch (error) {
    return { id, error: serialiseError(error) }
  }
}
