import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { parseObsData } from '../../../../src/services/protocol/obsDataDocument.js'
import { expandShape, normaliseShape } from '../../../../src/services/protocol/protocolShapes.js'
import { readAsCircAutogen } from '../../../../src/services/protocol/protocolValidation.js'

const RESOURCES = join(__dirname, '../../../resources/protocols')
// What circulatory_autogen's own code makes of each case (scripts/protocol-parity/generate_ca_vectors.py).
const VECTORS = JSON.parse(readFileSync(join(RESOURCES, 'ca-vectors.json'), 'utf8'))

/**
 * Runs a case, as a result or an error message, the way the vectors record it.
 *
 * @param {Function} run
 * @returns {{result: *}|{error: string}}
 */
function outcome(run) {
  try {
    return { result: run() }
  } catch (error) {
    return { error: error.message }
  }
}

describe('the port of circulatory_autogen', () => {
  it.each(VECTORS.shapes.map((vector) => [vector.name, vector]))('expands the shape "%s" as CA does', (_, vector) => {
    const { name, shape, duration, ...expected } = vector
    expect(outcome(() => expandShape(normaliseShape(shape, 's'), duration, 's'))).toEqual(expected)
  })

  it.each(VECTORS.protocols.map((vector) => [vector.name, vector]))('reads the protocol "%s" as CA does', (_, vector) => {
    const { name, protocol_info: protocolInfo, ...expected } = vector
    const { error, protocolInfo: read } = readAsCircAutogen(protocolInfo)
    expect(error ? { error } : { result: read.protocol_traces }).toEqual(expected)
  })

  it.each(Object.entries(VECTORS.fixtures))('reads the protocol of %s as CA does', (fileName, expected) => {
    const { protocolInfo: given } = parseObsData(readFileSync(join(RESOURCES, fileName), 'utf8'))
    if (expected.result === null) {
      expect(given).toBeNull()
      return
    }
    const { error, protocolInfo } = readAsCircAutogen(given)
    expect(error).toBeNull()
    expect(protocolInfo.protocol_traces).toEqual(expected.result)
  })
})
