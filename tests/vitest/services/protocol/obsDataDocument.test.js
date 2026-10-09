import { describe, expect, it } from 'vitest'

import {
  buildObsDataLocation,
  findObsDataExtra,
  parseObsData,
  serialiseObsData,
} from '../../../../src/services/protocol/obsDataDocument.js'

const encode = (value) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value)).buffer
const extra = (location, value, format = 'application/json') => ({ location, format, payload: encode(value) })
const PROTOCOL = { protocol_info: { pre_times: [0], sim_times: [[1]] }, data_items: [] }

describe('obsDataDocument', () => {
  it('reads a document, and a bare list as data items without a protocol', () => {
    expect(parseObsData(encode({ ...PROTOCOL, prediction_items: [{ a: 1 }] }))).toMatchObject({
      protocolInfo: PROTOCOL.protocol_info,
      dataItems: [],
      predictionItems: [{ a: 1 }],
    })
    expect(parseObsData('[{"data_item_name": "x"}]')).toMatchObject({ protocolInfo: null, dataItems: [{ data_item_name: 'x' }] })
  })

  it('finds the obs_data as CUFLynx does: by an "obs" name first, then by its contents', () => {
    const extras = [
      extra('simulation.json', { input: [] }),
      extra('study.json', PROTOCOL),
      extra('folder/model_obs_data.json', PROTOCOL),
    ]
    expect(findObsDataExtra(extras)).toMatchObject({ index: 2, document: PROTOCOL })
    expect(findObsDataExtra(extras.slice(0, 2))).toMatchObject({ index: 1 })
    expect(findObsDataExtra(extras.slice(0, 1))).toBeNull()
  })

  it("passes over parameter files, the module config and PhLynx's own", () => {
    expect(
      findObsDataExtra([
        extra('params_obs.json', PROTOCOL),
        extra('module_config.json', [{ vessel_type: 'heart' }]),
        extra('obs-flow.json', PROTOCOL, 'application/x.vnd.phlynx-flow+json'),
        extra('obs.sedml.json', PROTOCOL, 'http://identifiers.org/combine.specifications/sed-ml'),
        extra('obs.csv', 'a,b'),
      ])
    ).toBeNull()
  })

  it('picks a file named with "obs" even when it is not JSON, saying why it could not be read', () => {
    const found = findObsDataExtra([extra('study.json', PROTOCOL), extra('broken_obs.json', '{')])
    expect(found).toMatchObject({ index: 1, document: undefined })
    expect(found.parseError).toBeInstanceOf(SyntaxError)
  })

  it('writes a document back as it reads', () => {
    const document = { data_items: [], protocol_info: { comment: 'é', sim_times: [[1.5]] }, unknown: { kept: true } }
    const text = new TextDecoder().decode(serialiseObsData(document))
    expect(text).toBe(`${JSON.stringify(document, null, 2)}\n`)
    expect(parseObsData(serialiseObsData(document)).document).toEqual(document)
  })

  it('names a new file after the model', () => {
    expect(buildObsDataLocation('heart')).toBe('heart_obs_data.json')
    expect(buildObsDataLocation('')).toBe('model_obs_data.json')
  })
})
