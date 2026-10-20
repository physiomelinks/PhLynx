// @vitest-environment happy-dom
import { useVueFlow } from '@vue-flow/core'
import { toRaw } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const notify = vi.hoisted(() => ({ warning: vi.fn() }))
vi.mock('../../../src/utils/notify', () => ({ notify }))
// How many times the model's boundary values are resolved.
const boundary = vi.hoisted(() => ({ resolves: 0 }))
vi.mock('../../../src/services/export/boundaryValues', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, resolveBoundaryValues: (...args) => (boundary.resolves++, actual.resolveBoundaryValues(...args)) }
})

const { useModelWriter } = await import('../../../src/composables/useModelWriter.js')
const { FLOW_IDS } = await import('../../../src/utils/constants.js')
const { useModelGraph } = await import('../../../src/composables/useModelGraph.js')
const { applyParametersToModel } = await import('../../../src/utils/parameters.js')
const { connect, constant, exposed, exposures, module, port, superInstance, supermodule } = await import('../fixtures/hierarchy/graph.js')

const rows = () => [{ ...constant('R', '1'), data_reference: 'ref' }, constant('C', '2')]
const vessel = (localId, name, options = {}) =>
  module(localId, name, {
    ports: [port('entrance_ports', 'vessel', ['v_in']), port('exit_ports', 'vessel', ['v'])],
    variables: rows(),
    ...options,
  })

/**
 * Root a → leg → b, leg a super instance of limb (sm_1: art → bed), bed one of bedsm (sm_2: cap), and a second super instance
 * of limb, arm, connected to nothing.
 */
function legGraph() {
  const cap = vessel('cap', 'cap', { scope: 'sm_2' })
  const bedsm = supermodule('sm_2', 'bedsm', { submoduleOrder: ['cap'] })
  const bedExposure = exposures('sm_2', [exposed('xp_in', 'cap', 'entrance_ports', 'vessel'), exposed('xp_out', 'cap', 'exit_ports', 'vessel')])
  const art = vessel('art', 'art', { scope: 'sm_1' })
  const bed = superInstance({ nodes: [bedsm, cap], edges: bedExposure }, 'bed', 'bed', 'sm_2', { scope: 'sm_1', overrides: { cap: { R: { value: '2' } } } })
  const limb = supermodule('sm_1', 'limb', { submoduleOrder: ['art', 'bed'] })
  const exposure = [
    ...exposures('sm_1', [exposed('xp_a', 'art', 'entrance_ports', 'vessel'), exposed('xp_b', 'bed', 'exit_ports', 'vessel', { via: 'xp_out' })]),
    ...bedExposure,
  ]
  const store = { nodes: [limb, art, bed, bedsm, cap], edges: exposure }
  const leg = superInstance(store, 'dndnode_1', 'leg', 'sm_1')
  const arm = superInstance(store, 'dndnode_3', 'arm', 'sm_1')
  const [a, b] = [vessel('dndnode_0', 'a'), vessel('dndnode_2', 'b')]
  const used = new Set()
  return {
    nodes: [a, leg, b, arm, ...store.nodes],
    edges: [connect(a, leg, { used, id: 'e0' }), connect(leg, b, { used, id: 'e1' }), connect(art, bed, { id: 'e2' }), ...exposure],
  }
}

describe('useModelWriter', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  const { graph } = useModelGraph()
  const { writeValue, writeVariables, resetOverride, removeOverride, recordTargetOf, provenanceOf, aggregateProvenanceOf, overridesOf } = useModelWriter()
  const show = ({ nodes, edges }) => {
    flow.edges.value = []
    flow.nodes.value = []
    flow.addNodes(nodes)
    flow.addEdges(edges)
  }
  const valueOf = (modelId, name) => graph.value.nodes.find((node) => node.id === modelId).data.variables.find((row) => row.name === name).value

  beforeEach(() => {
    notify.warning.mockClear()
    show({ nodes: [module('a', 'a', { variables: rows() })], edges: [] })
  })

  it('writes a root module’s row to its node, leaving its other rows and fields', () => {
    const before = flow.findNode('a').data
    const written = writeValue('a', 'R', { value: '5' })
    const after = flow.findNode('a').data
    expect(after.variables).toEqual([{ ...constant('R', '5'), data_reference: 'ref' }, constant('C', '2')])
    expect(written).toBe(toRaw(after.variables))
    // Through updateNodeData, which puts in a new data object.
    expect(after).not.toBe(before)
    expect(after.name).toBe('a')
    expect(recordTargetOf('a')).toEqual({ nodeIds: ['a'], keys: ['variables'] })
  })

  it('writes all of a root module’s rows', () => {
    const variables = [constant('R', '3')]
    expect(writeVariables('a', variables, { target: 'supermodule' })).toBe(variables)
    expect(toRaw(flow.findNode('a').data.variables)).toBe(variables)
  })

  describe('inside super instances', () => {
    beforeEach(() => show(legGraph()))

    it('writes for this super instance an override on the outermost one, keyed by the path below it, which wins', () => {
      expect(valueOf('dndnode_1/bed/cap', 'R')).toBe('2')
      expect(recordTargetOf('dndnode_1/bed/cap')).toEqual({ nodeIds: ['dndnode_1'], keys: ['overrides'] })
      const written = writeValue('dndnode_1/bed/cap', 'R', { value: '7', type: 'boundary_condition' })
      expect(flow.findNode('dndnode_1').data.overrides).toEqual({ 'bed/cap': { R: { value: '7' } } })
      expect(written.find((row) => row.name === 'R')).toMatchObject({ value: '7', type: 'constant' })
      // Outermost wins over bed's own override; arm and the super-module are untouched.
      expect(valueOf('dndnode_1/bed/cap', 'R')).toBe('7')
      expect(valueOf('dndnode_3/bed/cap', 'R')).toBe('2')
      expect(flow.findNode('sm_2~cap').data.variables).toEqual(rows())
      expect(notify.warning).not.toHaveBeenCalled()
    })

    it('writes the super-module’s default to its child, for every super instance not overriding it', () => {
      writeValue('dndnode_1/art', 'R', { value: '9' }, { target: 'supermodule' })
      expect(recordTargetOf('dndnode_1/art', { target: 'supermodule' })).toEqual({ nodeIds: ['sm_1~art'], keys: ['variables'] })
      expect(flow.findNode('sm_1~art').data.variables[0].value).toBe('9')
      expect(valueOf('dndnode_1/art', 'R')).toBe('9')
      expect(valueOf('dndnode_3/art', 'R')).toBe('9')
      writeValue('dndnode_3/art', 'R', { value: '4' })
      writeValue('dndnode_1/art', 'R', { value: '1' }, { target: 'supermodule' })
      expect(valueOf('dndnode_1/art', 'R')).toBe('1')
      expect(valueOf('dndnode_3/art', 'R')).toBe('4')
    })

    it('clears an override that sets what the module has anyway, and resets one', () => {
      writeValue('dndnode_1/bed/cap', 'R', { value: '7' })
      writeValue('dndnode_1/bed/cap', 'R', { value: '2' })
      expect(flow.findNode('dndnode_1').data.overrides).toEqual({})
      writeValue('dndnode_1/art', 'C', { value: '8' })
      expect(resetOverride('dndnode_1/art', 'C').find((row) => row.name === 'C').value).toBe('2')
      expect(flow.findNode('dndnode_1').data.overrides).toEqual({})
      expect(resetOverride('a', 'R')).toBeNull()
    })

    it('writes the values of all of a module’s rows that differ, as overrides', () => {
      const variables = graph.value.nodes.find((node) => node.id === 'dndnode_1/art').data.variables.map((row) => (row.name === 'C' ? { ...row, value: '6' } : row))
      writeVariables('dndnode_1/art', variables)
      expect(flow.findNode('dndnode_1').data.overrides).toEqual({ art: { C: { value: '6' } } })
    })

    it('says where a value comes from, here and across a super-module’s copies, and lists overrides', () => {
      writeValue('dndnode_1/art', 'C', { value: '8' })
      expect(provenanceOf('dndnode_1/art').get('C')).toMatchObject({ value: '8', inherited: '2', chip: 'overridden' })
      expect(provenanceOf('dndnode_3/art').get('C')).toMatchObject({ value: '2', chip: 'default' })
      expect(aggregateProvenanceOf('sm_1~art').get('C')).toMatchObject({ total: 2, overridden: 1 })
      expect(overridesOf('dndnode_1')).toEqual([{ key: 'art', path: 'art', variable: 'C', value: '8', isOrphaned: false }])
    })

    it('resolves the model’s boundary values once for every value shown from it, and again once it changes', () => {
      provenanceOf('dndnode_1/art')
      boundary.resolves = 0
      provenanceOf('dndnode_1/art')
      provenanceOf('dndnode_3/art')
      aggregateProvenanceOf('sm_1~art')
      expect(boundary.resolves).toBe(0)

      writeValue('dndnode_1/art', 'C', { value: '8' })
      expect(provenanceOf('dndnode_1/art').get('C')).toMatchObject({ value: '8', chip: 'overridden' })
      provenanceOf('dndnode_3/art')
      expect(boundary.resolves).toBe(1)
    })

    it('removes an override by its key, an orphaned one too', () => {
      flow.updateNodeData('dndnode_1', { overrides: { gone: { R: { value: '1' } }, art: { R: { value: '3' }, C: { value: '4' } } } })
      expect(removeOverride('dndnode_1', 'gone', 'R')).toBe(true)
      expect(removeOverride('dndnode_1', 'art', 'R')).toBe(true)
      expect(removeOverride('dndnode_1', 'art', 'R')).toBe(false)
      expect(flow.findNode('dndnode_1').data.overrides).toEqual({ art: { C: { value: '4' } } })
    })

    it('writes a super-module’s module, edited on its own, only as the super-module’s default', () => {
      expect(writeValue('sm_1~art', 'R', { value: '5' })).toBeNull()
      expect(notify.warning).toHaveBeenCalledWith(expect.objectContaining({ title: 'Value Not Set' }))
      expect(recordTargetOf('sm_1~art')).toEqual({ nodeIds: [], keys: [] })
      writeValue('sm_1~art', 'R', { value: '5' }, { target: 'supermodule' })
      expect(flow.findNode('sm_1~art').data.variables[0].value).toBe('5')
    })

    it('writes a parameters file’s rows as the workspace loads it, those inside super instances as overrides', () => {
      const row = (variable_name, value) => ({ variable_name, units: 'dimensionless', value, data_reference: 'file' })
      const { variablesById } = applyParametersToModel(graph.value, [row('R_a', '5'), row('R_leg__bed__cap', '7')])
      // As WorkspaceArea's loadParametersData writes them.
      for (const [id, variables] of variablesById) writeVariables(id, variables)

      expect(flow.findNode('dndnode_0').data.variables[0]).toMatchObject({ name: 'R', value: '5', data_reference: 'file' })
      expect(flow.findNode('dndnode_1').data.overrides).toEqual({ 'bed/cap': { R: { value: '7' } } })
      expect(flow.findNode('sm_2~cap').data.variables).toEqual(rows())
      expect(notify.warning).not.toHaveBeenCalled()
    })
  })

  it('writes nothing to a node that isn’t there, or for an unknown target', () => {
    expect(writeValue('gone', 'R', { value: '5' })).toBeNull()
    expect(notify.warning).not.toHaveBeenCalled()
    expect(() => writeValue('a', 'R', { value: '5' }, { target: 'elsewhere' })).toThrow('Unknown write target')
  })
})

describe('useModelWriter on rows bound to local constants', () => {
  const flow = useVueFlow(FLOW_IDS.MAIN)
  const { graph } = useModelGraph()
  const { writeValue, resetOverride, recordTargetOf, provenanceOf } = useModelWriter()
  const local = { name: 'k', type: 'local_constant', value: '', units: 'dimensionless' }
  const valueOf = (modelId) => graph.value.nodes.find((node) => node.id === modelId).data.variables.find((row) => row.name === 'k').value

  beforeEach(() => {
    const p = vessel('p', 'p', { scope: 'sm_1', variables: [{ ...local }] })
    const sm = supermodule('sm_1', 'segment', { submoduleOrder: ['p'], localConstants: [{ name: 'k', units: 'dimensionless', value: '3' }] })
    const seg = superInstance([sm, p], 'dndnode_1', 'seg', 'sm_1')
    flow.edges.value = []
    flow.nodes.value = []
    flow.addNodes([seg, sm, p])
  })

  it('writes this super instance’s value as its override under @, and resets it', () => {
    expect(recordTargetOf('dndnode_1/p', { variable: 'k', patch: { value: '5' } })).toEqual({ nodeIds: ['dndnode_1'], keys: ['overrides'] })
    writeValue('dndnode_1/p', 'k', { value: '5', type: 'local_constant' })
    expect(flow.findNode('dndnode_1').data.overrides).toEqual({ '@': { k: { value: '5' } } })
    expect(valueOf('dndnode_1/p')).toBe('5')
    expect(provenanceOf('dndnode_1/p').get('k')).toMatchObject({ chip: 'overridden', inherited: '3' })
    // The super-module's own value clears it.
    writeValue('dndnode_1/p', 'k', { value: '3' })
    expect(flow.findNode('dndnode_1').data.overrides).toEqual({})
    writeValue('dndnode_1/p', 'k', { value: '5' })
    resetOverride('dndnode_1/p', 'k')
    expect(valueOf('dndnode_1/p')).toBe('3')
    expect(flow.findNode('sm_1~p').data.variables[0]).toEqual(local)
  })

  it('writes the super-module’s default to the declaration, and a change of type to the row', () => {
    expect(recordTargetOf('dndnode_1/p', { target: 'supermodule', variable: 'k' })).toEqual({ nodeIds: ['sm_1'], keys: ['supermodule'] })
    writeValue('dndnode_1/p', 'k', { value: '7' }, { target: 'supermodule' })
    expect(flow.findNode('sm_1').data.supermodule.localConstants[0].value).toBe('7')
    expect(valueOf('dndnode_1/p')).toBe('7')
    writeValue('dndnode_1/p', 'k', { value: '7', type: 'constant' }, { target: 'supermodule' })
    expect(flow.findNode('sm_1~p').data.variables[0]).toMatchObject({ type: 'constant', value: '7' })
  })
})
