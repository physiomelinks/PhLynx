import { describe, expect, it } from 'vitest'

import schema from '../../../../../src/assets/bio_pieces/bio-pieces.schema.json'
import {
  FLUXES,
  LIMITS,
  PIECE_ID,
  PIECE_KEYS,
  PIECE_KINDS,
  SIDES,
  TEMPLATE_ID,
  TONES,
} from '../../../../../src/services/bioView/pieces/constants.js'
import { validatePiecesTemplate } from '../../../../../src/services/bioView/pieces/model.js'

const files = import.meta.glob('../../../../../src/assets/bio_pieces/*.pieces.json', { eager: true })

describe('the pieces schema, kept in step with the validator', () => {
  const defs = schema.$defs

  it('lists the keys the validator reads, for every object', () => {
    const keys = (def) => Object.keys(def.properties).sort()
    expect(Object.keys(schema.properties).sort()).toEqual([...PIECE_KEYS.assembly].sort())
    for (const kind of PIECE_KINDS) expect(keys(defs[kind]), kind).toEqual([...PIECE_KEYS[kind]].sort())
    expect(keys(defs.dock)).toEqual([...PIECE_KEYS.dock].sort())
    expect(keys(defs.span)).toEqual([...PIECE_KEYS.span].sort())
    expect(Object.keys(defs.membrane.properties.sides.properties)).toEqual([...SIDES])
  })

  it('has the validator’s ids, words and limits', () => {
    expect(schema.properties.schemaVersion.const).toBe(4)
    expect(schema.properties.id.pattern).toBe(TEMPLATE_ID.source)
    expect(defs.pieceId.pattern).toBe(PIECE_ID.source)
    expect(schema.properties.pieces.maxItems).toBe(LIMITS.pieces)
    expect(defs.side.maxItems).toBe(LIMITS.spans)
    expect(defs.compartment.properties.docks.maxItems).toBe(LIMITS.docks)
    expect(defs.compartment.properties.tone.enum).toEqual([...TONES])
    expect(defs.tube.properties.flux.enum).toEqual([...FLUXES])
    expect(defs.tube.properties.bends.maxItems).toBe(LIMITS.bends)
    expect(defs.fold.properties.depth).toMatchObject({ minimum: LIMITS.fold.min, maximum: LIMITS.fold.max })
    expect(defs.compartment.properties.depth).toMatchObject({ minimum: LIMITS.depth.min, maximum: LIMITS.depth.max })
    expect(defs.zone.properties.frame.properties.width).toMatchObject({
      minimum: LIMITS.size.min,
      maximum: LIMITS.size.max,
    })
  })

  it('is what every built-in template points to, and they all read cleanly', () => {
    for (const [path, module] of Object.entries(files)) {
      expect(module.default.$schema, path).toBe('./bio-pieces.schema.json')
      expect(validatePiecesTemplate(module.default)).toMatchObject({ errors: [], warnings: [] })
    }
  })
})
