/**
 * A stand-in for services/libcellml/libcellmlClient.js that runs each operation at once, without waiting for
 * libCellML to load, for tests that mock the functions the operations call:
 * `vi.mock('.../services/libcellml/libcellmlClient', () => import('.../helpers/inlineLibcellmlClient.js'))`.
 */
import { runOperation } from '../../../src/services/libcellml/operations.js'

export const runLibCellML = async (op, ...args) => runOperation(null, op, args)
