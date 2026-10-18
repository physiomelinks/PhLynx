import fs from 'node:fs'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { buildFlowSnapshot, hashFlowSnapshot, restoreFlowSnapshot, SNAPSHOT_KIND, snapshotFlow } from '../../../src/services/flowSnapshot.js'
import { expandHierarchy } from '../../../src/services/hierarchy/expand.js'
import { scopeFlowObject } from '../../../src/services/simulation/scopedModel.js'
import { getHandleId } from '../../../src/utils/handles.js'
import { connect, exposed, exposures, module, superInstance, supermodule } from '../fixtures/hierarchy/graph.js'
import { modelOf, nestedGraph, vessel } from '../fixtures/hierarchy/saveFormat.js'

const library = {
  availableMath: new Map([['file:m', '<math/>']]),
  getMathHashByRef: () => 'm_hash',
  createMathHash: () => 'm_hash',
  globalVariables: new Map([['T', { value: '310', units: 'kelvin' }]]),
}

/** Writes a snapshot as an archive holds it and reads it back. */
const roundTrip = (flow, options = {}) => JSON.parse(JSON.stringify(buildFlowSnapshot(flow, { library, ...options })))

/** The v1-3-0 SN nested workspace's flow, and a library holding its math. */
function snNested() {
  const doc = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'tests/resources/migration-versioning/v1-3-0/sn_nested.json'), 'utf8'))
  return {
    flow: doc.flow,
    library: { ...library, availableMath: new Map(doc.store.availableMath), getMathHashByRef: (ref) => `hash_${ref}` },
  }
}

describe('buildFlowSnapshot', () => {
  it('snapshots the whole store as hierarchical, super-modules, super instances and exposure edges included', () => {
    const flow = nestedGraph()
    const snapshot = roundTrip(flow)

    expect(snapshot).toMatchObject({ id: 'phlynx-flow-snapshot', version: '1.3.0', snapshotKind: SNAPSHOT_KIND.HIERARCHICAL })
    expect(snapshot.nodeData.map((node) => [node.id, node.type])).toEqual(flow.nodes.map((node) => [node.id, node.type]))
    expect(snapshot.edges.map((edge) => edge.id)).toEqual(['e0', 'e1', 'sm_1~a--sm_1~b', 'sm_1~a--sm_1', 'sm_1~b--sm_1'])
    expect(snapshot.nodeData.find((node) => node.id === 'sm_1').data.supermodule).toEqual(flow.nodes[3].data.supermodule)
    expect(snapshot.nodeData.find((node) => node.id === 'dndnode_1').data.overrides).toEqual(flow.nodes[1].data.overrides)
    expect(snapshot.nodeData.find((node) => node.id === 'sm_1~a').data).toMatchObject({ scope: 'sm_1', localId: 'a', mathHash: 'm_hash' })
    expect(snapshot.mathLibrary).toEqual({ m_hash: '<math/>' })
    expect(snapshot.globalParameters).toEqual([['T', { value: '310', units: 'kelvin' }]])
  })

  it('is the same whatever the canvas hides, so navigating never reads as a change', () => {
    const flow = nestedGraph()
    const hiding = {
      ...flow,
      nodes: flow.nodes.map((node) => ({ ...node, hidden: node.data.scope !== null })),
      edges: flow.edges.map((edge) => ({ ...edge, hidden: edge.id === 'sm_1~a--sm_1~b' })),
    }
    expect(JSON.stringify(buildFlowSnapshot(hiding, { library }))).toBe(JSON.stringify(buildFlowSnapshot(flow, { library })))
    expect(JSON.stringify(buildFlowSnapshot(hiding, { library }))).not.toContain('"hidden"')
  })

  it('snapshots a run of every module as hierarchical', () => {
    const flow = nestedGraph()
    const all = expandHierarchy(flow.nodes, flow.edges).nodes.map((node) => node.id)
    expect(snapshotFlow(flow, all)).toMatchObject({ kind: SNAPSHOT_KIND.HIERARCHICAL, nodes: flow.nodes, edges: flow.edges })
  })

  it('snapshots part of a nested model flat: its modules at the root under flat names, ids without "/"', () => {
    const snapshot = roundTrip(nestedGraph(), { nodeIds: ['dndnode_1/a', 'dndnode_1/b', 'dndnode_2'] })

    expect(snapshot.snapshotKind).toBe(SNAPSHOT_KIND.FLAT)
    expect(snapshot.nodeData.map((node) => [node.id, node.type, node.data.name, node.data.scope])).toEqual([
      ['dndnode_1_a', 'instanceNode', 'p1__a', null],
      ['dndnode_1_b', 'instanceNode', 'p1__b', null],
      ['dndnode_2', 'instanceNode', 'sink', null],
    ])
    // The super instance's override is applied; the super-module's own row is the other's.
    expect(snapshot.nodeData.map((node) => node.data.variables[0].value)).toEqual(['2', '1', '1'])
    for (const id of [...snapshot.nodeData.map((node) => node.id), ...snapshot.edges.map((edge) => edge.id)]) expect(id).not.toMatch(/\/|~|::/)
    expect(snapshot.edges.map((edge) => [edge.id, edge.source, edge.target])).toEqual([
      ['e1#0', 'dndnode_1_b', 'dndnode_2'],
      ['dndnode_1_sm_1_a--sm_1_b', 'dndnode_1_a', 'dndnode_1_b'],
    ])
  })

  it('places a flat part’s module two levels down at every level’s offset added up', () => {
    const at = (node, x, y) => ({ ...node, position: { x, y } })
    const wall = at(module('dndnode_0', 'wall', { scope: 'sm_2' }), 5, 7)
    const chamber = supermodule('sm_2', 'chamber')
    const lv = at(superInstance([chamber, wall], 'dndnode_0', 'lv', 'sm_2', { scope: 'sm_1' }), 100, 200)
    const inner = [supermodule('sm_1', 'heart'), lv, chamber, wall]
    const root = [at(superInstance(inner, 'dndnode_1', 'left', 'sm_1'), 1000, 2000), module('dndnode_2', 'pump')]
    const flow = { nodes: [...root, ...inner], edges: [] }
    // Part of the model, so the snapshot is flat.
    const modelId = expandHierarchy(flow.nodes, flow.edges).nodes.find((node) => node.id !== 'dndnode_2').id
    const snapshot = roundTrip(flow, { nodeIds: [modelId] })
    expect(snapshot.nodeData.map((node) => node.position)).toEqual([{ x: 1105, y: 2207 }])
  })

  it('joins a flat part’s edges at handles its modules show, one of its own where the edge met a super instance', () => {
    const snapshot = roundTrip(nestedGraph(), { nodeIds: ['dndnode_1/b', 'dndnode_2'] })
    const [edge] = snapshot.edges
    const b = snapshot.nodeData.find((node) => node.id === edge.source)
    const sink = snapshot.nodeData.find((node) => node.id === edge.target)

    expect(edge.sourceHandle).toBe('handle_b_out')
    expect(edge.targetHandle).toBe('handle_dndnode_2_in')
    expect(b.data.handles.map(getHandleId)).toEqual(['handle_b_out'])
    expect(sink.data.handles.map(getHandleId)).toEqual(['handle_dndnode_2_in'])
  })

  it('makes a ghost the handle of a flat part’s edge when the module has none of that type', () => {
    const flow = nestedGraph()
    const b = flow.nodes.find((node) => node.id === 'sm_1~b')
    b.data.handles = b.data.handles.filter((h) => h.type !== 'source')
    const snapshot = roundTrip(flow, { nodeIds: ['dndnode_1/b', 'dndnode_2'] })

    expect(snapshot.edges[0].sourceHandle).toBe('handle_b_g')
    expect(snapshot.nodeData[0].data.handles.find((h) => h.uid === 'b_g')).toMatchObject({ variant: 'default', type: 'source' })
  })

  it('snapshots a run of every module of a flat workspace as hierarchical', () => {
    const src = vessel('dndnode_0', 'src')
    const sink = vessel('dndnode_2', 'sink')
    const flow = { nodes: [src, sink], edges: [connect(src, sink, { id: 'e0' })] }
    expect(snapshotFlow(flow, ['dndnode_2', 'dndnode_0'])).toEqual({ kind: SNAPSHOT_KIND.HIERARCHICAL, nodes: flow.nodes, edges: flow.edges })
  })

  it('snapshots part of a flat workspace as before: its nodes, narrowed', () => {
    const src = vessel('dndnode_0', 'src')
    const sink = vessel('dndnode_2', 'sink')
    const flow = { nodes: [src, sink], edges: [connect(src, sink, { id: 'e0' })] }
    const { kind, nodes, edges } = snapshotFlow(flow, ['dndnode_0'])
    expect(kind).toBe(SNAPSHOT_KIND.FLAT)
    expect({ nodes, edges }).toEqual((({ nodes, edges }) => ({ nodes, edges }))(scopeFlowObject(flow, ['dndnode_0'])))
  })
})

describe('hashFlowSnapshot', () => {
  it('hashes the model, not the envelope, so a later format leaves an unchanged model’s hash as it was', () => {
    const snapshot = buildFlowSnapshot(nestedGraph(), { library })
    expect(hashFlowSnapshot({ ...snapshot, version: '1.2.0', snapshotKind: undefined })).toBe(hashFlowSnapshot(snapshot))
    const changed = { ...snapshot, nodeData: snapshot.nodeData.map((node, i) => (i ? node : { ...node, position: { x: 9, y: 9 } })) }
    expect(hashFlowSnapshot(changed)).not.toBe(hashFlowSnapshot(snapshot))
  })
})

describe('restoreFlowSnapshot', () => {
  it.each([
    ['nestedGraph', () => ({ flow: nestedGraph(), library })],
    ['the SN nested workspace', snNested],
  ])('restores a hierarchical snapshot of %s with its ids, and again to the same snapshot', (_name, make) => {
    const { flow, library: lib } = make()
    const snapshotOf = ({ nodes, edges }) => JSON.stringify(buildFlowSnapshot({ nodes, edges }, { library: lib }))
    const first = snapshotOf(flow)
    const restored = restoreFlowSnapshot(JSON.parse(first))
    const second = snapshotOf(restored)

    expect(restored.nodes.map((node) => node.id)).toEqual(flow.nodes.map((node) => node.id))
    expect(restored.edges).toEqual(JSON.parse(first).edges)
    expect(restored.edges.map((edge) => edge.id)).toEqual(flow.edges.map((edge) => edge.id))
    // A restore tidies rows and handle slots as a load does; restoring that again changes nothing, key order
    // included, so an imported model never reads as changed.
    expect(snapshotOf(restoreFlowSnapshot(JSON.parse(second)))).toBe(second)
  })

  it('gives a super instance or interface node without handles ghost handles, as a load does', () => {
    const snapshot = roundTrip(nestedGraph())
    for (const node of snapshot.nodeData) {
      if (node.type === 'superInstanceNode') delete node.data.handles
      if (node.type === 'supermoduleInterface') node.data.handles = []
    }
    const restored = restoreFlowSnapshot(snapshot)
    const hierarchy = restored.nodes.filter((node) => ['superInstanceNode', 'supermoduleInterface'].includes(node.type))

    expect(hierarchy.length).toBeGreaterThan(1)
    for (const node of hierarchy) {
      expect(node.data.handles.length).toBeGreaterThan(0)
      expect(node.data.handles.every((handle) => handle.variant === 'ghost')).toBe(true)
    }
  })

  it('restores a hierarchical snapshot to the same model, super instance and interface data kept verbatim', () => {
    const flow = nestedGraph()
    const restored = restoreFlowSnapshot(roundTrip(flow))
    const byId = new Map(restored.nodes.map((node) => [node.id, node]))

    expect(restored.nodes.map((node) => node.id)).toEqual(flow.nodes.map((node) => node.id))
    expect(byId.get('dndnode_1').data).toEqual(flow.nodes[1].data)
    expect(byId.get('sm_1')).toMatchObject({ type: 'supermoduleInterface', deletable: false, data: flow.nodes[3].data })
    expect(byId.get('sm_1~a').data).toMatchObject({ scope: 'sm_1', localId: 'a', name: 'a' })
    expect(byId.get('sm_1~a').data.mathHash).toBeUndefined()
    expect(restored.edges.find((edge) => edge.id === 'sm_1~b--sm_1')).toMatchObject({
      type: 'exposure',
      data: { exposed: [{ id: 'xp_out', alias: { portType: 'exit_ports', label: 'vessel', slot: 0 }, order: 1 }] },
    })
    expect(modelOf(restored)).toEqual(modelOf(flow))
  })

  it('maps each model module’s flat name and path to its model id', () => {
    const { nodeNameToIdMap } = restoreFlowSnapshot(roundTrip(nestedGraph()))
    expect(Object.fromEntries(nodeNameToIdMap)).toEqual({
      src: 'dndnode_0',
      p1__a: 'dndnode_1/a',
      'p1/a': 'dndnode_1/a',
      p1__b: 'dndnode_1/b',
      'p1/b': 'dndnode_1/b',
      sink: 'dndnode_2',
    })
  })

  it('restores a flat snapshot as root modules', () => {
    const flow = nestedGraph()
    const restored = restoreFlowSnapshot(roundTrip(flow, { nodeIds: ['dndnode_1/a', 'dndnode_1/b', 'dndnode_2'] }))
    expect(expandHierarchy(restored.nodes, restored.edges).nodes).toEqual(restored.nodes)
    expect(Object.fromEntries(restored.nodeNameToIdMap)).toEqual({ p1__a: 'dndnode_1_a', p1__b: 'dndnode_1_b', sink: 'dndnode_2' })
    const part = modelOf(flow)
    expect(modelOf(restored)).toEqual({
      nodes: part.nodes.filter((node) => node.name !== 'src'),
      edges: part.edges.filter((edge) => edge.source !== 'src'),
    })
  })

  it('sets the CellML’s value for a module inside a super instance as an override on it, and a root module’s on its row', () => {
    const parameterData = { p1__b: [{ name: 'k', value: '9' }], p1__a: [{ name: 'k', value: '2.0' }], src: [{ name: 'k', value: '4' }] }
    const restored = restoreFlowSnapshot(roundTrip(nestedGraph()), { parameterData })
    const byId = new Map(restored.nodes.map((node) => [node.id, node]))

    expect(byId.get('dndnode_0').data.variables[0].value).toBe('4')
    // p1__a's value is the one it has already.
    expect(byId.get('dndnode_1').data.overrides).toEqual({ a: { k: { value: '2' } }, b: { k: { value: '9' } }, '@': { g: { value: '3' } } })
    expect(byId.get('sm_1~b').data.variables[0].value).toBe('1')
    expect(Object.fromEntries(modelOf(restored).nodes.map((node) => [node.name, node.variables[0].value]))).toEqual({
      src: '4',
      p1__a: '2',
      p1__b: '9',
      sink: '1',
    })
  })

  it('never restores a node or edge hidden', () => {
    const snapshot = roundTrip(nestedGraph())
    snapshot.nodeData.forEach((node) => (node.hidden = true))
    snapshot.edges.forEach((edge) => (edge.hidden = true))
    const restored = restoreFlowSnapshot(snapshot)
    expect([...restored.nodes, ...restored.edges].some((item) => 'hidden' in item)).toBe(false)
  })

  it('rewrites an older snapshot’s ids that break the id rules', () => {
    const src = vessel('a/b', 'src')
    const sink = vessel('dndnode_2', 'sink')
    const snapshot = roundTrip({ nodes: [src, sink], edges: [connect(src, sink, { id: 'a/b--dndnode_2' })] })
    const restored = restoreFlowSnapshot(snapshot)
    expect(restored.nodes.map((node) => node.id)).toEqual(['a_b', 'dndnode_2'])
    expect(restored.edges[0]).toMatchObject({ id: 'a_b--dndnode_2', source: 'a_b', target: 'dndnode_2' })
    expect(restored.nodeNameToIdMap.get('src')).toBe('a_b')
  })
})

describe('scopeFlowObject', () => {
  it('keeps every super-module a kept super instance uses, through others too', () => {
    const inner = vessel('c', 'c', 'sm_2')
    const innerSm = supermodule('sm_2', 'inner', { submoduleOrder: ['c'] })
    const innerExposure = exposures('sm_2', [exposed('xp_c', 'c', 'exit_ports', 'vessel')])
    const flow = nestedGraph()
    const nestedSub = superInstance({ nodes: [innerSm, inner], edges: innerExposure }, 'n', 'n', 'sm_2', { scope: 'sm_1' })
    flow.nodes.push(nestedSub, innerSm, inner)
    flow.edges.push(...innerExposure)

    const scoped = scopeFlowObject(flow, ['dndnode_1'])
    expect(scoped.nodes.map((node) => node.id)).toEqual(['dndnode_1', 'sm_1', 'sm_1~a', 'sm_1~b', 'sm_1~n', 'sm_2', 'sm_2~c'])
    expect(scoped.edges.map((edge) => edge.id)).toEqual(['sm_1~a--sm_1~b', 'sm_1~a--sm_1', 'sm_1~b--sm_1', 'sm_2~c--sm_2'])
  })
})
