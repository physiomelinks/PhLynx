// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { IMPORT_KEYS } from '../../../src/utils/constants.js'
import { getImportConfig } from '../../../src/utils/import.js'
import { parseForRole } from '../../../src/utils/importBatch.js'
import { readToy } from '../services/annotations/toyModel.js'

const fileOf = (name, text) => new File([text], name)
const fields = () => getImportConfig(IMPORT_KEYS.TURTLE).fields

describe('the module annotations import', () => {
  it('takes several sidecars', () => {
    const [sidecars] = fields()
    expect(fields()).toHaveLength(1)
    expect(sidecars).toMatchObject({ key: IMPORT_KEYS.TURTLE, accept: '.ttl', required: true })
    expect(sidecars.limit).toBeUndefined()
  })

  it('reads a sidecar into its field', async () => {
    const sidecar = await parseForRole(fileOf('porter.ttl', readToy('porter.ttl')), fields())
    expect(sidecar.key).toBe(IMPORT_KEYS.TURTLE)
    expect(sidecar.data).toEqual({ text: readToy('porter.ttl') })
  })

  it('reports broken Turtle and skips unrelated files', async () => {
    const broken = await parseForRole(fileOf('broken.ttl', '@prefix m: <./x#> . m:x m:y'), fields())
    expect(broken.error).toMatch(/Invalid Turtle/)
    expect(broken.skip).toBeUndefined()
    expect((await parseForRole(fileOf('model.cellml', '<model/>'), fields())).skip).toBe(true)
  })
})
