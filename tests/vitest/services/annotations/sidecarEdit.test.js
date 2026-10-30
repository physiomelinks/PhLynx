import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { parseRdf } from '../../../../src/services/annotations/rdf.js'
import { SIDECAR_BASE_IRI, parseSidecar } from '../../../../src/services/annotations/sidecar.js'
import { editSidecar, renameSidecar } from '../../../../src/services/annotations/sidecarEdit.js'

const TOY = resolve(__dirname, '../../fixtures/annotations/toy')
const read = (name) => readFileSync(resolve(TOY, name), 'utf8')
const TOYS = ['pool', 'porter', 'wall']

/** Parses a sidecar against its toy math, keyed by variable. */
async function readToySidecar(text, name, mathRef = `${name}.cellml:${name}`) {
  const sidecar = await parseSidecar(text, { mathRef, cellml: read(`${name}.cellml`) })
  return { ...sidecar, byVariable: Object.fromEntries(sidecar.variables.map((entry) => [entry.variable, entry])) }
}

/** The triple count of a sidecar. */
async function countTriples(text) {
  return (await parseRdf(text, { baseIri: SIDECAR_BASE_IRI })).length
}

describe('editSidecar', () => {
  it.each(TOYS)('round-trips the toy %s sidecar unchanged without edits', async (name) => {
    const text = read(`${name}.ttl`)
    const written = await editSidecar(text, `${name}.cellml:${name}`, { cellml: read(`${name}.cellml`) })
    const before = await readToySidecar(text, name)
    const after = await readToySidecar(written, name)
    expect(after.warnings).toEqual(before.warnings)
    expect(after.component).toEqual(before.component)
    expect(after.variables).toEqual(before.variables)
    expect(await countTriples(written)).toBe(await countTriples(text))
    expect(written.split('\n')[0]).toBe(text.split('\n')[0])
    expect(written).toContain(`@prefix m: <./${name}.cellml#> .`)
  })

  it('replaces only the edited variable, writing CURIEs', async () => {
    const written = await editSidecar(read('pool.ttl'), 'pool.cellml:pool', {
      variables: new Map([['c_A', { property: 'OPB:00340', species: ['CHEBI:29103'], location: 'GO:0005737' }]]),
    })
    const { byVariable, warnings } = await readToySidecar(written, 'pool')
    expect(warnings).toEqual([])
    expect(byVariable.c_A).toMatchObject({ property: 'OPB:00340', species: ['CHEBI:29103'], location: 'GO:0005737' })
    expect(byVariable.v_A).toMatchObject({ property: 'OPB:00592', species: ['CHEBI:29101'], location: 'self' })
    expect(byVariable.area.location).toBe('self+GO:0005886')
    expect(written).toContain('m:pool.c_A bqbiol:isVersionOf opb:00340 ;')
    expect(written).toContain('[ bqbiol:is chebi:29103 , go:0005737 ]')
  })

  it('writes each location form back as it is read', async () => {
    const locations = { c_A: 'self', v_A: 'self+GO:0005886', volume: 'GO:0005576' }
    const variables = Object.fromEntries(
      Object.entries(locations).map(([variable, location]) => [variable, { property: 'OPB:00340', species: ['CHEBI:29101'], location }])
    )
    variables.area = { property: 'OPB:00295', species: [], location: 'self' }
    const { byVariable } = await readToySidecar(await editSidecar(read('pool.ttl'), 'pool.cellml:pool', { variables }), 'pool')
    for (const [variable, location] of Object.entries(locations)) expect(byVariable[variable].location).toBe(location)
    expect(byVariable.area.entity.self).toBe(true)
  })

  it('clears a variable and keeps a partial entry', async () => {
    const written = await editSidecar(read('pool.ttl'), 'pool.cellml:pool', {
      variables: { volume: null, area: { property: 'OPB:00295', species: [], location: null } },
    })
    const { byVariable } = await readToySidecar(written, 'pool')
    expect(byVariable.volume).toBeUndefined()
    expect(byVariable.area).toMatchObject({ property: 'OPB:00295', entity: null, location: null })
    expect(written).not.toContain('go:0005886')
  })

  it('keeps unmanaged triples: other isVersionOf terms, unknown predicates and id-based subjects', async () => {
    const extra = `
m:porter.c_A_i <http://purl.org/dc/terms/description> "inside" .
m:porter.u bqbiol:isVersionOf <http://example.org/other> .
`
    const text = `${read('porter.ttl')}${extra}`
    const written = await editSidecar(text, 'porter.cellml:porter', {
      componentKind: 'transporter',
      transporter: 'uniprot:P11168',
      variables: {
        c_A_i: { property: 'OPB:00340', species: ['CHEBI:29103'], location: 'GO:0005737' },
        u: { property: 'OPB:00506', species: [], location: 'GO:0005886' },
      },
    })
    const { component, byVariable } = await readToySidecar(written, 'porter')
    expect(component).toMatchObject({ kind: 'transporter', is: ['uniprot:P11168'], isVersionOf: ['GO:0005412'] })
    expect(byVariable.c_A_i).toMatchObject({ species: ['CHEBI:29103'], location: 'GO:0005737' })
    expect(byVariable.v_A_i.subject).toBe(`${SIDECAR_BASE_IRI}porter.cellml#flux_in`)
    expect(byVariable.v_A_i).toMatchObject({ property: 'OPB:00592', species: ['CHEBI:29101'], location: 'GO:0005737' })
    expect(written).toContain('"inside"')
    expect(written).toContain('<http://example.org/other>')
    expect(written).toContain('m:entity_A_cytoplasm')
  })

  it("edits an id-based subject in place, reusing its named entity, when given the math", async () => {
    const written = await editSidecar(read('porter.ttl'), 'porter.cellml:porter', {
      variables: { v_A_i: { property: 'OPB:00592', species: ['CHEBI:29103'], location: 'GO:0005737' } },
      cellml: read('porter.cellml'),
    })
    const { byVariable, warnings } = await readToySidecar(written, 'porter')
    expect(warnings).toEqual([])
    expect(byVariable.v_A_i.subject).toBe(`${SIDECAR_BASE_IRI}porter.cellml#flux_in`)
    expect(byVariable.v_A_i.species).toEqual(['CHEBI:29103'])
    expect(written).toContain('m:flux_in bqbiol:isVersionOf opb:00592 ;\n    bqbiol:isPropertyOf m:entity_A_cytoplasm')
    expect(written).not.toContain('porter.v_A_i')
  })

  it('keeps an entity with unknown triples when its variable is cleared', async () => {
    const text = read('wall.ttl').replace(
      'm:wall.u bqbiol:isVersionOf opb:00506 ;\n    bqbiol:isPropertyOf m:wall .',
      'm:wall.u bqbiol:isVersionOf opb:00506 ;\n    bqbiol:isPropertyOf [ bqbiol:is go:0005886 ; <http://purl.org/dc/terms/description> "note" ] .'
    )
    const written = await editSidecar(text, 'wall.cellml:wall', { variables: { u: null } })
    expect(written).toContain('"note"')
    expect(written).not.toContain('opb:00506')
    expect(written).not.toContain('go:0005886 ;')
  })

  it('starts a new sidecar', async () => {
    const written = await editSidecar('', 'wall.cellml:wall', {
      componentKind: 'membrane',
      variables: { u: { property: 'OPB:00506', species: [], location: 'self' } },
    })
    expect(written).toContain('m:wall bqbiol:is go:0005886 .')
    const { component, byVariable, warnings } = await readToySidecar(written, 'wall')
    expect(warnings).toEqual([])
    expect(component.kind).toBe('membrane')
    expect(byVariable.u).toMatchObject({ property: 'OPB:00506', location: 'self' })
  })

  it('changes the component kind and removes it with null', async () => {
    const membrane = await editSidecar(read('pool.ttl'), 'pool.cellml:pool', { componentKind: 'membrane' })
    expect((await readToySidecar(membrane, 'pool')).component.is).toEqual(['GO:0005886'])
    const none = await editSidecar(read('pool.ttl'), 'pool.cellml:pool', { componentKind: null })
    expect(none).not.toContain('sbo:')
  })

  it('drops the other kind terms for a transporter with no accession yet, keeping its UniProt terms', async () => {
    const pool = await editSidecar(read('pool.ttl'), 'pool.cellml:pool', { componentKind: 'transporter' })
    expect(pool).not.toContain('sbo:')
    const porter = await editSidecar(read('porter.ttl'), 'porter.cellml:porter', { componentKind: 'transporter' })
    expect((await readToySidecar(porter, 'porter')).component.kind).toBe('transporter')
  })

  it('throws on a term that is not a known CURIE', async () => {
    const variables = { c_A: { property: 'OPB:00340', species: ['sodium'], location: 'GO:0005737' } }
    await expect(editSidecar(read('pool.ttl'), 'pool.cellml:pool', { variables })).rejects.toThrow(/not a known CURIE/)
  })
})

describe('renameSidecar', () => {
  it('moves the subjects to the new math and renames variables', async () => {
    const written = await renameSidecar(read('pool.ttl'), 'pool.cellml:pool', 'tank.cellml:tank', new Map([['c_A', 'c_B']]))
    expect(written).toContain('@prefix m: <./tank.cellml#> .')
    expect(written).not.toContain('pool')
    const sidecar = await parseSidecar(written, { mathRef: 'tank.cellml:tank' })
    expect(sidecar.warnings).toEqual([])
    const byVariable = Object.fromEntries(sidecar.variables.map((entry) => [entry.variable, entry]))
    expect(Object.keys(byVariable).sort()).toEqual(['area', 'c_B', 'v_A', 'volume'])
    expect(byVariable.c_B).toMatchObject({ property: 'OPB:00340', species: ['CHEBI:29101'], location: 'self' })
    expect(byVariable.volume.entity.self).toBe(true)
  })

  it('keeps id-based subjects and named entities under the new file', async () => {
    const written = await renameSidecar(read('porter.ttl'), 'porter.cellml:porter', 'pump.cellml:porter', { u: 'V_m' })
    expect(written).toContain('m:flux_in')
    expect(written).toContain('m:entity_A_cytoplasm')
    expect(written).toContain('m:porter.V_m')
    expect(await countTriples(written)).toBe(await countTriples(read('porter.ttl')))
  })

  it('leaves an empty sidecar as is', async () => {
    expect(await renameSidecar(null, 'a.cellml:a', 'b.cellml:b')).toBeNull()
  })
})
