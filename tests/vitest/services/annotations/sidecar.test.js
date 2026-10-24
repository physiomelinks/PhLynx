import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { componentKind, parseSidecar, parseSidecars } from '../../../../src/services/annotations/sidecar.js'
import { splitSubject } from '../../../../src/services/annotations/iris.js'

const TOY = resolve(__dirname, '../../fixtures/annotations/toy')
const read = (name) => readFileSync(resolve(TOY, name), 'utf8')
const byVariable = (sidecar) => Object.fromEntries(sidecar.variables.map((entry) => [entry.variable, entry]))

const PREFIXES = `@prefix bqbiol: <http://biomodels.net/biology-qualifiers/> .
@prefix opb: <http://identifiers.org/opb/OPB_> .
@prefix chebi: <http://purl.obolibrary.org/obo/CHEBI_> .
@prefix go: <http://purl.obolibrary.org/obo/GO_> .
@prefix sbo: <http://purl.obolibrary.org/obo/SBO_> .
@prefix m: <./pool.cellml#> .
`

describe('parseSidecar', () => {
  it('reads a compartment: self-located properties', async () => {
    const sidecar = await parseSidecar(read('pool.ttl'), { mathRef: 'pool.cellml:pool', cellml: read('pool.cellml') })
    expect(sidecar.warnings).toEqual([])
    expect(sidecar).toMatchObject({ mathRef: 'pool.cellml:pool', file: 'pool.cellml', componentName: 'pool' })
    expect(sidecar.component).toMatchObject({ kind: 'compartment', is: ['SBO:0000290'], isVersionOf: [] })
    const variables = byVariable(sidecar)
    expect(Object.keys(variables).sort()).toEqual(['area', 'c_A', 'v_A', 'volume'])
    expect(variables.c_A).toMatchObject({ property: 'OPB:00340', species: ['CHEBI:29101'], location: 'self' })
    expect(variables.c_A.entity).toEqual({ self: false, is: ['CHEBI:29101'], isPartOf: 'self' })
    expect(variables.v_A).toMatchObject({ property: 'OPB:00592', location: 'self' })
    expect(variables.volume).toMatchObject({ property: 'OPB:00154', species: [], location: 'self' })
    expect(variables.volume.entity.self).toBe(true)
    expect(variables.area).toMatchObject({ property: 'OPB:00295', species: [], location: 'self+GO:0005886' })
  })

  it('reads a membrane', async () => {
    const sidecar = await parseSidecar(read('wall.ttl'), { mathRef: 'wall.cellml:wall', cellml: read('wall.cellml') })
    expect(sidecar.warnings).toEqual([])
    expect(sidecar.component.kind).toBe('membrane')
    const variables = byVariable(sidecar)
    expect(variables.u).toMatchObject({ property: 'OPB:00506', location: 'self' })
    expect(variables.i_tot).toMatchObject({ property: 'OPB:00318', location: 'self' })
  })

  it('reads a transporter written with alternative IRI forms and a CellML id subject', async () => {
    const sidecar = await parseSidecar(read('porter.ttl'), {
      mathRef: 'porter.cellml:porter',
      cellml: read('porter.cellml'),
    })
    expect(sidecar.warnings).toEqual([])
    expect(sidecar.component).toMatchObject({
      kind: 'transporter',
      is: ['uniprot:Q0TOY1'],
      isVersionOf: ['GO:0005412'],
    })
    const variables = byVariable(sidecar)
    expect(Object.keys(variables).sort()).toEqual(['area', 'c_A_i', 'c_A_o', 'j_A', 'u', 'v_A_i', 'v_A_o'])
    expect(variables.c_A_i).toMatchObject({ property: 'OPB:00340', species: ['CHEBI:29101'], location: 'GO:0005737' })
    expect(variables.c_A_o).toMatchObject({ property: 'OPB:00340', species: ['CHEBI:29101'], location: 'GO:0005576' })
    expect(variables.v_A_i).toMatchObject({
      subject: 'https://phlynx.invalid/modules/porter.cellml#flux_in',
      property: 'OPB:00592',
      species: ['CHEBI:29101'],
      location: 'GO:0005737',
    })
    expect(variables.j_A).toMatchObject({ property: 'OPB:00318', species: [], location: 'GO:0005886' })
    expect(variables.u.location).toBe('GO:0005886')
  })

  it('derives the mathRef from the subjects when none is given', async () => {
    const sidecar = await parseSidecar(read('wall.ttl'))
    expect(sidecar.mathRef).toBe('wall.cellml:wall')
  })

  it('accepts a GO location given as bqbiol:isPartOf', async () => {
    const sidecar = await parseSidecar(
      `${PREFIXES}m:pool bqbiol:is sbo:0000290 .
m:pool.c_A bqbiol:isVersionOf opb:00340 ; bqbiol:isPropertyOf [ bqbiol:is chebi:29101 ; bqbiol:isPartOf go:0005737 ] .`,
      { mathRef: 'pool.cellml:pool' }
    )
    expect(sidecar.warnings).toEqual([])
    expect(sidecar.variables[0]).toMatchObject({ species: ['CHEBI:29101'], location: 'GO:0005737' })
  })

  it('collects problems as warnings', async () => {
    const sidecar = await parseSidecar(
      `${PREFIXES}m:pool bqbiol:is sbo:0000290 .
m:pool.no_property bqbiol:isPropertyOf m:pool .
m:pool.no_location bqbiol:isVersionOf opb:00340 ; bqbiol:isPropertyOf [ bqbiol:is chebi:29101 ] .
m:pool.missing bqbiol:isVersionOf opb:00154 ; bqbiol:isPropertyOf m:pool .
m:pool.odd bqbiol:isVersionOf opb:00340 ; bqbiol:isPropertyOf [ bqbiol:is chebi:29101 , <http://identifiers.org/uniprot/P11168> ; bqbiol:isPartOf m:pool ] .
m:unknown_id bqbiol:isVersionOf opb:00340 ; bqbiol:isPropertyOf m:pool .
m:stray bqbiol:is chebi:29101 .`,
      {
        mathRef: 'pool.cellml:pool',
        cellml: read('pool.cellml').replace(
          '<variable name="t"',
          '<variable name="no_property"/><variable name="no_location"/><variable name="odd"/><variable name="t"'
        ),
      }
    )
    const messages = sidecar.warnings.map((warning) => `${warning.subject?.split('#')[1]}: ${warning.message}`)
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^pool\.no_property: No OPB property/),
        expect.stringMatching(/^pool\.no_location: The entity has no location/),
        expect.stringMatching(/^pool\.missing: The math has no variable 'missing'/),
        expect.stringMatching(/^pool\.odd: Unrecognised entity terms: uniprot:P11168/),
        expect.stringMatching(/^unknown_id: The subject names no variable/),
        expect.stringMatching(/^stray: The subject is neither/),
      ])
    )
    expect(sidecar.warnings).toHaveLength(6)
    expect(byVariable(sidecar).odd.location).toBe('self')
  })

  it('warns on a syntax error, a missing component and a wrong file', async () => {
    const broken = await parseSidecar('m:pool bqbiol:is .', { mathRef: 'pool.cellml:pool' })
    expect(broken.variables).toEqual([])
    expect(broken.warnings[0].message).toMatch(/Could not parse/)

    const noComponent = await parseSidecar(read('pool.ttl'), { mathRef: 'pool.cellml:tank' })
    expect(noComponent.component).toBeNull()
    expect(noComponent.warnings.map((w) => w.message)).toContain("No component subject '#tank' found.")

    const otherFile = await parseSidecar(read('pool.ttl'), { mathRef: 'tank.cellml:pool' })
    expect(otherFile.warnings[0].message).toMatch(/not 'tank\.cellml'/)
  })

  it('keys several sidecars by mathRef', async () => {
    const sidecars = await parseSidecars([
      { text: read('pool.ttl'), mathRef: 'pool.cellml:pool' },
      { text: read('wall.ttl') },
    ])
    expect([...sidecars.keys()]).toEqual(['pool.cellml:pool', 'wall.cellml:wall'])
  })
})

describe('helpers', () => {
  it('splits subjects and derives component kinds', () => {
    expect(splitSubject('https://x.org/a/b%20c.cellml#comp.v')).toEqual({ file: 'b c.cellml', fragment: 'comp.v' })
    expect(splitSubject('https://x.org/a')).toBeNull()
    expect(componentKind(['uniprot:P1'])).toBe('transporter')
    expect(componentKind(['GO:0005886'])).toBe('membrane')
    expect(componentKind(['SBO:0000290'])).toBe('compartment')
    expect(componentKind([])).toBeNull()
  })
})
