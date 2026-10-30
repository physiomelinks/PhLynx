import { beforeAll, describe, expect, it } from 'vitest'
import {
  aggregatorVariables,
  asBoundaryConditions,
  findBindingNode,
  holdAtZero,
  isHeldAtZero,
  layoutByRank,
  matchSidecarToMath,
  moduleCandidates,
  planInstances,
  rdfFormatOf,
  readSidecarComponent,
  suitsCoord,
  suppliedVariables,
} from '../../../../src/services/annotations/generate.js'
import { parseApiCoords } from '../../../../src/services/annotations/apicoord.js'
import { loadToy, readToy } from './toyModel.js'

const MATHS = ['pool.cellml:pool', 'porter.cellml:porter', 'wall.cellml:wall']

// A second transporter with the porter's protein, so a deployment of it has two candidate modules.
const RIVAL = `
@prefix bqbiol: <http://biomodels.net/biology-qualifiers/> .
@prefix uniprot: <http://identifiers.org/uniprot/> .
@prefix m: <./rival.cellml#> .
m:rival bqbiol:is uniprot:Q0TOY1 .
`

describe('generate', () => {
  let toy, modules

  beforeAll(async () => {
    toy = await loadToy()
    modules = await Promise.all(
      ['pool', 'porter', 'wall'].map(async (name) => {
        const component = await readSidecarComponent(readToy(`${name}.ttl`))
        return { mathRef: component.mathRef, is: component.is, sidecar: toy.sidecars.get(name) }
      })
    )
  })

  it('reads the annotated component of a sidecar, ignoring entities with bqbiol:is', async () => {
    // porter.ttl also has a named entity with CHEBI and GO terms.
    expect(await readSidecarComponent(readToy('porter.ttl'))).toEqual({
      file: 'porter.cellml',
      componentName: 'porter',
      mathRef: 'porter.cellml:porter',
      kind: 'transporter',
      is: ['uniprot:Q0TOY1'],
    })
    expect((await readSidecarComponent(readToy('wall.ttl'))).kind).toBe('membrane')
    expect(await readSidecarComponent('@prefix m: <./x.cellml#> . m:x m:y m:z .')).toBeNull()
    await expect(readSidecarComponent('not turtle')).rejects.toThrow()
  })

  it('matches a sidecar to its math by file#component, else offers maths of the same component', () => {
    const component = { mathRef: 'porter.cellml:porter', componentName: 'porter' }
    expect(matchSidecarToMath(component, MATHS)).toEqual({
      mathRef: 'porter.cellml:porter',
      candidates: ['porter.cellml:porter'],
      isExact: true,
    })
    expect(matchSidecarToMath(component, ['Lib.cellml:porter', 'pool.cellml:pool'])).toEqual({
      mathRef: 'Lib.cellml:porter',
      candidates: ['Lib.cellml:porter'],
      isExact: false,
    })
    // A math of another component would annotate nothing, so none is offered.
    expect(matchSidecarToMath({ mathRef: 'x.cellml:x', componentName: 'x' }, MATHS)).toEqual({
      mathRef: null,
      candidates: [],
      isExact: false,
    })
  })

  it('makes the readers and sums of a sidecar boundary conditions, keeping their values', () => {
    const pool = toy.sidecars.get('pool')
    const porter = toy.sidecars.get('porter')
    expect(suppliedVariables(pool)).toEqual(['v_A'])
    expect(suppliedVariables(porter).sort()).toEqual(['area', 'c_A_i', 'c_A_o', 'u'])
    const rows = [
      { name: 'c_A_i', type: 'constant', value: '' },
      { name: 'area', type: 'constant', value: '1e-3' },
      { name: 'u', type: 'global_constant' },
      { name: 'j_A', type: 'variable' },
      { name: 'k', type: 'constant', value: '2' },
    ]
    expect(asBoundaryConditions(rows, suppliedVariables(porter)).map(({ type, value }) => [type, value])).toEqual([
      ['boundary_condition', ''],
      ['boundary_condition', '1e-3'],
      ['global_constant', undefined],
      ['variable', undefined],
      ['constant', '2'],
    ])
  })

  it('chooses a module per coordinate kind', () => {
    const byName = new Map(toy.instances.map((instance) => [instance.name, instance.coord]))
    expect(moduleCandidates(byName.get('outside'), modules)).toEqual(['pool.cellml:pool'])
    expect(moduleCandidates(byName.get('cell'), modules)).toEqual(['pool.cellml:pool'])
    expect(moduleCandidates(byName.get('vessel'), modules)).toEqual(['pool.cellml:pool'])
    expect(moduleCandidates(byName.get('wall'), modules)).toEqual(['wall.cellml:wall'])
    // Two deployments share one module; the second names its protein with another IRI form.
    expect(moduleCandidates(byName.get('porter_in'), modules)).toEqual(['porter.cellml:porter'])
    expect(moduleCandidates(byName.get('porter_out'), modules)).toEqual(['porter.cellml:porter'])
    expect(suitsCoord({ kind: 'scope' }, ['SBO:0000290'])).toBe(false)
  })

  it('plans each instance with its kind, rank and module, two of them on one module', () => {
    const rows = planInstances({ instances: toy.instances, modules })
    expect(rows.map(({ name, kind, rank, mathRef, nodeId, heldConstant }) => ({ name, kind, rank, mathRef, nodeId, heldConstant }))).toEqual([
      { name: 'outside', kind: 'layer', rank: 0, mathRef: 'pool.cellml:pool', nodeId: null, heldConstant: false },
      { name: 'cell', kind: 'cell', rank: 2, mathRef: 'pool.cellml:pool', nodeId: null, heldConstant: false },
      { name: 'wall', kind: 'facet-layer', rank: 2, mathRef: 'wall.cellml:wall', nodeId: null, heldConstant: false },
      { name: 'porter_in', kind: 'deployment', rank: 1, mathRef: 'porter.cellml:porter', nodeId: null, heldConstant: false },
      { name: 'porter_out', kind: 'deployment', rank: 3, mathRef: 'porter.cellml:porter', nodeId: null, heldConstant: false },
      { name: 'vessel', kind: 'lyph', rank: 4, mathRef: 'pool.cellml:pool', nodeId: null, heldConstant: false },
    ])
  })

  it('leaves an ambiguous module for the user and an unmatched one unresolved', async () => {
    const rival = await readSidecarComponent(RIVAL)
    const withRival = [...modules, { mathRef: rival.mathRef, is: rival.is, sidecar: null }]
    const porter = planInstances({ instances: toy.instances, modules: withRival }).find((row) => row.name === 'porter_in')
    expect(porter.candidates).toEqual(['porter.cellml:porter', 'rival.cellml:rival'])
    expect(porter.mathRef).toBeNull()

    const { instances } = await parseApiCoords(
      readToy('toy-apicoords.ttl').replace('api:protein uniprot:Q0TOY1', 'api:protein uniprot:Q0NONE')
    )
    const unmatched = planInstances({ instances, modules }).find((row) => row.name === 'porter_in')
    expect(unmatched).toMatchObject({ candidates: [], mathRef: null })
    expect(planInstances({ instances: toy.instances, modules: [] }).every((row) => row.mathRef === null)).toBe(true)
  })

  it('binds by ApiCoord subject first, then by the name of an unbound node, once each', () => {
    const subject = toy.instances.find((instance) => instance.name === 'cell').subject
    const nodes = [
      { id: 'a', data: { name: 'renamed', mathRef: 'pool.cellml:pool', apiCoord: { subject } } },
      { id: 'b', data: { name: 'cell', mathRef: 'pool.cellml:pool' } },
      { id: 'c', data: { name: 'outside', mathRef: 'pool.cellml:pool', apiCoord: { subject: 'elsewhere' } } },
      { id: 'd', data: { name: 'wall', mathRef: 'pool.cellml:pool' } },
    ]
    expect(findBindingNode({ name: 'cell', subject }, nodes)?.id).toBe('a')
    expect(findBindingNode({ name: 'cell', subject }, nodes, new Set(['a']))?.id).toBe('b')
    // A node bound elsewhere is never taken by name.
    expect(findBindingNode({ name: 'outside', subject: 'x' }, nodes)).toBeNull()

    const rows = planInstances({ instances: toy.instances, modules, nodes })
    const row = (name) => rows.find((candidate) => candidate.name === name)
    expect(row('cell')).toMatchObject({ nodeId: 'a', nodeName: 'renamed', mathRef: 'pool.cellml:pool' })
    expect(row('outside').nodeId).toBeNull()
    // The existing node keeps its own module.
    expect(row('wall')).toMatchObject({ nodeId: 'd', candidates: ['pool.cellml:pool'], mathRef: 'pool.cellml:pool' })
  })

  it('pre-ticks held constant on an existing node whose aggregators are constant 0 already', () => {
    const pool = toy.sidecars.get('pool')
    expect(aggregatorVariables(pool)).toEqual(['v_A'])
    expect(aggregatorVariables(toy.sidecars.get('wall'))).toEqual(['i_tot'])
    expect(aggregatorVariables(toy.sidecars.get('porter'))).toEqual([])

    const rows = (variables) => [{ name: 'c_A', type: 'constant', value: '1' }, ...variables]
    expect(isHeldAtZero(rows([{ name: 'v_A', type: 'constant', value: '0' }]), ['v_A'])).toBe(true)
    expect(isHeldAtZero(rows([{ name: 'v_A', type: 'constant', value: 0 }]), ['v_A'])).toBe(true)
    expect(isHeldAtZero(rows([{ name: 'v_A', type: 'constant', value: '' }]), ['v_A'])).toBe(false)
    expect(isHeldAtZero(rows([{ name: 'v_A', type: 'variable', value: null }]), ['v_A'])).toBe(false)
    expect(isHeldAtZero(rows([]), [])).toBe(false)

    const outside = toy.instances.find((instance) => instance.name === 'outside')
    const nodes = [
      { id: 'n', data: { name: 'outside', mathRef: 'pool.cellml:pool', variables: rows([{ name: 'v_A', type: 'constant', value: '0' }]) } },
    ]
    expect(planInstances({ instances: [outside], modules, nodes })[0].heldConstant).toBe(true)
    nodes[0].data.variables = rows([{ name: 'v_A', type: 'boundary_condition', value: null }])
    expect(planInstances({ instances: [outside], modules, nodes })[0].heldConstant).toBe(false)
    nodes[0].data.annotationOverlay = { heldConstant: true }
    expect(planInstances({ instances: [outside], modules, nodes })[0].heldConstant).toBe(true)
  })

  it('holds the named rows at constant 0 and keeps the others', () => {
    const rows = [
      { name: 'v_A', type: 'variable', value: null, units: 'u' },
      { name: 'c_A', type: 'constant', value: '2' },
    ]
    expect(holdAtZero(rows, ['v_A'])).toEqual([
      { name: 'v_A', type: 'constant', value: '0', units: 'u' },
      { name: 'c_A', type: 'constant', value: '2' },
    ])
    expect(rows[0].type).toBe('variable')
  })

  it('lays new instances out in rank columns right of the existing nodes', () => {
    const rows = [
      { name: 'outside', rank: 0 },
      { name: 'porter_in', rank: 1 },
      { name: 'cell', rank: 2 },
      { name: 'wall', rank: 2 },
      { name: 'vessel', rank: 4 },
    ]
    const empty = layoutByRank(rows)
    expect(empty.get('outside')).toEqual({ x: 0, y: 0 })
    expect(empty.get('porter_in')).toEqual({ x: 320, y: 0 })
    expect(empty.get('wall')).toEqual({ x: 640, y: 180 })
    expect(empty.get('vessel')).toEqual({ x: 960, y: 0 })

    const existing = [{ position: { x: 100, y: 50 }, dimensions: { width: 200, height: 80 } }]
    expect(layoutByRank(rows, existing).get('outside')).toEqual({ x: 460, y: 50 })
  })

  it('reads RDF/XML for .rdf files, else Turtle', () => {
    expect(rdfFormatOf('coords.rdf')).toBe('rdfxml')
    expect(rdfFormatOf('coords.TTL')).toBe('turtle')
    expect(rdfFormatOf(undefined)).toBe('turtle')
  })
})
