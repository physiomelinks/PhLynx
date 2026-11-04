import { readFileSync } from 'fs'
import { resolve } from 'path'
import { describe, expect, it } from 'vitest'
import { parseRdf } from '../../../../src/services/annotations/rdf.js'
import { SIDECAR_BASE_IRI, parseSidecar } from '../../../../src/services/annotations/sidecar.js'
import {
  buildVariableSubject,
  editSidecar,
  listOtherTriples,
  renameSidecar,
} from '../../../../src/services/annotations/sidecarEdit.js'

const TOY = resolve(__dirname, '../../fixtures/annotations/toy')
const read = (name) => readFileSync(resolve(TOY, name), 'utf8')
const TOYS = ['pool', 'porter', 'wall']
const POOL = read('pool.cellml')

/** Parses a sidecar against its toy math, keyed by variable. */
async function readToySidecar(text, name, mathRef = `${name}.cellml:${name}`) {
  const sidecar = await parseSidecar(text, { mathRef, cellml: read(`${name}.cellml`) })
  return { ...sidecar, byVariable: Object.fromEntries(sidecar.variables.map((entry) => [entry.variable, entry])) }
}

/** Variables with blank-node labels, which differ on every parse, blanked out. */
const withoutBlankLabels = (variables) =>
  JSON.parse(JSON.stringify(variables), (key, value) => (typeof value === 'string' && value.startsWith('_:') ? '_:' : value))

/** The objects of the triples editSidecar keeps as written in a porter sidecar. */
async function otherObjects(text) {
  const triples = await listOtherTriples(text, 'porter.cellml:porter', { cellml: read('porter.cellml') })
  return triples.map((t) => t.object.value)
}

/** The toy porter with its named flow in the older form: nodes named after the variable id, and a mediator. */
const OLDER_PORTER = read('porter.ttl').replace(
  /local:process_flux_in semsim:[^]*?bqbiol:isPartOf local:inside \.\n/,
  `local:process_flux_in semsim:hasSourceParticipant local:source_flux_in ;
    semsim:hasSinkParticipant local:sink_flux_in ;
    semsim:hasMediatorParticipant local:mediator_flux_in .
local:source_flux_in semsim:hasPhysicalEntityReference local:entity_flux_in_source .
local:entity_flux_in_source bqbiol:is <http://purl.obolibrary.org/obo/CHEBI_29101> ;
    bqbiol:isPartOf local:outside .
local:sink_flux_in semsim:hasPhysicalEntityReference local:entity_flux_in .
local:entity_flux_in bqbiol:is <http://purl.obolibrary.org/obo/CHEBI_29101> ;
    bqbiol:isPartOf local:inside .
local:mediator_flux_in semsim:hasPhysicalEntityReference local:entity_self .
`
)

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
    expect(withoutBlankLabels(after.variables)).toEqual(withoutBlankLabels(before.variables))
    expect(await countTriples(written)).toBe(await countTriples(text))
    expect(written.split('\n')[0]).toBe(text.split('\n')[0])
    expect(written).toContain(`@prefix m: <./${name}.cellml#> .`)
  })

  it('replaces only the edited variable, writing CURIEs', async () => {
    const written = await editSidecar(read('pool.ttl'), 'pool.cellml:pool', {
      variables: new Map([['c_A', { property: 'OPB:00340', species: ['CHEBI:29103'], location: 'GO:0005737' }]]),
      cellml: POOL,
    })
    const { byVariable, warnings } = await readToySidecar(written, 'pool')
    expect(warnings).toEqual([])
    expect(byVariable.c_A).toMatchObject({ property: 'OPB:00340', species: ['CHEBI:29103'], location: 'GO:0005737' })
    expect(byVariable.v_A).toMatchObject({ property: 'OPB:00592', species: ['CHEBI:29101'], location: 'self' })
    expect(byVariable.area.location).toBe('self+GO:0005886')
    expect(written).toContain('m:v4rjndoly bqbiol:isVersionOf opb:00340 ;\n    bqbiol:isPropertyOf local:K_in .')
    expect(written).toContain('local:K_in bqbiol:is chebi:29103 ;\n    bqbiol:isPartOf local:inside .')
    // The entity c_A shared with v_A stays for v_A.
    expect(written).toContain('local:Na_self bqbiol:is chebi:29101 ;\n    bqbiol:isPartOf local:entity_self .')
    expect(written).toContain('local:entity_self bqbiol:is sbo:0000290 .\nlocal:inside bqbiol:is go:0005737 .\n')
  })

  it.each(['pool', 'wall'])('writes the toy %s sidecar the same however often it is set', async (name) => {
    const text = read(`${name}.ttl`)
    const mathRef = `${name}.cellml:${name}`
    const cellml = read(`${name}.cellml`)
    const written = await editSidecar(text, mathRef, { cellml })
    const { variables } = await readToySidecar(text, name)
    const edits = Object.fromEntries(
      variables.map(({ variable, property, species, location }) => [variable, { property, species, location }])
    )
    const once = await editSidecar(text, mathRef, { variables: edits, cellml })
    expect(once).toBe(written)
    expect(await editSidecar(once, mathRef, { variables: edits, cellml })).toBe(once)
  })

  it('writes the toy porter sidecar the same once set, its sources and blank-node process included', async () => {
    const text = read('porter.ttl')
    const mathRef = 'porter.cellml:porter'
    const cellml = read('porter.cellml')
    const before = await readToySidecar(text, 'porter')
    const edits = Object.fromEntries(
      before.variables.map(({ variable, property, species, location, from }) => [
        variable,
        { property, species, location, from },
      ])
    )
    const once = await editSidecar(text, mathRef, { variables: edits, cellml })
    expect(await editSidecar(once, mathRef, { variables: edits, cellml })).toBe(once)
    expect(await editSidecar(once, mathRef, { cellml })).toBe(once)
    // Every entity is named and shared; only the participants are blank nodes.
    expect(once).not.toMatch(/\[ bqbiol:/)
    expect(once).toContain(
      'local:process_v4xc6r3hg semsim:hasSourceParticipant [ semsim:hasPhysicalEntityReference local:Na_in ] ;\n' +
        '    semsim:hasSinkParticipant [ semsim:hasPhysicalEntityReference local:Na_out ] .'
    )
    expect(once.match(/^local:Na_in /gm)).toHaveLength(1)
    expect(once).not.toContain('hasMediatorParticipant')
    const after = await readToySidecar(once, 'porter')
    expect(after.warnings).toEqual([])
    const flat = ({ variable, property, species, location, from }) => ({ variable, property, species, location, from })
    expect(after.variables.map(flat)).toEqual(before.variables.map(flat))
  })

  it('names a new entity after its species and place, in the sidecar’s own namespace', async () => {
    const written = await editSidecar('', 'wall.cellml:wall', {
      componentKind: 'membrane',
      variables: { u: { property: 'OPB:00506', species: ['CHEBI:29101'], location: 'self' } },
      cellml: read('wall.cellml'),
    })
    expect(written).toContain('@prefix local: <./wall.ttl#> .')
    expect(written).toContain(
      'm:vxscicnbc bqbiol:isVersionOf opb:00506 ;\n    bqbiol:isPropertyOf local:Na_self .\n' +
        'local:Na_self bqbiol:is chebi:29101 ;\n    bqbiol:isPartOf local:entity_self .'
    )
    expect(written).not.toContain('[')
    const triples = await parseRdf(written, { baseIri: SIDECAR_BASE_IRI })
    expect(triples.some((t) => t.subject.termType === 'BlankNode' || t.object.termType === 'BlankNode')).toBe(false)
  })

  it('turns an edited blank-node entity into a named one, keeping its other triples', async () => {
    const text = read('wall.ttl').replace(
      'm:vxscicnbc bqbiol:isVersionOf opb:00506 ;\n    bqbiol:isPropertyOf local:entity_self .',
      'm:vxscicnbc bqbiol:isVersionOf opb:00506 ;\n    bqbiol:isPropertyOf [ bqbiol:is go:0005886 ; <http://purl.org/dc/terms/description> "note" ] .'
    )
    const written = await editSidecar(text, 'wall.cellml:wall', {
      variables: { u: { property: 'OPB:00506', species: [], location: 'GO:0005886' } },
      cellml: read('wall.cellml'),
    })
    expect(written).toContain(
      'local:plasma_membrane bqbiol:is go:0005886 ;\n    dcterms:description "note" .'
    )
    expect(written).not.toMatch(/\[ bqbiol:/)
    const { byVariable, warnings } = await readToySidecar(written, 'wall')
    expect(warnings).toEqual([])
    expect(byVariable.u).toMatchObject({ property: 'OPB:00506', location: 'GO:0005886' })
  })

  it('writes one entity for the variables that share a species and place, and drops it once none does', async () => {
    const K_SELF = { species: ['CHEBI:29103'], location: 'self' }
    const warnings = []
    const written = await editSidecar(read('pool.ttl'), 'pool.cellml:pool', {
      variables: { c_A: { property: 'OPB:00340', ...K_SELF }, v_A: { property: 'OPB:00592', ...K_SELF } },
      cellml: POOL,
      onWarning: (message) => warnings.push(message),
    })
    expect(warnings).toEqual([])
    expect(written).not.toContain('Na_self')
    expect(written.match(/^local:K_self /gm)).toHaveLength(1)
    expect(written).toContain('m:v4rjndoly bqbiol:isVersionOf opb:00340 ;\n    bqbiol:isPropertyOf local:K_self .')
    expect(written).toContain('semsim:hasSinkParticipant [ semsim:hasPhysicalEntityReference local:K_self ]')
    const { byVariable, warnings: readWarnings } = await readToySidecar(written, 'pool')
    expect(readWarnings).toEqual([])
    expect(byVariable.c_A).toMatchObject(K_SELF)
    expect(byVariable.v_A).toMatchObject(K_SELF)
  })

  it('writes each location form back as it is read', async () => {
    const locations = { c_A: 'self', v_A: 'self+GO:0005886', volume: 'GO:0005576' }
    const variables = Object.fromEntries(
      Object.entries(locations).map(([variable, location]) => [variable, { property: 'OPB:00340', species: ['CHEBI:29101'], location }])
    )
    variables.area = { property: 'OPB:00295', species: [], location: 'self' }
    const written = await editSidecar(read('pool.ttl'), 'pool.cellml:pool', { variables, cellml: POOL })
    const { byVariable } = await readToySidecar(written, 'pool')
    for (const [variable, location] of Object.entries(locations)) expect(byVariable[variable].location).toBe(location)
    expect(byVariable.area.entity.self).toBe(true)
  })

  describe('a species in a place of the module’s own', () => {
    const MEMBRANE_NA = { property: 'OPB:00340', species: ['CHEBI:29101'], location: 'self+GO:0005886' }
    const edit = (text, variables) => editSidecar(text, 'pool.cellml:pool', { variables, cellml: POOL })

    it('is part of the shared place, local:membrane, so no node is both the species and the GO term', async () => {
      const written = await edit(read('pool.ttl'), { c_A: MEMBRANE_NA })
      expect(written).toContain(
        'local:Na_membrane bqbiol:is chebi:29101 ;\n    bqbiol:isPartOf local:membrane .\n' +
          'local:membrane bqbiol:is go:0005886 ;\n    bqbiol:isPartOf local:entity_self .'
      )
      expect(written.match(/^local:membrane /gm)).toHaveLength(1)
      const { byVariable, warnings } = await readToySidecar(written, 'pool')
      expect(warnings).toEqual([])
      expect(byVariable.c_A).toMatchObject(MEMBRANE_NA)
      expect(byVariable.c_A.entity).toEqual({ self: false, is: ['CHEBI:29101'], isPartOf: 'self+GO:0005886' })
      expect(await edit(written, { c_A: MEMBRANE_NA })).toBe(written)
      expect(await editSidecar(written, 'pool.cellml:pool', { cellml: POOL })).toBe(written)
      expect(await listOtherTriples(written, 'pool.cellml:pool', { cellml: POOL })).toEqual([])
    })

    it('reads the older single entity the same and rewrites it with a place', async () => {
      const older = read('pool.ttl').replace(
        'bqbiol:isPropertyOf local:Na_self .\n',
        'bqbiol:isPropertyOf local:entity_v4rjndoly .\n' +
          'local:entity_v4rjndoly bqbiol:is chebi:29101 , go:0005886 ;\n    bqbiol:isPartOf local:entity_self .\n'
      )
      const before = await readToySidecar(older, 'pool')
      expect(before.byVariable.c_A).toMatchObject(MEMBRANE_NA)
      const written = await edit(older, { c_A: MEMBRANE_NA })
      expect(written).toBe(await edit(read('pool.ttl'), { c_A: MEMBRANE_NA }))
      expect(written).not.toContain('chebi:29101 , go:0005886')
      expect(written).not.toContain('entity_v4rjndoly')
    })

    it('drops the place when the location or annotation changes', async () => {
      const placed = await edit(read('pool.ttl'), { c_A: MEMBRANE_NA })
      const moved = await edit(placed, { c_A: { ...MEMBRANE_NA, location: 'GO:0005737' } })
      expect(moved).not.toContain('Na_membrane')
      expect(moved).toContain('local:Na_in bqbiol:is chebi:29101 ;\n    bqbiol:isPartOf local:inside .')
      // The area still uses the place itself.
      expect(moved).toContain('local:membrane bqbiol:is go:0005886 ;')
      const cleared = await edit(placed, { c_A: null })
      expect(cleared).not.toContain('v4rjndoly')
      expect(cleared).not.toContain('Na_membrane')
      expect((await readToySidecar(cleared, 'pool')).warnings).toEqual([])
    })

    it('keeps what else a shared place holds while it is used, and warns when it goes', async () => {
      const placed = (await edit(read('pool.ttl'), { c_A: MEMBRANE_NA })).replace(
        'local:membrane bqbiol:is go:0005886 ;',
        'local:membrane bqbiol:is go:0005886 ;\n    <http://purl.org/dc/terms/description> "note" ;'
      )
      const moved = await edit(placed, { c_A: { ...MEMBRANE_NA, location: 'self+GO:0005737' } })
      expect(moved).toContain('local:Na_cytoplasm bqbiol:is chebi:29101 ;\n    bqbiol:isPartOf local:cytoplasm .')
      expect(moved).toContain('local:cytoplasm bqbiol:is go:0005737 ;')
      expect(moved).toContain('dcterms:description "note"')
      expect((await readToySidecar(moved, 'pool')).byVariable.c_A.location).toBe('self+GO:0005737')

      const warnings = []
      const gone = await editSidecar(placed, 'pool.cellml:pool', {
        variables: { c_A: { ...MEMBRANE_NA, location: 'self+GO:0005737' }, area: null },
        cellml: POOL,
        onWarning: (message) => warnings.push(message),
      })
      expect(gone).not.toMatch(/local:(Na_)?membrane/)
      expect(warnings).toEqual([
        expect.stringMatching(/^No variable uses 'local:membrane' any more, so its .*"note" was dropped\.$/),
      ])
      expect((await readToySidecar(gone, 'pool')).warnings).toEqual([])
    })

    it('keeps a link to a local node that is not a place of the module’s own', async () => {
      const handWritten =
        read('pool.ttl').replace(
          'bqbiol:isPropertyOf local:Na_self .\n',
          'bqbiol:isPropertyOf local:entity_v4rjndoly .\nlocal:entity_v4rjndoly bqbiol:is chebi:29101 ;\n' +
            '    bqbiol:isPartOf local:entity_self , local:vesicle .\n'
        ) + '\nlocal:vesicle <http://purl.org/dc/terms/description> "a vesicle" .\n'
      const warnings = []
      const written = await editSidecar(handWritten, 'pool.cellml:pool', {
        variables: { c_A: MEMBRANE_NA },
        cellml: POOL,
        onWarning: (message) => warnings.push(message),
      })
      expect(warnings).toEqual([])
      expect(written).toContain('bqbiol:isPartOf local:membrane , local:vesicle .')
      expect(written).toContain('local:vesicle dcterms:description "a vesicle" .')
    })

    it('shares a flow’s source place with the rest of the module', async () => {
      const written = await edit(read('pool.ttl'), {
        v_A: { property: 'OPB:00592', species: ['CHEBI:29101'], location: 'self', from: 'self+GO:0005886' },
      })
      expect(written).toContain(
        'local:process_v82dsevh3 semsim:hasSourceParticipant ' +
          '[ semsim:hasPhysicalEntityReference local:Na_membrane ] ;\n' +
          '    semsim:hasSinkParticipant [ semsim:hasPhysicalEntityReference local:Na_self ] .'
      )
      expect(written).toContain('local:Na_membrane bqbiol:is chebi:29101 ;\n    bqbiol:isPartOf local:membrane .')
      expect(written.match(/^local:membrane /gm)).toHaveLength(1)
      const { byVariable, warnings } = await readToySidecar(written, 'pool')
      expect(warnings).toEqual([])
      expect(byVariable.v_A).toMatchObject({ location: 'self', from: 'self+GO:0005886' })
    })

    it('leaves a place on its own and a species in a GO place as they were', async () => {
      const written = await edit(read('pool.ttl'), {
        area: { property: 'OPB:00295', species: [], location: 'self+GO:0005886' },
        volume: { property: 'OPB:00340', species: ['CHEBI:29101'], location: 'GO:0005886' },
      })
      expect(written).toContain('local:membrane bqbiol:is go:0005886 ;\n    bqbiol:isPartOf local:entity_self .')
      expect(written).toContain('local:Na_plasma_membrane bqbiol:is chebi:29101 ;\n    bqbiol:isPartOf go:0005886 .')
    })
  })

  it('clears a variable and keeps a partial entry', async () => {
    const written = await editSidecar(read('pool.ttl'), 'pool.cellml:pool', {
      variables: { volume: null, area: { property: 'OPB:00295', species: [], location: null } },
      cellml: POOL,
    })
    const { byVariable } = await readToySidecar(written, 'pool')
    expect(byVariable.volume).toBeUndefined()
    expect(byVariable.area).toMatchObject({ property: 'OPB:00295', entity: null, location: null })
    expect(written).not.toContain('go:0005886')
  })

  it('keeps unmanaged triples: other isVersionOf terms, unknown predicates and id-based subjects', async () => {
    const extra = `
m:v4y7hdahd <http://purl.org/dc/terms/description> "inside" .
m:vay4adytm bqbiol:isVersionOf <http://example.org/other> .
`
    const text = `${read('porter.ttl')}${extra}`
    const written = await editSidecar(text, 'porter.cellml:porter', {
      componentKind: 'transporter',
      transporter: 'uniprot:P11168',
      variables: {
        c_A_i: { property: 'OPB:00340', species: ['CHEBI:29103'], location: 'GO:0005737' },
        u: { property: 'OPB:00506', species: [], location: 'GO:0005886' },
      },
      cellml: read('porter.cellml'),
    })
    const { component, byVariable } = await readToySidecar(written, 'porter')
    expect(component).toMatchObject({ kind: 'transporter', is: ['uniprot:P11168'], isVersionOf: ['GO:0005412'] })
    expect(byVariable.c_A_i).toMatchObject({ species: ['CHEBI:29103'], location: 'GO:0005737' })
    expect(byVariable.v_A_i.subject).toBe(`${SIDECAR_BASE_IRI}porter.cellml#flux_in`)
    expect(byVariable.v_A_i).toMatchObject({ property: 'OPB:00592', species: ['CHEBI:29101'], location: 'GO:0005737' })
    expect(written).toContain('"inside"')
    expect(written).toContain('<http://example.org/other>')
    expect(written).toContain('local:entity_self bqbiol:is uniprot:P11168 ;\n    bqbiol:isPartOf obo:GO_0005886 .')
  })

  it('writes a transporter flow as a process from its source, with no mediator', async () => {
    const written = await editSidecar(read('porter.ttl'), 'porter.cellml:porter', {
      variables: {
        v_A_i: { property: 'OPB:00592', species: ['CHEBI:29103'], location: 'GO:0005737', from: 'GO:0005576' },
      },
      cellml: read('porter.cellml'),
    })
    const { byVariable, warnings } = await readToySidecar(written, 'porter')
    expect(warnings).toEqual([])
    expect(byVariable.v_A_i.subject).toBe(`${SIDECAR_BASE_IRI}porter.cellml#flux_in`)
    expect(byVariable.v_A_i).toMatchObject({ species: ['CHEBI:29103'], location: 'GO:0005737', from: 'GO:0005576' })
    expect(written).toContain(
      'm:flux_in bqbiol:isVersionOf opb:00592 ;\n    bqbiol:isPropertyOf local:process_flux_in .\n' +
        'local:process_flux_in semsim:hasSourceParticipant [ semsim:hasPhysicalEntityReference local:K_out ] ;\n' +
        '    semsim:hasSinkParticipant [ semsim:hasPhysicalEntityReference local:K_in ] .\n' +
        'local:K_out bqbiol:is chebi:29103 ;\n    bqbiol:isPartOf local:outside .\n' +
        'local:K_in bqbiol:is chebi:29103 ;\n    bqbiol:isPartOf local:inside .'
    )
    // The sodium entities nothing uses any more go.
    expect(written).not.toMatch(/Na_(in|out)/)
    expect(written).not.toMatch(/process_flux_in [^.]*Mediator/)
    expect(written).not.toContain('v_A_i')
    expect(written).not.toContain('Multiplier')
  })

  it('writes the source a flow is given, or none, never one of its own', async () => {
    const edit = (from) =>
      editSidecar(read('porter.ttl'), 'porter.cellml:porter', {
        variables: { v_A_o: { property: 'OPB:00592', species: ['CHEBI:29101'], location: 'GO:0005576', from } },
        cellml: read('porter.cellml'),
      })
    const none = await readToySidecar(await edit(null), 'porter')
    expect(none.warnings).toEqual([])
    expect(none.byVariable.v_A_o).toMatchObject({ location: 'GO:0005576', from: null })
    expect(none.byVariable.v_A_o.process).toMatchObject({ sources: [], mediators: [] })
    const unsaid = await readToySidecar(await edit(undefined), 'porter')
    expect(unsaid.byVariable.v_A_o).toMatchObject({ location: 'GO:0005576', from: null })
    expect(unsaid.byVariable.v_A_o.process).toMatchObject({ sources: [] })
    const cytoplasm = await readToySidecar(await edit('GO:0005737'), 'porter')
    expect(cytoplasm.byVariable.v_A_o).toMatchObject({ from: 'GO:0005737' })
    expect(await edit('GO:0005737')).toContain(
      'semsim:hasSourceParticipant [ semsim:hasPhysicalEntityReference local:Na_in ]'
    )
  })

  it('writes a compartment’s flow sink-only with no mediator, into itself or a species in it', async () => {
    const written = await editSidecar(read('pool.ttl'), 'pool.cellml:pool', {
      variables: {
        v_A: { property: 'OPB:00592', species: [], location: 'self' },
        area: { property: 'OPB:00592', species: ['CHEBI:29101'], location: 'self' },
      },
      cellml: POOL,
    })
    expect(written).toContain(
      'local:process_v82dsevh3 semsim:hasSinkParticipant [ semsim:hasPhysicalEntityReference local:entity_self ] .'
    )
    expect(written).toContain(
      'local:process_v1l1fufqx semsim:hasSinkParticipant [ semsim:hasPhysicalEntityReference local:Na_self ] .'
    )
    expect(written).not.toContain('mediator')
    expect(written).not.toContain('source')
    const { byVariable, warnings } = await readToySidecar(written, 'pool')
    expect(warnings).toEqual([])
    expect(byVariable.v_A).toMatchObject({ species: [], location: 'self' })
    expect(byVariable.area).toMatchObject({ species: ['CHEBI:29101'], location: 'self' })
  })

  it('removes a flow’s process when it becomes a level, and its whole annotation when cleared', async () => {
    const level = await editSidecar(read('porter.ttl'), 'porter.cellml:porter', {
      variables: { v_A_i: { property: 'OPB:00340', species: ['CHEBI:29101'], location: 'GO:0005737' } },
      cellml: read('porter.cellml'),
    })
    expect(level).not.toMatch(/(process|sink|source|mediator)_flux_in|entity_flux_in_source/)
    expect(level).toContain('m:flux_in bqbiol:isVersionOf opb:00340 ;\n    bqbiol:isPropertyOf local:Na_in .')
    expect(level).not.toContain('Na_out')
    expect((await readToySidecar(level, 'porter')).warnings).toEqual([])

    const cleared = await editSidecar(read('porter.ttl'), 'porter.cellml:porter', {
      variables: { v_A_i: null, v_A_o: null },
      cellml: read('porter.cellml'),
    })
    expect(cleared).not.toContain('flux_in')
    expect(cleared).not.toContain('v4xc6r3hg')
    expect(cleared).toContain('local:entity_self bqbiol:is')
    expect(cleared).not.toMatch(/Na_(in|out)/)
    const { warnings } = await readToySidecar(cleared, 'porter')
    expect(warnings).toEqual([])
  })

  // The end of the porter's named process, and a GO term to give it.
  const PROCESS_END = 'semsim:hasSinkParticipant [ semsim:hasPhysicalEntityReference local:Na_in ] .\n'
  const PROCESS_GO = 'bqbiol:isVersionOf <http://identifiers.org/GO:0005412>'

  it('keeps what else a process holds, such as its GO term, when its flow is edited', async () => {
    const text = read('porter.ttl').replace(PROCESS_END, `${PROCESS_END.slice(0, -2)} ;\n    ${PROCESS_GO} .`)
    const written = await editSidecar(text, 'porter.cellml:porter', {
      variables: { v_A_i: { property: 'OPB:00592', species: ['CHEBI:29103'], location: 'GO:0005737' } },
      cellml: read('porter.cellml'),
    })
    expect(written).toContain(
      'local:process_flux_in semsim:hasSinkParticipant [ semsim:hasPhysicalEntityReference local:K_in ] ;\n' +
        `    ${PROCESS_GO} .`
    )
    const { byVariable, warnings } = await readToySidecar(written, 'porter')
    expect(warnings).toEqual([])
    expect(byVariable.v_A_i.process.isVersionOf).toEqual(['GO:0005412'])

    const others = await listOtherTriples(text, 'porter.cellml:porter', { cellml: read('porter.cellml') })
    expect(others.some((t) => t.object.value === 'http://identifiers.org/GO:0005412' && t.subject.value.endsWith('process_flux_in'))).toBe(true)
    expect(others.some((t) => t.predicate.value.startsWith('http://bime.uw.edu/semsim/'))).toBe(false)
  })

  describe('when a flow stops being one', () => {
    const WITH_GO = read('porter.ttl').replace(PROCESS_END, `${PROCESS_END.slice(0, -2)} ;\n    ${PROCESS_GO} .`)
    const toLevel = (text, onWarning) =>
      editSidecar(text, 'porter.cellml:porter', {
        variables: { v_A_i: { property: 'OPB:00340', species: ['CHEBI:29101'], location: 'GO:0005737' } },
        cellml: read('porter.cellml'),
        onWarning,
      })

    it('drops its process’s other triples with a warning', async () => {
      const warnings = []
      const written = await toLevel(WITH_GO, (message) => warnings.push(message))
      expect(written).not.toContain('process_flux_in')
      expect(written.match(/GO:0005412/g)).toHaveLength(1)
      expect(warnings).toEqual(["'v_A_i' no longer has its process, so its bqbiol:isVersionOf GO:0005412 was dropped."])
      expect((await readToySidecar(written, 'porter')).warnings).toEqual([])
    })

    it('warns of nothing when its process held only what the editor writes', async () => {
      const warnings = []
      await toLevel(read('porter.ttl'), (message) => warnings.push(message))
      expect(warnings).toEqual([])
    })

    it('leaves its process whole while something else still references it', async () => {
      const shared = `${WITH_GO}<http://example.org/note> <http://example.org/about> local:process_flux_in .\n`
      const warnings = []
      const written = await toLevel(shared, (message) => warnings.push(message))
      expect(warnings).toEqual([])
      expect(written).toContain('bqbiol:isVersionOf <http://identifiers.org/GO:0005412>')
      expect(written).toContain('local:process_flux_in semsim:hasSourceParticipant')
      expect(written).toContain('m:flux_in bqbiol:isVersionOf opb:00340 ;\n    bqbiol:isPropertyOf local:Na_in .')
    })
  })

  it('keeps an entity with unknown triples when its variable is cleared', async () => {
    const text = read('wall.ttl').replace(
      'm:vxscicnbc bqbiol:isVersionOf opb:00506 ;\n    bqbiol:isPropertyOf local:entity_self .',
      'm:vxscicnbc bqbiol:isVersionOf opb:00506 ;\n    bqbiol:isPropertyOf [ bqbiol:is go:0005886 ; <http://purl.org/dc/terms/description> "note" ] .'
    )
    const written = await editSidecar(text, 'wall.cellml:wall', { variables: { u: null }, cellml: read('wall.cellml') })
    expect(written).toContain('"note"')
    expect(written).not.toContain('opb:00506')
    expect(written).not.toContain('go:0005886 ;')
  })

  it('starts a new sidecar', async () => {
    const written = await editSidecar('', 'wall.cellml:wall', {
      componentKind: 'membrane',
      variables: { u: { property: 'OPB:00506', species: [], location: 'self' } },
      cellml: read('wall.cellml'),
    })
    expect(written).toContain('m:wall bqbiol:is go:0005886 .')
    expect(written).toContain('m:vxscicnbc bqbiol:isVersionOf opb:00506')
    const { component, byVariable, warnings } = await readToySidecar(written, 'wall')
    expect(warnings).toEqual([])
    expect(component.kind).toBe('membrane')
    expect(byVariable.u).toMatchObject({ property: 'OPB:00506', location: 'self' })
  })

  it('changes the component kind, and local:entity_self’s with it, and removes it with null', async () => {
    const membrane = await editSidecar(read('pool.ttl'), 'pool.cellml:pool', { componentKind: 'membrane' })
    expect((await readToySidecar(membrane, 'pool')).component.is).toEqual(['GO:0005886'])
    expect(membrane).toContain('m:pool bqbiol:is go:0005886 .\nlocal:entity_self bqbiol:is go:0005886 .')
    expect((await readToySidecar(membrane, 'pool')).warnings).toEqual([])
    const none = await editSidecar(read('pool.ttl'), 'pool.cellml:pool', { componentKind: null })
    expect(none).not.toContain('sbo:')
    const transporter = await editSidecar(read('pool.ttl'), 'pool.cellml:pool', {
      componentKind: 'transporter',
      transporter: 'uniprot:P11168',
    })
    expect(transporter).toContain('local:entity_self bqbiol:is uniprot:P11168 ;\n    bqbiol:isPartOf go:0005886 .')
    const back = await editSidecar(transporter, 'pool.cellml:pool', { componentKind: 'compartment' })
    expect(back).toContain('local:entity_self bqbiol:is sbo:0000290 .')
  })

  it('puts a transporter in the plasma membrane on any save, once', async () => {
    const older = read('porter.ttl').replace(
      ' ;\n    bqbiol:isPartOf <http://purl.obolibrary.org/obo/GO_0005886> .',
      ' .'
    )
    const written = await editSidecar(older, 'porter.cellml:porter', { cellml: read('porter.cellml') })
    expect(written).toContain('local:entity_self bqbiol:is uniprot:Q0TOY1 ;\n    bqbiol:isPartOf go:0005886 .')
    expect(await editSidecar(written, 'porter.cellml:porter', { cellml: read('porter.cellml') })).toBe(written)
    expect(await otherObjects(written)).toEqual(['http://identifiers.org/GO:0005412'])
  })

  it('keeps a place of local:entity_self other than the plasma membrane when the kind changes', async () => {
    const placed = read('pool.ttl').replace(
      'local:entity_self bqbiol:is sbo:0000290 .',
      'local:entity_self bqbiol:is sbo:0000290 ;\n    bqbiol:isPartOf go:0005576 .'
    )
    const transporter = await editSidecar(placed, 'pool.cellml:pool', {
      componentKind: 'transporter',
      transporter: 'uniprot:P11168',
    })
    expect(transporter).toMatch(/local:entity_self bqbiol:is uniprot:P11168 ;\n {4}bqbiol:isPartOf go:\d+ , go:\d+ \./)
    expect(transporter).toContain('go:0005576')
    expect(transporter).toContain('go:0005886')
    const back = await editSidecar(transporter, 'pool.cellml:pool', { componentKind: 'compartment' })
    expect(back).toContain('local:entity_self bqbiol:is sbo:0000290 ;\n    bqbiol:isPartOf go:0005576 .')
  })

  describe('a compartment’s space kind', () => {
    const edit = (text, options) => editSidecar(text, 'pool.cellml:pool', { cellml: POOL, ...options })

    it('writes the kind chosen on local:entity_self, reads it back and removes it with null', async () => {
      const cytoplasm = await edit(read('pool.ttl'), { spaceKind: 'GO:0005737' })
      expect(cytoplasm).toContain('local:entity_self bqbiol:is sbo:0000290 ;\n    bqbiol:isVersionOf go:0005737 .')
      const sidecar = await readToySidecar(cytoplasm, 'pool')
      expect(sidecar.warnings).toEqual([])
      expect(sidecar.component.spaceKind).toBe('GO:0005737')
      expect(sidecar.byVariable.c_A).toMatchObject({ location: 'self' })
      expect(await edit(cytoplasm, {})).toBe(cytoplasm)
      expect(await edit(cytoplasm, { spaceKind: 'GO:0005737' })).toBe(cytoplasm)
      expect(await listOtherTriples(cytoplasm, 'pool.cellml:pool', { cellml: POOL })).toEqual([])
      const extracellular = await edit(cytoplasm, { spaceKind: 'GO:0005576' })
      expect((await readToySidecar(extracellular, 'pool')).component.spaceKind).toBe('GO:0005576')
      expect(extracellular).not.toContain('go:0005737')
      expect(await edit(cytoplasm, { spaceKind: null })).toBe(await edit(read('pool.ttl'), {}))
      expect((await readToySidecar(read('pool.ttl'), 'pool')).component.spaceKind).toBeNull()
    })

    it('is never written for another kind, and goes when the module stops being a compartment', async () => {
      const wall = await editSidecar(read('wall.ttl'), 'wall.cellml:wall', { spaceKind: 'GO:0005737' })
      expect(wall).not.toContain('isVersionOf go:0005737')
      const cytoplasm = await edit(read('pool.ttl'), { spaceKind: 'GO:0005737' })
      expect(await edit(cytoplasm, { componentKind: 'membrane' })).not.toContain('go:0005737')
    })
  })

  describe('a space next to the module', () => {
    const edit = (text, variables) =>
      editSidecar(text, 'porter.cellml:porter', { variables, cellml: read('porter.cellml') })
    const OUTSIDE_NA = { property: 'OPB:00340', species: ['CHEBI:29101'], location: 'GO:0005576' }

    it('is one named side every variable there shares, which the space’s own quantity is borne by', async () => {
      const written = await edit(read('porter.ttl'), {
        c_A_o: OUTSIDE_NA,
        u: { property: 'OPB:00154', species: [], location: 'GO:0005576' },
      })
      // The porter's flow comes from the same entity, written afresh in CURIEs.
      expect(written).toContain('local:Na_out bqbiol:is chebi:29101 ;\n    bqbiol:isPartOf local:outside .')
      expect(written.match(/^local:Na_out /gm)).toHaveLength(1)
      expect(written).toContain('m:vay4adytm bqbiol:isVersionOf opb:00154 ;\n    bqbiol:isPropertyOf local:outside .')
      expect(written.match(/^local:outside /gm)).toHaveLength(1)
      const { byVariable, warnings } = await readToySidecar(written, 'porter')
      expect(warnings).toEqual([])
      expect(byVariable.c_A_o).toMatchObject({ species: ['CHEBI:29101'], location: 'GO:0005576' })
      expect(byVariable.u).toMatchObject({ species: [], location: 'GO:0005576' })
      expect(await edit(written, { c_A_o: OUTSIDE_NA })).toBe(written)
      expect(await editSidecar(written, 'porter.cellml:porter', { cellml: read('porter.cellml') })).toBe(written)
      expect(await otherObjects(written)).toEqual(['http://identifiers.org/GO:0005412'])
    })

    it('reads the same as a bare GO term, and is written in place of one', async () => {
      const bare = await readToySidecar(read('porter.ttl'), 'porter')
      const written = await edit(read('porter.ttl'), { c_A_o: OUTSIDE_NA })
      const named = await readToySidecar(written, 'porter')
      const project = ({ property, species, location, from }) => ({ property, species, location, from })
      expect(project(named.byVariable.c_A_o)).toEqual(project(bare.byVariable.c_A_o))
      expect(written).not.toContain('<http://identifiers.org/GO:0005576>')
    })

    it('goes when nothing is there any more, and keeps the plasma membrane its GO term', async () => {
      const written = await edit(read('porter.ttl'), {
        v_A_i: null,
        j_A: { property: 'OPB:00318', species: [], location: 'GO:0005886' },
      })
      expect(written).not.toMatch(/local:(outside|inside)/)
      expect(written).toContain('local:plasma_membrane bqbiol:is go:0005886 .')
      expect((await readToySidecar(written, 'porter')).warnings).toEqual([])
    })
  })

  it('gives an older sidecar without local:entity_self one on any edit', async () => {
    const text = read('wall.ttl').replace('local:entity_self bqbiol:is go:0005886 .\n', '')
    expect((await readToySidecar(text, 'wall')).warnings).toHaveLength(1)
    const written = await editSidecar(text, 'wall.cellml:wall', { cellml: read('wall.cellml') })
    expect(written).toContain('local:entity_self bqbiol:is go:0005886 .')
    expect((await readToySidecar(written, 'wall')).warnings).toEqual([])
  })

  it('drops the other kind terms for a transporter with no accession yet, keeping its UniProt terms', async () => {
    const pool = await editSidecar(read('pool.ttl'), 'pool.cellml:pool', { componentKind: 'transporter' })
    expect(pool).not.toContain('sbo:')
    const porter = await editSidecar(read('porter.ttl'), 'porter.cellml:porter', { componentKind: 'transporter' })
    expect((await readToySidecar(porter, 'porter')).component.kind).toBe('transporter')
  })

  it('throws on a term that is not a known CURIE', async () => {
    const variables = { c_A: { property: 'OPB:00340', species: ['sodium'], location: 'GO:0005737' } }
    await expect(editSidecar(read('pool.ttl'), 'pool.cellml:pool', { variables, cellml: POOL })).rejects.toThrow(
      /not a known CURIE/
    )
  })

  it('throws on a newly annotated variable without an id, and clears one with nothing to clear', async () => {
    const variables = { t: { property: 'OPB:00402', species: [], location: 'self' } }
    await expect(editSidecar(read('pool.ttl'), 'pool.cellml:pool', { variables, cellml: POOL })).rejects.toThrow(
      "the variable 't' has no id."
    )
    const cleared = await editSidecar(read('pool.ttl'), 'pool.cellml:pool', { variables: { t: null }, cellml: POOL })
    expect(await countTriples(cleared)).toBe(await countTriples(read('pool.ttl')))
  })

  it('throws on a variable edit without the math, which its id subjects need', async () => {
    await expect(editSidecar(read('pool.ttl'), 'pool.cellml:pool', { variables: { c_A: null } })).rejects.toThrow(
      'the math is needed'
    )
  })
})

describe('renameSidecar', () => {
  it('moves the subjects to the new math, where its variables keep their ids under new names', async () => {
    const written = await renameSidecar(read('pool.ttl'), 'pool.cellml:pool', 'tank.cellml:tank')
    expect(written).toContain('@prefix m: <./tank.cellml#> .')
    expect(written).toContain('@prefix local: <./tank.ttl#> .')
    expect(written).toContain('local:Na_self')
    expect(written).not.toContain('pool')
    const tank = POOL.replace('name="pool"', 'name="tank"').replace('name="c_A"', 'name="c_B"')
    const sidecar = await parseSidecar(written, { mathRef: 'tank.cellml:tank', cellml: tank })
    expect(sidecar.warnings).toEqual([])
    const byVariable = Object.fromEntries(sidecar.variables.map((entry) => [entry.variable, entry]))
    expect(Object.keys(byVariable).sort()).toEqual(['area', 'c_B', 'v_A', 'volume'])
    expect(byVariable.c_B).toMatchObject({ property: 'OPB:00340', species: ['CHEBI:29101'], location: 'self' })
    expect(byVariable.volume.entity.self).toBe(true)
  })

  it('keeps id-based subjects and named entities under the new file', async () => {
    const written = await renameSidecar(read('porter.ttl'), 'porter.cellml:porter', 'pump.cellml:porter')
    expect(written).toContain('@prefix m: <./pump.cellml#> .')
    expect(written).toContain('m:flux_in')
    expect(written).toContain('local:process_flux_in')
    expect(written).toContain('m:vay4adytm')
    expect(await countTriples(written)).toBe(await countTriples(read('porter.ttl')))
  })

  it('renames a process after a renamed id, leaving the shared entities as they are', async () => {
    const ids = new Map([['flux_in', 'vnewflux1'], ['vp3vtnv5k', 'vnewcharg']])
    const written = await renameSidecar(read('porter.ttl'), 'porter.cellml:porter', 'porter.cellml:porter', { ids })
    expect(written).not.toMatch(/flux_in|vp3vtnv5k/)
    expect(written).toContain('local:process_vnewflux1 semsim:hasSourceParticipant')
    expect(written).toContain('local:process_vnewcharg semsim:hasSinkParticipant')
    expect(written).toContain('local:Na_in bqbiol:is obo:CHEBI_29101 ;\n    bqbiol:isPartOf local:inside .')
    const math = read('porter.cellml')
      .replace('id="flux_in"', 'id="vnewflux1"')
      .replace('id="vp3vtnv5k"', 'id="vnewcharg"')
    const sidecar = await parseSidecar(written, { mathRef: 'porter.cellml:porter', cellml: math })
    expect(sidecar.warnings).toEqual([])
    expect(sidecar.variables.find((entry) => entry.variable === 'v_A_i')).toMatchObject({ from: 'GO:0005576' })
  })

  it('renames the older local nodes named after a renamed id', async () => {
    const ids = new Map([['flux_in', 'vnewflux1'], ['vp3vtnv5k', 'vnewcharg']])
    const written = await renameSidecar(OLDER_PORTER, 'porter.cellml:porter', 'porter.cellml:porter', { ids })
    expect(written).not.toContain('flux_in')
    expect(written).not.toContain('vp3vtnv5k')
    for (const name of ['process', 'sink', 'source', 'mediator', 'entity']) expect(written).toContain(`local:${name}_vnewflux1`)
    expect(written).toContain('local:entity_vnewflux1_source')
    expect(written).toContain('local:entity_self')
    const math = read('porter.cellml').replace('id="flux_in"', 'id="vnewflux1"').replace('id="vp3vtnv5k"', 'id="vnewcharg"')
    const sidecar = await parseSidecar(written, { mathRef: 'porter.cellml:porter', cellml: math })
    expect(sidecar.warnings).toEqual([])
    expect(sidecar.variables.find((entry) => entry.variable === 'v_A_i')).toMatchObject({ from: 'GO:0005576' })
  })

  it('leaves the sides as they are, the module’s and named after no id, moving them with the module', async () => {
    const ids = new Map([['flux_in', 'vnewflux1'], ['outside', 'vother']])
    const written = await renameSidecar(read('porter.ttl'), 'porter.cellml:porter', 'channel.cellml:channel', { ids })
    expect(written).toContain('@prefix local: <./channel.ttl#> .')
    expect(written).toContain('local:outside bqbiol:is obo:GO_0005576 .\nlocal:inside bqbiol:is go:0005737 .')
    expect(written).toContain('local:Na_out bqbiol:is obo:CHEBI_29101 ;\n    bqbiol:isPartOf local:outside .')
    expect(written).toContain('local:Na_in bqbiol:is obo:CHEBI_29101 ;\n    bqbiol:isPartOf local:inside .')
    expect(written).toContain('local:process_vnewflux1')
    const math = read('porter.cellml').replace('name="porter"', 'name="channel"').replace('id="flux_in"', 'id="vnewflux1"')
    const sidecar = await parseSidecar(written, { mathRef: 'channel.cellml:channel', cellml: math })
    expect(sidecar.warnings).toEqual([])
    expect(sidecar.variables.find((entry) => entry.variable === 'v_A_i')).toMatchObject({
      location: 'GO:0005737',
      from: 'GO:0005576',
    })
  })

  it('keeps the names of the shared places and entities, which name no id', async () => {
    const placed = await editSidecar(read('pool.ttl'), 'pool.cellml:pool', {
      variables: {
        c_A: { property: 'OPB:00340', species: ['CHEBI:29101'], location: 'self+GO:0005886' },
        v_A: { property: 'OPB:00592', species: ['CHEBI:29101'], location: 'self', from: 'self+GO:0005886' },
      },
      cellml: POOL,
    })
    const ids = new Map([['v4rjndoly', 'vnewconc1'], ['v82dsevh3', 'vnewflow1']])
    const written = await renameSidecar(placed, 'pool.cellml:pool', 'pool.cellml:pool', { ids })
    expect(written).toContain('local:Na_membrane bqbiol:is chebi:29101 ;\n    bqbiol:isPartOf local:membrane .')
    expect(written).toContain('local:membrane bqbiol:is go:0005886 ;')
    expect(written).toContain('local:process_vnewflow1 semsim:hasSourceParticipant')
    expect(written).not.toMatch(/v4rjndoly|v82dsevh3/)
    const math = POOL.replace('id="v4rjndoly"', 'id="vnewconc1"').replace('id="v82dsevh3"', 'id="vnewflow1"')
    const sidecar = await parseSidecar(written, { mathRef: 'pool.cellml:pool', cellml: math })
    expect(sidecar.warnings).toEqual([])
    const byVariable = Object.fromEntries(sidecar.variables.map((entry) => [entry.variable, entry]))
    expect(byVariable.c_A.location).toBe('self+GO:0005886')
    expect(byVariable.v_A.from).toBe('self+GO:0005886')
  })

  it('leaves an empty sidecar as is', async () => {
    expect(await renameSidecar(null, 'a.cellml:a', 'b.cellml:b')).toBeNull()
  })
})

describe('buildVariableSubject', () => {
  it('names a variable by its id as editSidecar does, in the sidecar’s own file when given', () => {
    const subject = buildVariableSubject('my file.cellml:pool', 'v4rjndoly')
    expect(subject).toBe(`${SIDECAR_BASE_IRI}my%20file.cellml#v4rjndoly`)
    expect(buildVariableSubject('a.cellml:pool', 'v4rjndoly', 'b.cellml')).toBe(`${SIDECAR_BASE_IRI}b.cellml#v4rjndoly`)
  })
})

describe('listOtherTriples', () => {
  it.each(TOYS)('finds nothing editSidecar would replace in the toy %s sidecar', async (name) => {
    const text = read(`${name}.ttl`)
    const mathRef = `${name}.cellml:${name}`
    const others = await listOtherTriples(text, mathRef, { cellml: read(`${name}.cellml`) })
    const cleared = await editSidecar(text, mathRef, {
      componentKind: null,
      variables: Object.fromEntries((await readToySidecar(text, name)).variables.map(({ variable }) => [variable, null])),
      cellml: read(`${name}.cellml`),
    })
    expect(others.length).toBe(await countTriples(cleared))
  })

  it('lists other predicates and terms, and nothing for an empty sidecar', async () => {
    const text = `${read('pool.ttl')}\n<./pool.cellml#pool> <http://purl.org/dc/terms/description> "A pool" .\n`
    const others = await listOtherTriples(text, 'pool.cellml:pool')
    expect(others.map((t) => t.object.value)).toContain('A pool')
    expect(await listOtherTriples('', 'pool.cellml:pool')).toEqual([])
  })
})
