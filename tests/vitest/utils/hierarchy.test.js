import { describe, expect, it } from 'vitest'

import { buildSuperInstance, buildSupermoduleInterface } from '../../../src/services/import/buildWorkflow.js'
import {
  EXPOSURE_EDGE_TYPE,
  HANDLE_VARIANT,
  SUPER_INSTANCE_NODE_TYPE,
  SUPERMODULE_INTERFACE_NODE_TYPE,
} from '../../../src/utils/constants.js'
import { buildGhostHandles } from '../../../src/utils/handles.js'
import {
  assertNodeId,
  canPlaceSuperInstance,
  connectionPortWrites,
  edgeScopeProblem,
  findSupermoduleCycle,
  indexByScope,
  isModelEdge,
  localIdOf,
  MAX_NESTING_DEPTH,
  nextNodeId,
  nextSupermoduleId,
  nodeIdProblem,
  rewriteUnsafeIds,
  splitNodeId,
  supermoduleDependencies,
  superInstanceToEnter,
  supermoduleDepth,
  supermoduleOccurrences,
  supermoduleUses,
  toLocalName,
  withScopeFields,
} from '../../../src/utils/hierarchy.js'
import { getId } from '../../../src/utils/nodes.js'

const node = (id, scope = null, extra = {}) => ({ id, type: 'instanceNode', data: { scope, ...extra } })
const sm = (id, name = id) => buildSupermoduleInterface(id, { name })
const instance = (id, smId, scope = null) => buildSuperInstance(id, id, smId, { scope })

describe('ids', () => {
  const nodes = [node('dndnode_0'), node('dndnode_4'), sm('sm_1'), node('sm_1~dndnode_7', 'sm_1'), node('sm_1~dndnode_2', 'sm_1')]

  it('gives a root node today’s next id', () => {
    expect(nextNodeId(null, nodes)).toBe('dndnode_5')
    expect(nextNodeId(null, nodes)).toBe(getId(nodes.map((n) => n.id)))
    expect(nextNodeId(null, [])).toBe('dndnode_0')
  })

  it('gives a nested node its scope and the next local id of that scope', () => {
    expect(nextNodeId('sm_1', nodes)).toBe('sm_1~dndnode_8')
    expect(nextNodeId('sm_9', nodes)).toBe('sm_9~dndnode_0')
  })

  it('gives a new super-module the next sm_ id', () => {
    expect(nextSupermoduleId(nodes)).toBe('sm_2')
  })

  it('splits and reads local ids', () => {
    expect(splitNodeId('sm_1~dndnode_7')).toEqual({ scope: 'sm_1', localId: 'dndnode_7' })
    expect(splitNodeId('dndnode_0')).toEqual({ scope: null, localId: 'dndnode_0' })
    expect(localIdOf(node('sm_1~dndnode_7', 'sm_1'))).toBe('dndnode_7')
    expect(localIdOf(sm('sm_1'))).toBe('sm_1')
    expect(localIdOf(node('dndnode_0'))).toBe('dndnode_0')
  })

  it('accepts ids that keep the rules', () => {
    expect(nodeIdProblem('dndnode_0')).toBeNull()
    expect(nodeIdProblem('macronode_3_iter_1')).toBeNull()
    expect(nodeIdProblem('sm_1~dndnode_0', 'sm_1')).toBeNull()
    expect(nodeIdProblem('sm_1', 'sm_1', { isInterface: true })).toBeNull()
    expect(() => assertNodeId(buildSuperInstance('sm_1~dndnode_3', 'heart', 'sm_2', { scope: 'sm_1' }))).not.toThrow()
    expect(() => assertNodeId(sm('sm_1'))).not.toThrow()
  })

  it('rejects ids with "/", "::" or a misplaced "~"', () => {
    expect(nodeIdProblem('a/b')).toMatch(/"\/"/)
    expect(nodeIdProblem('a::b')).toMatch(/"::"/)
    expect(nodeIdProblem('a~b')).toMatch(/outside a super-module/)
    expect(nodeIdProblem('sm_2~a', 'sm_1')).toMatch(/does not start with its scope/)
    expect(nodeIdProblem('sm_1~a~b', 'sm_1')).toMatch(/one local id/)
    expect(nodeIdProblem('sm_2', 'sm_1', { isInterface: true })).toMatch(/not in its own scope/)
    expect(() => assertNodeId(node('sm_1~a', 'sm_1', { localId: 'b' }))).toThrow(/does not match its local id/)
  })
})

describe('builders', () => {
  it('builds a super instance with its local id', () => {
    const built = buildSuperInstance('sm_1~dndnode_3', 'heart', 'sm_2', { scope: 'sm_1', overrides: { lv: { E: { value: '2' } } } })
    expect(built).toEqual({
      id: 'sm_1~dndnode_3',
      type: SUPER_INSTANCE_NODE_TYPE,
      position: { x: 100, y: 100 },
      data: { scope: 'sm_1', localId: 'dndnode_3', name: 'heart', smId: 'sm_2', overrides: { lv: { E: { value: '2' } } }, ports: [], handles: expect.any(Array) },
    })
    expect(buildSuperInstance('dndnode_3', 'heart', 'sm_2').data).toMatchObject({ scope: null, localId: 'dndnode_3', overrides: {} })
  })

  it('gives a super instance and an interface node a fresh set of ghost handles by default, as an instance gets', () => {
    const ghosts = buildGhostHandles()
    const sub = buildSuperInstance('dndnode_3', 'heart', 'sm_2').data.handles
    const face = buildSupermoduleInterface('sm_2', { name: 'heart' }).data.handles
    for (const handles of [sub, face]) {
      expect(handles).toHaveLength(ghosts.length)
      expect(handles.every((handle) => handle.variant === HANDLE_VARIANT.GHOST)).toBe(true)
    }
    expect(buildSuperInstance('dndnode_4', 'heart', 'sm_2').data.handles[0].uid).not.toBe(sub[0].uid)
    const own = [{ uid: 'h1', side: 'left', name: '', variant: HANDLE_VARIANT.DEFAULT }]
    expect(buildSuperInstance('dndnode_3', 'heart', 'sm_2', { handles: own }).data.handles).toBe(own)
    expect(buildSupermoduleInterface('sm_2', { name: 'heart' }, null, { handles: own }).data.handles).toBe(own)
  })

  it('refuses an id that is not in the scope given', () => {
    expect(() => buildSuperInstance('dndnode_3', 'heart', 'sm_2', { scope: 'sm_1' })).toThrow('does not start with its scope "sm_1~"')
    expect(() => buildSuperInstance('sm_9~dndnode_3', 'heart', 'sm_2', { scope: 'sm_1' })).toThrow()
    expect(() => buildSuperInstance('sm_1~dndnode_3', 'heart', 'sm_2')).toThrow('outside a super-module')
    expect(() => buildSupermoduleInterface('sm~1', { name: 'heart' })).toThrow()
    expect(() => buildSupermoduleInterface('sm/1', { name: 'heart' })).toThrow()
  })

  it('builds an undeletable interface node holding the definition', () => {
    expect(buildSupermoduleInterface('sm_1', { name: 'heart', submoduleOrder: ['ra'] })).toEqual({
      id: 'sm_1',
      type: SUPERMODULE_INTERFACE_NODE_TYPE,
      deletable: false,
      position: { x: 0, y: 0 },
      data: {
        scope: 'sm_1',
        localId: 'sm_1',
        supermodule: { name: 'heart', ca: null, submoduleOrder: ['ra'], localConstants: [], naming: 'prefixed', source: null },
        handles: expect.any(Array),
      },
    })
  })
})

describe('scopes and edges', () => {
  it('indexes nodes by scope, in order', () => {
    const nodes = [node('a'), node('sm_1~x', 'sm_1'), node('b'), { id: 'legacy', data: {} }]
    const index = indexByScope(nodes)
    expect(index.get(null).map((n) => n.id)).toEqual(['a', 'b', 'legacy'])
    expect(index.get('sm_1').map((n) => n.id)).toEqual(['sm_1~x'])
  })

  it('finds edges that join two scopes, or end at an interface node without being exposure edges', () => {
    const nodes = [node('a'), node('b'), sm('sm_1'), node('sm_1~x', 'sm_1')]
    const nodeById = new Map(nodes.map((n) => [n.id, n]))
    const edge = (source, target, type) => ({ id: 'e', source, target, ...(type && { type }) })
    expect(edgeScopeProblem(edge('a', 'b'), nodeById)).toBeNull()
    expect(edgeScopeProblem(edge('sm_1~x', 'sm_1', EXPOSURE_EDGE_TYPE), nodeById)).toBeNull()
    expect(edgeScopeProblem(edge('a', 'gone'), nodeById)).toBeNull()
    expect(edgeScopeProblem(edge('a', 'sm_1~x'), nodeById)).toMatch(/different scopes/)
    expect(edgeScopeProblem(edge('sm_1~x', 'sm_1'), nodeById)).toMatch(/interface node/)
  })

  it('leaves exposure edges out of the model', () => {
    expect(isModelEdge({ type: EXPOSURE_EDGE_TYPE })).toBe(false)
    expect(isModelEdge({ type: 'smoothstep' })).toBe(true)
    expect(isModelEdge({})).toBe(true)
  })
})

describe('super-module dependencies', () => {
  // sm_a uses sm_b, which uses sm_c.
  const nodes = [sm('sm_a'), sm('sm_b'), sm('sm_c'), instance('sm_a~i', 'sm_b', 'sm_a'), instance('sm_b~j', 'sm_c', 'sm_b'), instance('top', 'sm_a')]
  const graph = supermoduleDependencies(nodes)

  it('lists the super-modules each one uses', () => {
    expect(graph).toEqual(new Map([['sm_a', new Set(['sm_b'])], ['sm_b', new Set(['sm_c'])], ['sm_c', new Set()]]))
    expect(supermoduleUses(graph, 'sm_a', 'sm_c')).toBe(true)
    expect(supermoduleUses(graph, 'sm_c', 'sm_a')).toBe(false)
    expect(supermoduleDepth(graph, 'sm_a')).toBe(3)
    expect(findSupermoduleCycle(graph)).toBeNull()
  })

  it('refuses a placement that would make a cycle', () => {
    expect(canPlaceSuperInstance(graph, null, 'sm_a')).toBe(true)
    expect(canPlaceSuperInstance(graph, 'sm_a', 'sm_c')).toBe(true)
    expect(canPlaceSuperInstance(graph, 'sm_c', 'sm_a')).toBe(false)
    expect(canPlaceSuperInstance(graph, 'sm_b', 'sm_b')).toBe(false)
  })

  it('finds a cycle', () => {
    const cyclic = supermoduleDependencies([...nodes, instance('sm_c~k', 'sm_a', 'sm_c')])
    expect(findSupermoduleCycle(cyclic)).toEqual(['sm_a', 'sm_b', 'sm_c'])
    expect(supermoduleDepth(cyclic, 'sm_a')).toBe(Infinity)
  })

  it('caps nesting at CA’s depth', () => {
    const ids = Array.from({ length: MAX_NESTING_DEPTH + 1 }, (_, i) => `sm_${i}`)
    const deep = supermoduleDependencies([...ids.map((id) => sm(id)), ...ids.slice(1).map((id, i) => instance(`${ids[i]}~x`, id, ids[i]))])
    expect(supermoduleDepth(deep, 'sm_1')).toBe(MAX_NESTING_DEPTH)
    expect(supermoduleDepth(deep, 'sm_0')).toBe(Infinity)
  })
})

describe('rewriteUnsafeIds', () => {
  it('gives back the nodes and edges as they are when every id keeps the rules', () => {
    const nodes = [{ id: 'dndnode_0', data: {} }, { id: 'sm_1~a', data: { scope: 'sm_1' } }]
    const edges = [{ id: 'e', source: 'dndnode_0', target: 'dndnode_0' }]
    const rewritten = rewriteUnsafeIds(nodes, edges)
    expect(rewritten.nodes).toBe(nodes)
    expect(rewritten.edges).toBe(edges)
    expect(rewritten.idMap.size).toBe(0)
  })

  it('rewrites root ids, a free one each, and leaves nodes and edges inside super-modules alone', () => {
    const nodes = [
      { id: 'a/b', data: { localId: 'a/b' } },
      { id: 'a_b', data: {} },
      { id: 'sm_1', type: SUPERMODULE_INTERFACE_NODE_TYPE, data: { scope: 'sm_1' } },
      { id: 'sm_1~c', data: { scope: 'sm_1' } },
    ]
    const edges = [
      { id: 'a/b--a_b', source: 'a/b', target: 'a_b' },
      { id: 'sm_1~c--sm_1~d', source: 'sm_1~c', target: 'sm_1~d' },
      { id: 'sm_1~c--sm_1', type: 'exposure', source: 'sm_1~c', target: 'sm_1' },
    ]
    const { nodes: renamed, edges: rewired, idMap, edgeIdMap } = rewriteUnsafeIds(nodes, edges)

    expect(renamed.map((node) => [node.id, node.data.localId])).toEqual([
      ['a_b_2', 'a_b_2'],
      ['a_b', undefined],
      ['sm_1', undefined],
      ['sm_1~c', undefined],
    ])
    expect(rewired).toEqual([{ id: 'a_b--a_b', source: 'a_b_2', target: 'a_b' }, edges[1], edges[2]])
    expect(Object.fromEntries(idMap)).toEqual({ 'a/b': 'a_b_2' })
    expect(Object.fromEntries(edgeIdMap)).toEqual({ 'a/b--a_b': 'a_b--a_b' })
  })

  it('leaves a whole nested store as it is, its internal and exposure edges’ ids holding "~"', () => {
    const nodes = [
      { id: 'sm_1', type: SUPERMODULE_INTERFACE_NODE_TYPE, data: { scope: 'sm_1' } },
      { id: 'sm_1~a', data: { scope: 'sm_1' } },
      { id: 'sm_1~b', data: { scope: 'sm_1' } },
    ]
    const edges = [
      { id: 'sm_1~a--sm_1~b', source: 'sm_1~a', target: 'sm_1~b' },
      { id: 'sm_1~b--sm_1', type: 'exposure', source: 'sm_1~b', target: 'sm_1' },
    ]
    const rewritten = rewriteUnsafeIds(nodes, edges)
    expect(rewritten.nodes).toBe(nodes)
    expect(rewritten.edges).toBe(edges)
  })
})

describe('stamping an added node', () => {
  it('fills in the scope it is added to and the local id its id gives', () => {
    expect(withScopeFields({ id: 'sm_1~dndnode_3', data: { name: 'x' } }, 'sm_1')).toEqual({ name: 'x', scope: 'sm_1', localId: 'dndnode_3' })
    expect(withScopeFields({ id: 'dndnode_3', data: {} }, null)).toEqual({ scope: null, localId: 'dndnode_3' })
    expect(withScopeFields({ id: 'sm_2', type: SUPERMODULE_INTERFACE_NODE_TYPE, data: {} }, 'sm_1')).toEqual({ scope: 'sm_2', localId: 'sm_2' })
  })

  it('keeps the fields a node has, so a root id added inside a super-module still fails the id check', () => {
    const data = { scope: null, localId: 'dndnode_3' }
    expect(withScopeFields({ id: 'dndnode_3', data }, 'sm_1')).toBe(data)
    const stamped = { id: 'dndnode_3', data: withScopeFields({ id: 'dndnode_3', data: {} }, 'sm_1') }
    expect(() => assertNodeId(stamped)).toThrow('does not start with its scope')
  })
})

describe('local names made up', () => {
  it('keeps the rules for names inside super-modules', () => {
    expect(toLocalName('_a__b_')).toBe('a_b')
    expect(toLocalName('___')).toBe('module')
    expect(toLocalName('lv')).toBe('lv')
  })
})

describe('super-module occurrences', () => {
  it('counts the copies the root expands to, through super-modules holding others', () => {
    const nodes = [sm('sm_1'), sm('sm_2'), sm('sm_3'), instance('a', 'sm_1'), instance('b', 'sm_1'), instance('sm_1~c', 'sm_2', 'sm_1')]
    expect(Object.fromEntries(supermoduleOccurrences(nodes))).toEqual({ sm_1: 2, sm_2: 2, sm_3: 0 })
  })

  it('counts nothing through a cycle', () => {
    const nodes = [sm('sm_1'), sm('sm_2'), instance('sm_1~a', 'sm_2', 'sm_1'), instance('sm_2~b', 'sm_1', 'sm_2')]
    expect(Object.fromEntries(supermoduleOccurrences(nodes))).toEqual({ sm_1: 0, sm_2: 0 })
  })
})

describe('connectionPortWrites', () => {
  it('writes a module’s ports back, never a super instance’s', () => {
    const moduleNode = { id: 'dndnode_0', type: 'moduleNode', data: {} }
    const superInstanceNode = { id: 'dndnode_1', type: SUPER_INSTANCE_NODE_TYPE, data: { smId: 'sm_1' } }
    const ports = [{ label: 'vessel' }]
    expect(connectionPortWrites([[moduleNode, ports], [superInstanceNode, [{ label: 'edited' }]]])).toEqual([['dndnode_0', ports]])
    expect(connectionPortWrites([[superInstanceNode, []], [undefined, []]])).toEqual([])
  })
})

describe('superInstanceToEnter', () => {
  const body = { closest: () => null }
  body.ownerDocument = { body }
  const canvas = { contains: (el) => el === inCanvas || el === nameButton }
  const inCanvas = { ownerDocument: { body }, closest: () => null }
  const nameButton = { ownerDocument: { body }, closest: (selector) => (selector.includes('[role="button"]') ? nameButton : null) }
  const outside = { ownerDocument: { body }, closest: () => null }
  const superInstance = { id: 'dndnode_1', type: SUPER_INSTANCE_NODE_TYPE }
  const moduleNode = { id: 'dndnode_0', type: 'instanceNode' }
  const enter = (target, selected = [superInstance], extra = {}) => superInstanceToEnter({ key: 'Enter', target, ...extra }, selected, canvas)

  it('opens the one selected super instance, on the canvas or with nothing focused', () => {
    expect(enter(inCanvas)).toBe('dndnode_1')
    expect(enter(body)).toBe('dndnode_1')
  })

  it('opens nothing for another selection, key or focus', () => {
    expect(enter(inCanvas, [superInstance, moduleNode])).toBeNull()
    expect(enter(inCanvas, [moduleNode])).toBeNull()
    expect(enter(inCanvas, [])).toBeNull()
    expect(enter(outside)).toBeNull()
    expect(enter(nameButton)).toBeNull()
    expect(enter(inCanvas, [superInstance], { key: 'a' })).toBeNull()
    expect(enter(inCanvas, [superInstance], { ctrlKey: true })).toBeNull()
    expect(enter(inCanvas, [superInstance], { defaultPrevented: true })).toBeNull()
  })
})
