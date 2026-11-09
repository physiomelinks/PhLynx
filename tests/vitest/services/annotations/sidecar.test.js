import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import {
  SIDECAR_BASE_IRI,
  componentKind,
  parseSidecar,
  parseSidecars,
} from '../../../../src/services/annotations/sidecar.js'
import { isMolarFlow, splitSubject } from '../../../../src/services/annotations/iris.js'

const TOY = resolve(__dirname, '../../fixtures/annotations/toy')
const read = (name) => readFileSync(resolve(TOY, name), 'utf8')
const byVariable = (sidecar) => Object.fromEntries(sidecar.variables.map((entry) => [entry.variable, entry]))

const PREFIXES = `@prefix bqbiol: <http://biomodels.net/biology-qualifiers/> .
@prefix semsim: <http://bime.uw.edu/semsim/> .
@prefix opb: <https://identifiers.org/opb/OPB_> .
@prefix chebi: <https://identifiers.org/chebi/CHEBI:> .
@prefix go: <https://identifiers.org/go/GO:> .
@prefix sbo: <https://identifiers.org/sbo/SBO:> .
@prefix uniprot: <https://identifiers.org/uniprot/> .
@prefix m: <./pool.cellml#> .
@prefix local: <./pool.ttl#> .
`
const POOL_HEAD = `${PREFIXES}m:pool bqbiol:is sbo:0000290 .
local:entity_self bqbiol:is sbo:0000290 .
`
/** Parses Turtle against the toy pool math. */
const parsePool = (text, cellml = read('pool.cellml')) => parseSidecar(text, { mathRef: 'pool.cellml:pool', cellml })


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
    const v_A = { property: 'OPB:00592', species: ['CHEBI:29101'], location: 'self', from: null }
    expect(variables.v_A).toMatchObject(v_A)
    expect(variables.v_A.process).toMatchObject({ sources: [], mediators: [], sinks: [{ location: 'self', multiplier: 1 }] })
    expect(variables.c_A.process).toBeNull()
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
    expect(variables.i_tot).toMatchObject({ property: 'OPB:00318', species: [], location: 'self', from: null })
    expect(variables.i_tot.process.sinks[0].entity).toBe(`${SIDECAR_BASE_IRI}wall.ttl#entity_self`)
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
    expect(variables.v_A_i).toMatchObject({ from: 'GO:0005576' })
    expect(variables.v_A_i.process).toMatchObject({
      subject: `${SIDECAR_BASE_IRI}porter.ttl#process_flux_in`,
      isVersionOf: [],
      sources: [{ entity: `${SIDECAR_BASE_IRI}porter.ttl#Na_out`, location: 'GO:0005576', multiplier: 1 }],
      sinks: [{ entity: `${SIDECAR_BASE_IRI}porter.ttl#Na_in`, location: 'GO:0005737' }],
      mediators: [],
    })
    // The reverse leg, written with blank nodes: the rate into the extracellular side, from the cytoplasm.
    expect(variables.v_A_o).toMatchObject({ species: ['CHEBI:29101'], location: 'GO:0005576', from: 'GO:0005737' })
    expect(variables.v_A_o.process.subject).toMatch(/^_:/)
    expect(variables.v_A_o.process.mediators).toMatchObject([{ location: 'self' }])
    expect(variables.j_A).toMatchObject({ property: 'OPB:00318', species: [], location: 'GO:0005886', from: null })
    expect(variables.j_A.process.sinks).toMatchObject([{ entity: `${SIDECAR_BASE_IRI}porter.ttl#plasma_membrane` }])
    expect(variables.u.location).toBe('GO:0005886')
    expect(variables.v_A_i.id).toBe('flux_in')
    expect(variables.c_A_i).toMatchObject({ id: 'v4y7hdahd', subject: `${SIDECAR_BASE_IRI}porter.cellml#v4y7hdahd` })
  })

  it('reads a variable by its id under the name the math now gives it', async () => {
    const renamed = read('pool.cellml').replace('name="c_A"', 'name="conc_A"')
    const sidecar = await parseSidecar(read('pool.ttl'), { mathRef: 'pool.cellml:pool', cellml: renamed })
    expect(sidecar.warnings).toEqual([])
    expect(byVariable(sidecar).conc_A).toMatchObject({ id: 'v4rjndoly', property: 'OPB:00340' })
  })

  it('reads no variable from a <component>.<variable> subject', async () => {
    const sidecar = await parseSidecar(
      `${POOL_HEAD}m:pool.c_A bqbiol:isVersionOf opb:00340 ; bqbiol:isPropertyOf local:entity_self .`,
      { mathRef: 'pool.cellml:pool', cellml: read('pool.cellml') }
    )
    expect(sidecar.variables).toEqual([])
    const messages = sidecar.warnings.map((warning) => warning.message)
    expect(messages).toContain("The math has no variable with the id 'pool.c_A'.")
  })

  it('derives the mathRef from the subjects when none is given', async () => {
    const sidecar = await parseSidecar(read('wall.ttl'))
    expect(sidecar.mathRef).toBe('wall.cellml:wall')
  })

  it('reads named local entities, which are never taken for the component', async () => {
    const sidecar = await parseSidecar(read('pool.ttl'))
    expect(sidecar.mathRef).toBe('pool.cellml:pool')
    const withMath = await parseSidecar(read('pool.ttl'), { cellml: read('pool.cellml') })
    expect(withMath.warnings).toEqual([])
    expect(byVariable(withMath).area).toMatchObject({ location: 'self+GO:0005886' })
    expect(byVariable(withMath).area.entity).toEqual({ self: false, is: ['GO:0005886'], isPartOf: 'self' })
  })

  it('reads a blank-node entity the same way as a named one', async () => {
    const named = await parseSidecar(read('pool.ttl'), { mathRef: 'pool.cellml:pool', cellml: read('pool.cellml') })
    const text = read('pool.ttl').replace(
      'bqbiol:isPropertyOf local:entity_v4rjndoly .\n' +
        'local:entity_v4rjndoly bqbiol:is chebi:29101 ;\n    bqbiol:isPartOf local:entity_self .',
      'bqbiol:isPropertyOf [ bqbiol:is chebi:29101 ; bqbiol:isPartOf local:entity_self ] .'
    )
    expect(text).not.toContain('entity_v4rjndoly')
    const blank = await parseSidecar(text, { mathRef: 'pool.cellml:pool', cellml: read('pool.cellml') })
    expect(blank.warnings).toEqual([])
    expect(blank.variables).toEqual(named.variables)
  })

  it('reads a blank-node process the same way as a named one', async () => {
    const named = await parsePool(read('pool.ttl'))
    const text = read('pool.ttl').replace(
      'bqbiol:isPropertyOf local:process_v82dsevh3 .\nlocal:process_v82dsevh3 semsim:hasSinkParticipant ' +
        '[ semsim:hasPhysicalEntityReference local:Na_self ] .',
      'bqbiol:isPropertyOf [ semsim:hasSinkParticipant [ semsim:hasPhysicalEntityReference ' +
        '[ bqbiol:is chebi:29101 ; bqbiol:isPartOf local:entity_self ] ] ] .'
    )
    expect(text).not.toContain('process_v82dsevh3')
    const blank = await parsePool(text)
    expect(blank.warnings).toEqual([])
    const strip = ({ process, ...entry }) => entry
    expect(blank.variables.map(strip)).toEqual(named.variables.map(strip))
  })

  it('accepts a GO location given as bqbiol:isPartOf', async () => {
    const sidecar = await parseSidecar(
      `${POOL_HEAD}m:v4rjndoly bqbiol:isVersionOf opb:00340 ; bqbiol:isPropertyOf [ bqbiol:is chebi:29101 ; bqbiol:isPartOf go:0005737 ] .`,
      { mathRef: 'pool.cellml:pool', cellml: read('pool.cellml') }
    )
    expect(sidecar.warnings).toEqual([])
    expect(sidecar.variables[0]).toMatchObject({ species: ['CHEBI:29101'], location: 'GO:0005737' })
  })

  it('reads a named side as its GO term, the same as a bare one, its own quantities included', async () => {
    const named = await parsePool(
      `${POOL_HEAD}local:outside bqbiol:is go:0005576 .
local:inside bqbiol:is <http://purl.obolibrary.org/obo/GO_0005737> .
m:v4rjndoly bqbiol:isVersionOf opb:00340 ; bqbiol:isPropertyOf local:entity_v4rjndoly .
local:entity_v4rjndoly bqbiol:is chebi:29101 ; bqbiol:isPartOf local:outside .
m:v2f17r92n bqbiol:isVersionOf opb:00154 ; bqbiol:isPropertyOf local:outside .
m:v82dsevh3 bqbiol:isVersionOf opb:00592 ; bqbiol:isPropertyOf local:process_v82dsevh3 .
local:process_v82dsevh3 semsim:hasSourceParticipant local:source_v82dsevh3 ;
  semsim:hasSinkParticipant local:sink_v82dsevh3 .
local:source_v82dsevh3 semsim:hasPhysicalEntityReference local:entity_v82dsevh3_source .
local:entity_v82dsevh3_source bqbiol:is chebi:29101 ; bqbiol:isPartOf local:outside .
local:sink_v82dsevh3 semsim:hasPhysicalEntityReference local:entity_v82dsevh3 .
local:entity_v82dsevh3 bqbiol:is chebi:29101 ; bqbiol:isPartOf local:inside .`
    )
    const bare = await parsePool(
      `${POOL_HEAD}m:v4rjndoly bqbiol:isVersionOf opb:00340 ;
  bqbiol:isPropertyOf [ bqbiol:is chebi:29101 ; bqbiol:isPartOf go:0005576 ] .
m:v2f17r92n bqbiol:isVersionOf opb:00154 ; bqbiol:isPropertyOf [ bqbiol:is go:0005576 ] .
m:v82dsevh3 bqbiol:isVersionOf opb:00592 ; bqbiol:isPropertyOf [
  semsim:hasSourceParticipant [ semsim:hasPhysicalEntityReference [
    bqbiol:is chebi:29101 ; bqbiol:isPartOf go:0005576 ] ] ;
  semsim:hasSinkParticipant [ semsim:hasPhysicalEntityReference [
    bqbiol:is chebi:29101 ; bqbiol:isPartOf go:0005737 ] ] ] .`
    )
    expect(named.warnings).toEqual([])
    expect(bare.warnings).toEqual([])
    const project = (sidecar) =>
      sidecar.variables.map(({ variable, property, species, location, from }) => ({
        variable,
        property,
        species,
        location,
        from,
      }))
    expect(project(named)).toEqual(project(bare))
    expect(byVariable(named)).toMatchObject({
      c_A: { species: ['CHEBI:29101'], location: 'GO:0005576' },
      volume: { species: [], location: 'GO:0005576' },
      v_A: { species: ['CHEBI:29101'], location: 'GO:0005737', from: 'GO:0005576' },
    })
    expect(byVariable(named).c_A.entity.isPartOf).toBe('GO:0005576')
  })

  it('reads the module itself as self, though a transporter is part of the plasma membrane', async () => {
    const porter = read('porter.ttl').replace(
      'm:vay4adytm bqbiol:isVersionOf <http://identifiers.org/opb/OPB_00506> ;\n' +
        '    bqbiol:isPropertyOf [ bqbiol:is <http://purl.obolibrary.org/obo/GO_0005886> ] .',
      'm:vay4adytm bqbiol:isVersionOf <http://identifiers.org/opb/OPB_00506> ;\n' +
        '    bqbiol:isPropertyOf local:entity_self .'
    )
    expect(porter).toContain('isPropertyOf local:entity_self .')
    const sidecar = await parseSidecar(porter, { mathRef: 'porter.cellml:porter', cellml: read('porter.cellml') })
    expect(sidecar.warnings).toEqual([])
    expect(byVariable(sidecar).u).toMatchObject({ location: 'self', species: [] })
    expect(byVariable(sidecar).u.entity.self).toBe(true)
    expect(byVariable(sidecar).v_A_o.process.mediators).toMatchObject([{ location: 'self' }])
  })

  it('reads entities several variables share the same as the older entities of one variable each', async () => {
    const lean = await parsePool(read('pool.ttl'))
    const older = await parsePool(`${POOL_HEAD}
m:v4rjndoly bqbiol:isVersionOf opb:00340 ;
    bqbiol:isPropertyOf local:entity_v4rjndoly .
local:entity_v4rjndoly bqbiol:is chebi:29101 ;
    bqbiol:isPartOf local:entity_self .
m:v82dsevh3 bqbiol:isVersionOf opb:00592 ;
    bqbiol:isPropertyOf local:process_v82dsevh3 .
local:process_v82dsevh3 semsim:hasSinkParticipant local:sink_v82dsevh3 .
local:sink_v82dsevh3 semsim:hasPhysicalEntityReference local:entity_v82dsevh3 .
local:entity_v82dsevh3 bqbiol:is chebi:29101 ;
    bqbiol:isPartOf local:entity_self .
m:v2f17r92n bqbiol:isVersionOf opb:00154 ;
    bqbiol:isPropertyOf local:entity_self .
m:v1l1fufqx bqbiol:isVersionOf opb:00295 ;
    bqbiol:isPropertyOf local:entity_v1l1fufqx .
local:entity_v1l1fufqx bqbiol:is go:0005886 ;
    bqbiol:isPartOf local:entity_self .
`)
    expect(lean.warnings).toEqual([])
    expect(older.warnings).toEqual([])
    const project = ({ variable, property, species, location, from }) => ({
      variable,
      property,
      species,
      location,
      from,
    })
    expect(lean.variables.map(project)).toEqual(older.variables.map(project))
    const { c_A, v_A } = byVariable(lean)
    expect(v_A.process.sinks[0].entity).toBe(`${SIDECAR_BASE_IRI}pool.ttl#Na_self`)
    expect(c_A.location).toBe('self')
  })

  it('still reads an older side-car whose flows are density flow rates, OPB:00593', async () => {
    const older = await parsePool(read('pool.ttl').replace('opb:00592', 'opb:00593'))
    expect(older.warnings).toEqual([])
    expect(byVariable(older).v_A).toMatchObject({ property: 'OPB:00593', species: ['CHEBI:29101'], location: 'self' })
    expect(isMolarFlow(byVariable(older).v_A.property)).toBe(true)
  })

  it('reads a compartment’s space kind, which no role depends on', async () => {
    const text = read('pool.ttl').replace(
      'local:entity_self bqbiol:is sbo:0000290 .',
      'local:entity_self bqbiol:is sbo:0000290 ; bqbiol:isVersionOf go:0005576 .'
    )
    const spaced = await parsePool(text)
    const plain = await parsePool(read('pool.ttl'))
    expect(spaced.warnings).toEqual([])
    expect(spaced.component.spaceKind).toBe('GO:0005576')
    expect(plain.component.spaceKind).toBeNull()
    expect(spaced.variables).toEqual(plain.variables)
  })

  it('collects problems as warnings', async () => {
    const sidecar = await parseSidecar(
      `${POOL_HEAD}m:vnoprop01 bqbiol:isPropertyOf local:entity_self .
m:vnoloc001 bqbiol:isVersionOf opb:00340 ; bqbiol:isPropertyOf [ bqbiol:is chebi:29101 ] .
m:vodd00001 bqbiol:isVersionOf opb:00340 ; bqbiol:isPropertyOf [ bqbiol:is chebi:29101 , <http://identifiers.org/uniprot/P11168> ; bqbiol:isPartOf local:entity_self ] .
m:unknown_id bqbiol:isVersionOf opb:00340 ; bqbiol:isPropertyOf local:entity_self .
m:stray bqbiol:is chebi:29101 .`,
      {
        mathRef: 'pool.cellml:pool',
        cellml: read('pool.cellml').replace(
          '<variable name="t"',
          '<variable id="vnoprop01" name="no_property"/><variable id="vnoloc001" name="no_location"/>' +
            '<variable id="vodd00001" name="odd"/><variable name="t"'
        ),
      }
    )
    const messages = sidecar.warnings.map((warning) => `${warning.subject?.split('#')[1]}: ${warning.message}`)
    expect(messages).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^vnoprop01: No OPB property/),
        expect.stringMatching(/^vnoloc001: The entity has no location/),
        expect.stringMatching(/^vodd00001: Unrecognised entity terms: uniprot:P11168/),
        expect.stringMatching(/^unknown_id: The math has no variable with the id 'unknown_id'/),
        expect.stringMatching(/^stray: The subject is neither/),
      ])
    )
    expect(sidecar.warnings).toHaveLength(5)
    expect(byVariable(sidecar).odd.location).toBe('self')
  })

  it('reads a sink-only process into the module itself, and a sink that is part of it', async () => {
    const sidecar = await parsePool(
      `${POOL_HEAD}m:v82dsevh3 bqbiol:isVersionOf opb:00592 ; bqbiol:isPropertyOf local:process_v82dsevh3 .
local:process_v82dsevh3 semsim:hasSinkParticipant local:sink_v82dsevh3 .
local:sink_v82dsevh3 semsim:hasPhysicalEntityReference local:entity_self .
m:v1l1fufqx bqbiol:isVersionOf opb:00592 ; bqbiol:isPropertyOf local:process_v1l1fufqx .
local:process_v1l1fufqx semsim:hasSinkParticipant local:sink_v1l1fufqx .
local:sink_v1l1fufqx semsim:hasPhysicalEntityReference local:entity_v1l1fufqx .
local:entity_v1l1fufqx bqbiol:is go:0005886 ; bqbiol:isPartOf local:entity_self .`
    )
    expect(sidecar.warnings).toEqual([])
    expect(byVariable(sidecar).v_A).toMatchObject({ species: [], location: 'self', from: null })
    expect(byVariable(sidecar).v_A.entity.self).toBe(true)
    expect(byVariable(sidecar).area).toMatchObject({ location: 'self+GO:0005886' })
  })

  it('reads a process isVersionOf as the process’s, never as a variable', async () => {
    const sidecar = await parsePool(
      `${POOL_HEAD}m:v82dsevh3 bqbiol:isVersionOf opb:00592 ; bqbiol:isPropertyOf local:process_v82dsevh3 .
local:process_v82dsevh3 semsim:hasSinkParticipant local:sink_v82dsevh3 ; bqbiol:isVersionOf go:0005412 .
local:sink_v82dsevh3 semsim:hasPhysicalEntityReference local:entity_self .`
    )
    expect(sidecar.warnings).toEqual([])
    expect(sidecar.unresolved).toEqual([])
    expect(sidecar.variables.map((entry) => entry.variable)).toEqual(['v_A'])
    expect(byVariable(sidecar).v_A.process.isVersionOf).toEqual(['GO:0005412'])
  })

  it('warns on two sinks, leaving the flow unlocated, and on a multiplier other than 1', async () => {
    const sidecar = await parsePool(
      `${POOL_HEAD}m:v82dsevh3 bqbiol:isVersionOf opb:00592 ; bqbiol:isPropertyOf local:process_v82dsevh3 .
local:process_v82dsevh3 semsim:hasSinkParticipant local:sink_v82dsevh3 , local:sink_2 .
local:sink_v82dsevh3 semsim:hasPhysicalEntityReference local:entity_self .
local:sink_2 semsim:hasPhysicalEntityReference [ bqbiol:is go:0005737 ] .
m:v1l1fufqx bqbiol:isVersionOf opb:00592 ; bqbiol:isPropertyOf local:process_v1l1fufqx .
local:process_v1l1fufqx semsim:hasSinkParticipant [ semsim:hasPhysicalEntityReference local:entity_self ; semsim:hasMultiplier 2.0 ] .
local:sink_1 semsim:hasMultiplier 1.0 .`
    )
    const messages = sidecar.warnings.map((warning) => warning.message)
    expect(messages).toContain('Expected one sink participant, found 2.')
    expect(messages).toContain('A participant has multiplier 2; it is read as 1.')
    expect(messages).toContain('The subject is neither the component, a variable nor an entity.')
    expect(byVariable(sidecar).v_A).toMatchObject({ location: null, species: [] })
    expect(byVariable(sidecar).area).toMatchObject({ location: 'self' })
  })

  it('warns when a flow is borne by an entity or a level by a process, still reading them', async () => {
    const sidecar = await parsePool(
      `${POOL_HEAD}m:v82dsevh3 bqbiol:isVersionOf opb:00592 ; bqbiol:isPropertyOf [ bqbiol:is go:0005737 ] .
m:v4rjndoly bqbiol:isVersionOf opb:00340 ; bqbiol:isPropertyOf [ semsim:hasSinkParticipant
    [ semsim:hasPhysicalEntityReference [ bqbiol:is chebi:29101 ; bqbiol:isPartOf go:0005737 ] ] ] .`
    )
    expect(sidecar.warnings.map((warning) => warning.message)).toEqual([
      'The flow is borne by an entity, not a process.',
      'The process bears OPB:00340, not a flow.',
    ])
    expect(byVariable(sidecar).v_A.location).toBe('GO:0005737')
    expect(byVariable(sidecar).c_A).toMatchObject({ species: ['CHEBI:29101'], location: 'GO:0005737' })
  })

  it('warns when local:entity_self is missing or disagrees with the component', async () => {
    const missing = await parsePool(read('pool.ttl').replace('local:entity_self bqbiol:is sbo:0000290 .', ''))
    expect(missing.warnings.map((warning) => warning.message)).toEqual([
      'local:entity_self does not say what the module is.',
    ])
    const other = await parsePool(read('pool.ttl').replace('local:entity_self bqbiol:is sbo:0000290', 'local:entity_self bqbiol:is go:0005886'))
    expect(other.warnings.map((warning) => warning.message)).toEqual([
      'local:entity_self and the component disagree on what the module is.',
    ])
    expect(other.component.kind).toBe('compartment')
    expect(byVariable(other).volume.location).toBe('self')
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
