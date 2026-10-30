// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest'

import { IMPORT_KEYS } from '../../../src/utils/constants.js'
import { getImportConfig } from '../../../src/utils/import.js'
import { parseForRole } from '../../../src/utils/importBatch.js'
import { readToy } from '../services/annotations/toyModel.js'

const fileOf = (name, text) => new File([text], name)
const fields = () => getImportConfig(IMPORT_KEYS.TURTLE).fields

describe('the Apply Annotations import', () => {
  it('takes several sidecars and one instance file', () => {
    const [sidecars, instances] = fields()
    expect(sidecars).toMatchObject({ key: IMPORT_KEYS.TURTLE, accept: '.ttl', required: false })
    expect(sidecars.limit).toBeUndefined()
    expect(instances).toMatchObject({ key: IMPORT_KEYS.API_COORDS, accept: '.ttl, .rdf', limit: 1, required: true })
  })

  it('sorts a sidecar and an instance file into their fields, whichever field they are dropped on', async () => {
    const sidecar = await parseForRole(fileOf('porter.ttl', readToy('porter.ttl')), [...fields()].reverse())
    expect(sidecar.key).toBe(IMPORT_KEYS.TURTLE)
    expect(sidecar.data).toEqual({ text: readToy('porter.ttl') })

    const instances = await parseForRole(fileOf('coords.ttl', readToy('toy-apicoords.ttl')), fields())
    expect(instances.key).toBe(IMPORT_KEYS.API_COORDS)
    expect(instances.data).toEqual({ text: readToy('toy-apicoords.ttl'), format: 'turtle' })
  })

  it('reports broken Turtle and skips unrelated files', async () => {
    const broken = await parseForRole(fileOf('broken.ttl', '@prefix m: <./x#> . m:x m:y'), fields())
    expect(broken.error).toMatch(/Invalid Turtle/)
    expect(broken.skip).toBeUndefined()
    expect((await parseForRole(fileOf('model.cellml', '<model/>'), fields())).skip).toBe(true)
  })
})
