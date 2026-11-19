/**
 * The operations the libCellML worker runs (workers/libcellmlWorker.js), by name. Each takes the libCellML instance
 * then its arguments, which must be plain data, as must its result: they cross to and from the worker by
 * postMessage. The client (libcellmlClient.js) runs the same functions on the main thread when it can't use the worker.
 */
import { checkModel } from '../math/checkModel'

export const operations = {
  checkModel,
}

/**
 * Runs an operation.
 *
 * @param {Object} libcellml - The libCellML instance.
 * @param {string} op - An operation's name.
 * @param {Array} args - Its arguments, after libcellml.
 * @returns {*} What the operation returns.
 * @throws {Error} When no operation has that name, or the operation throws.
 */
export function runOperation(libcellml, op, args = []) {
  if (!Object.hasOwn(operations, op)) throw new Error(`Unknown libCellML operation: ${op}`)
  return operations[op](libcellml, ...args)
}
