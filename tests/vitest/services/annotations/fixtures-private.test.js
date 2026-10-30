import { existsSync, readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { parseApiCoords } from '../../../../src/services/annotations/apicoord.js'
import { parseSidecar } from '../../../../src/services/annotations/sidecar.js'

// Unpublished fixtures, gitignored: the test runs only where they are present. private/expected.json names the
// instances, their kinds and maths, so nothing of the model is written here.
const PRIVATE = resolve(__dirname, '../../fixtures/annotations/private')
const EXPECTED = resolve(PRIVATE, 'expected.json')
const read = (...path) => readFileSync(resolve(PRIVATE, ...path), 'utf8')
const expected = existsSync(EXPECTED) ? JSON.parse(read('expected.json')) : { instances: [] }
const MODULES = [...new Set(expected.instances.map((instance) => instance.mathRef.split(':')[1]))]
const kindOf = (name) => expected.instances.find((instance) => instance.name === name)?.kind

describe.skipIf(!existsSync(EXPECTED))('private fixtures', () => {
  it('parses the ApiCoords: every expected instance, of its kind, with no warnings', async () => {
    const { instances, warnings } = await parseApiCoords(read('apicoords.ttl'))
    expect(warnings).toEqual([])
    expect(instances.map((instance) => instance.name).sort()).toEqual(expected.instances.map((i) => i.name).sort())
    for (const instance of instances) expect(instance.coord.kind, instance.name).toBe(kindOf(instance.name))
  })

  it.each(MODULES)('parses the %s sidecar against its math with no warnings', async (name) => {
    const sidecar = await parseSidecar(read('sidecars', `${name}.ttl`), {
      mathRef: `${name}.cellml:${name}`,
      cellml: read('maths', `${name}.cellml`),
    })
    expect(sidecar.warnings).toEqual([])
    expect(['compartment', 'membrane', 'transporter']).toContain(sidecar.component.kind)
    expect(sidecar.variables.length).toBeGreaterThan(0)
    for (const entry of sidecar.variables) {
      expect(entry.property, entry.variable).toMatch(/^OPB:/)
      expect(entry.location, entry.variable).toBeTruthy()
    }
  })
})
