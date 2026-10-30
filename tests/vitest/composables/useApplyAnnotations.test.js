import { existsSync, readFileSync, readdirSync } from 'fs'
import { resolve } from 'path'
import { effectScope, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { useApplyAnnotations } from '../../../src/composables/useApplyAnnotations.js'
import { useCouplingSuggestions } from '../../../src/composables/useCouplingSuggestions.js'
import { useNodeDataHistory } from '../../../src/composables/useNodeDataHistory.js'
import { useAnnotationStore } from '../../../src/stores/annotationStore.js'
import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { useSuggestionStore } from '../../../src/stores/suggestionStore.js'
import { HANDLE_VARIANT } from '../../../src/utils/constants.js'
import { getHandleUidFromHandleId } from '../../../src/utils/handles.js'
import { readToy } from '../services/annotations/toyModel.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

// Hoisted: src/utils/nodes.js calls useVueFlow as it loads.
const { nodes, edges, fitView } = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return { nodes: ref([]), edges: ref([]), fitView: vi.fn() }
})
const toList = (items) => (Array.isArray(items) ? items : [items])
function findNode(id) {
  return nodes.value.find((node) => node.id === id)
}

function setVariant(nodeId, uid, variant) {
  const node = findNode(nodeId)
  if (node) node.data = { ...node.data, handles: node.data.handles.map((h) => (h.uid === uid ? { ...h, variant } : h)) }
}

let history
// Stands in for Vue Flow with useFlowHistory: adding nodes or edges is one step each.
vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  useVueFlow: () => ({
    nodes,
    edges,
    findNode,
    findEdge: (id) => edges.value.find((edge) => edge.id === id),
    fitView,
    updateNodeData: (id, patch, { replace } = {}) => {
      const node = findNode(id)
      if (node) node.data = replace ? patch : { ...node.data, ...patch }
    },
    addNodes: (added) => {
      const list = toList(added).map((node) => ({ ...node, dimensions: { width: 160, height: 80 } }))
      nodes.value = [...nodes.value, ...list]
      const ids = list.map((node) => node.id)
      history.lastChangeWasAddSetter(true)
      history.addCommand({
        type: 'add',
        undo: () => (nodes.value = nodes.value.filter((node) => !ids.includes(node.id))),
        redo: () => (nodes.value = [...nodes.value, ...list]),
      })
    },
    addEdges: (added) => {
      const list = toList(added).map((edge) => ({ ...edge }))
      edges.value = [...edges.value, ...list]
      const ids = list.map((edge) => edge.id)
      history.addCommand({
        type: 'add-edge',
        undo: () => {
          edges.value = edges.value.filter((edge) => !ids.includes(edge.id))
          list.forEach((edge) => {
            if (edge.sourceHandle)
              setVariant(edge.source, getHandleUidFromHandleId(edge.sourceHandle), HANDLE_VARIANT.GHOST)
            if (edge.targetHandle)
              setVariant(edge.target, getHandleUidFromHandleId(edge.targetHandle), HANDLE_VARIANT.GHOST)
          })
        },
        redo: () => (edges.value = [...edges.value, ...list]),
      })
    },
  }),
}))

beforeAll(() => ensureLibCellmlReady())

const TOY = ['pool', 'porter', 'wall']
const RESERVOIR_KINDS = ['layer', 'lyph']

/** Puts maths in the library as a CellML import does, one module each. */
function loadMaths(library, entries) {
  for (const { file, component, math } of entries) {
    library.addMathFile(file, [{ name: component, math }])
  }
}

/** The plan's rows with the reservoirs (layers and lyphs) held constant. */
const withReservoirs = (rows) => rows.map((row) => ({ ...row, heldConstant: RESERVOIR_KINDS.includes(row.kind) }))

describe('useApplyAnnotations', () => {
  let scope, apply, library, annotationStore

  const toyFiles = () => ({
    sidecarFiles: TOY.map((name) => ({ name: `${name}.ttl`, text: readToy(`${name}.ttl`) })),
    instanceFile: { name: 'toy-apicoords.ttl', text: readToy('toy-apicoords.ttl') },
  })

  /** Reads the files, plans them with the matched maths and applies the plan. */
  async function applyFiles(files, adjust = withReservoirs) {
    const prepared = await apply.readAnnotationFiles(files)
    const targets = Object.fromEntries(prepared.sidecars.map((entry) => [entry.filename, entry.match.mathRef]))
    const rows = adjust(apply.planRows(prepared, targets))
    return { prepared, rows, result: await apply.applyAnnotations(prepared, { targets, rows }) }
  }

  beforeEach(() => {
    setActivePinia(createPinia())
    history = useFlowHistoryStore()
    library = useLibraryStore()
    annotationStore = useAnnotationStore()
    nodes.value = []
    edges.value = []
    fitView.mockClear()
    loadMaths(
      library,
      TOY.map((name) => ({ file: `${name}.cellml`, component: name, math: readToy(`${name}.cellml`) }))
    )
    scope = effectScope()
    apply = scope.run(() => useApplyAnnotations())
  })

  afterEach(() => scope?.stop())

  it('attaches each sidecar to its math, and reports one with no math', async () => {
    const files = toyFiles()
    files.sidecarFiles.push({
      name: 'stray.ttl',
      text: readToy('pool.ttl').replaceAll('pool', 'stray'),
    })
    const prepared = await apply.readAnnotationFiles(files)
    expect(prepared.sidecars.map((entry) => [entry.filename, entry.match.mathRef])).toEqual([
      ['pool.ttl', 'pool.cellml:pool'],
      ['porter.ttl', 'porter.cellml:porter'],
      ['wall.ttl', 'wall.cellml:wall'],
      ['stray.ttl', null],
    ])
    expect(prepared.sidecars[1].sidecar.warnings).toEqual([])
    expect(prepared.apiCoords.instances).toHaveLength(6)

    const targets = Object.fromEntries(prepared.sidecars.map((entry) => [entry.filename, entry.match.mathRef]))
    const { unmatchedSidecars } = await apply.applyAnnotations(prepared, {
      targets,
      rows: apply.planRows(prepared, targets),
    })
    expect(unmatchedSidecars).toEqual(['stray.ttl'])
    expect([...library.moduleAnnotations.keys()].sort()).toEqual(['pool.cellml:pool', 'porter.cellml:porter', 'wall.cellml:wall'])
  })

  it('adds the instances named by the instance file, bound and laid out by rank, as one undo step', async () => {
    const { result } = await applyFiles(toyFiles())
    expect(result).toEqual({
      added: ['outside', 'cell', 'wall', 'porter_in', 'porter_out', 'vessel'],
      bound: [],
      skipped: [],
      unmatchedSidecars: [],
    })
    const byName = new Map(nodes.value.map((node) => [node.data.name, node]))
    expect([...byName.keys()]).toEqual(result.added)
    expect(byName.get('porter_in').data).toMatchObject({
      mathRef: 'porter.cellml:porter',
      moduleRef: 'porter:default',
      apiCoord: { name: 'porter_in', subject: expect.stringMatching(/#porter_in$/), coordIri: expect.stringMatching(/#coord_porter_in$/) },
    })
    expect(byName.get('porter_out').data.mathRef).toBe('porter.cellml:porter')
    // Columns by rank: outside | porter_in | cell, wall | porter_out | vessel.
    const x = (name) => byName.get(name).position.x
    expect(x('outside') < x('porter_in')).toBe(true)
    expect(x('porter_in') < x('cell')).toBe(true)
    expect(x('cell')).toBe(x('wall'))
    expect(x('cell') < x('porter_out') && x('porter_out') < x('vessel')).toBe(true)

    // Reservoirs: held, with their aggregator at constant 0; the cell is not.
    for (const name of ['outside', 'vessel']) {
      expect(byName.get(name).data.annotationOverlay).toEqual({ heldConstant: true })
      expect(byName.get(name).data.variables.find((row) => row.name === 'v_A')).toMatchObject({ type: 'constant', value: '0' })
    }
    expect(byName.get('cell').data.annotationOverlay).toBeUndefined()
    expect(byName.get('cell').data.variables.find((row) => row.name === 'v_A').value).not.toBe('0')
    // What ports supply needs no value: the cell's sum and the porter's readers are boundary conditions.
    const typeOf = (name, variable) => byName.get(name).data.variables.find((row) => row.name === variable)?.type
    expect(typeOf('cell', 'v_A')).toBe('boundary_condition')
    expect(['c_A_i', 'c_A_o', 'area'].map((variable) => typeOf('porter_in', variable))).toEqual(
      Array(3).fill('boundary_condition')
    )
    expect(typeOf('cell', 'volume')).toBe('constant')

    expect(annotationStore.instanceSources.map((source) => source.location)).toEqual(['toy-apicoords.ttl'])
    expect(fitView).toHaveBeenCalledTimes(1)

    // Undo removes the instances; the stored files stay.
    expect(history.canUndo).toBe(true)
    await history.undo()
    expect(nodes.value).toEqual([])
    expect(history.canUndo).toBe(false)
    expect(library.getModuleAnnotations('pool.cellml:pool')).toBe(readToy('pool.ttl'))
    expect(annotationStore.instanceSources).toHaveLength(1)
  })

  it('gives new instances, and existing nodes on a newly annotated math, one sidecar port per annotation', async () => {
    const variables = ['c_A', 'v_A', 'volume', 'area'].map((name) => ({ name }))
    const existing = { id: 'kept', position: { x: 0, y: 0 }, data: { name: 'spare', mathRef: 'pool.cellml:pool', variables, ports: [] } }
    nodes.value = [existing]
    await applyFiles(toyFiles())

    const sidecarVariables = (node) =>
      node.data.ports.filter((port) => port.annotation?.source?.kind === 'sidecar').map((port) => port.variables[0]).sort()
    const annotated = (mathRef) =>
      library.getParsedModuleAnnotations(mathRef).variables.filter((entry) => entry.property && entry.location).map((entry) => entry.variable).sort()
    const porterIn = nodes.value.find((node) => node.data.name === 'porter_in')
    expect(annotated('porter.cellml:porter').length).toBeGreaterThan(0)
    expect(sidecarVariables(porterIn)).toEqual(annotated('porter.cellml:porter'))
    expect(sidecarVariables(nodes.value.find((node) => node.id === 'kept'))).toEqual(annotated('pool.cellml:pool'))

    await history.undo()
    expect(nodes.value.map((node) => node.id)).toEqual(['kept'])
    expect(nodes.value[0].data.ports).toEqual([])
  })

  it('applying twice binds to the same nodes and adds nothing', async () => {
    await applyFiles(toyFiles())
    const before = JSON.stringify(nodes.value)
    const steps = history.pointerIndex
    const sources = annotationStore.instanceSources

    const { rows, result } = await applyFiles(toyFiles())
    expect(rows.every((row) => row.nodeId)).toBe(true)
    // The held ones are pre-ticked: their aggregators are constant 0 already.
    expect(rows.filter((row) => row.heldConstant).map((row) => row.name)).toEqual(['outside', 'vessel'])
    expect(result.added).toEqual([])
    expect(result.bound).toHaveLength(6)
    expect(JSON.stringify(nodes.value)).toBe(before)
    expect(history.pointerIndex).toBe(steps)
    expect(annotationStore.instanceSources).toBe(sources)
  })

  it('unticking a held instance on a second apply sums its fluxes again, from 0 when nothing is connected', async () => {
    await applyFiles(toyFiles())
    await applyFiles(toyFiles(), (rows) => rows.map((row) => ({ ...row, heldConstant: row.name === 'vessel' })))
    const data = (name) => nodes.value.find((node) => node.data.name === name).data
    expect(data('outside').annotationOverlay).toBeUndefined()
    expect(data('outside').variables.find((row) => row.name === 'v_A')).toMatchObject({ type: 'boundary_condition', value: '0' })
    expect(data('vessel').annotationOverlay).toEqual({ heldConstant: true })
    expect(data('vessel').variables.find((row) => row.name === 'v_A')).toMatchObject({ type: 'constant', value: '0' })
  })

  it('binds onto an existing node by name, keeping its values, and by subject after a rename', async () => {
    const existing = {
      id: 'dndnode_7',
      position: { x: 0, y: 0 },
      dimensions: { width: 160, height: 80 },
      data: {
        name: 'outside',
        mathRef: 'pool.cellml:pool',
        moduleRef: 'pool:default',
        ports: [],
        handles: [],
        variables: [
          { name: 'c_A', type: 'constant', value: '42' },
          { name: 'v_A', type: 'constant', value: '0' },
        ],
      },
    }
    nodes.value = [existing]
    const { rows, result } = await applyFiles(toyFiles(), (planned) => planned)
    expect(rows.find((row) => row.name === 'outside')).toMatchObject({ nodeId: 'dndnode_7', heldConstant: true })
    expect(result.bound).toEqual(['outside'])
    expect(result.added).toHaveLength(5)
    const outside = findNode('dndnode_7')
    expect(outside.position).toEqual({ x: 0, y: 0 })
    expect(outside.data.apiCoord.name).toBe('outside')
    expect(outside.data.annotationOverlay).toEqual({ heldConstant: true })
    expect(outside.data.variables[0].value).toBe('42')
    // New nodes go right of the existing one.
    expect(nodes.value.filter((node) => node.id !== 'dndnode_7').every((node) => node.position.x > 160)).toBe(true)

    // One step undoes the nodes and the binding together.
    await history.undo()
    expect(nodes.value.map((node) => node.id)).toEqual(['dndnode_7'])
    expect(findNode('dndnode_7').data.apiCoord).toBeUndefined()
    expect(findNode('dndnode_7').data.annotationOverlay).toBeUndefined()

    await history.redo()
    findNode('dndnode_7').data = { ...findNode('dndnode_7').data, name: 'renamed' }
    const again = await applyFiles(toyFiles(), (planned) => planned)
    expect(again.rows.find((row) => row.name === 'outside').nodeId).toBe('dndnode_7')
    expect(again.result.added).toEqual([])
  })

  it('skips an instance with no module and leaves the rest', async () => {
    const files = toyFiles()
    files.sidecarFiles = files.sidecarFiles.filter((file) => file.name !== 'wall.ttl')
    const { result } = await applyFiles(files)
    expect(result.skipped).toEqual(['wall'])
    expect(nodes.value.map((node) => node.data.name)).not.toContain('wall')
  })

  it('suggests the couplings once applied', async () => {
    const suggestionStore = useSuggestionStore()
    const suggestions = scope.run(() =>
      useCouplingSuggestions({
        activateHandle: vi.fn(async (nodeId, uid) => setVariant(nodeId, uid, HANDLE_VARIANT.DEFAULT)),
        recordEdit: useNodeDataHistory().recordEdit,
        delay: 0,
      })
    )
    await applyFiles(toyFiles())
    await nextTick()
    await suggestions.refresh()
    expect(suggestionStore.suggestions).toHaveLength(6)
    expect(await suggestions.acceptAll()).toBe(6)
    expect(edges.value).toHaveLength(6)
  })
})

// Unpublished fixtures, gitignored: run only where they are present.
const PRIVATE = resolve(__dirname, '../fixtures/annotations/private')
const readPrivate = (...path) => readFileSync(resolve(PRIVATE, ...path), 'utf8')

describe.skipIf(!existsSync(resolve(PRIVATE, 'expected.json')))('useApplyAnnotations on the private fixtures', () => {
  let scope

  afterEach(() => scope?.stop())

  it('regenerates the expected instances, then the expected edges once every suggestion is accepted', async () => {
    setActivePinia(createPinia())
    history = useFlowHistoryStore()
    nodes.value = []
    edges.value = []
    const expected = JSON.parse(readPrivate('expected.json'))
    const library = useLibraryStore()
    const maths = readdirSync(resolve(PRIVATE, 'maths')).filter((file) => file.endsWith('.cellml'))
    loadMaths(
      library,
      maths.map((file) => ({ file, component: file.replace(/\.cellml$/, ''), math: readPrivate('maths', file) }))
    )

    scope = effectScope()
    const apply = scope.run(() => useApplyAnnotations())
    const suggestions = scope.run(() =>
      useCouplingSuggestions({
        activateHandle: vi.fn(async (nodeId, uid) => setVariant(nodeId, uid, HANDLE_VARIANT.DEFAULT)),
        recordEdit: useNodeDataHistory().recordEdit,
        delay: 0,
      })
    )
    const prepared = await apply.readAnnotationFiles({
      sidecarFiles: readdirSync(resolve(PRIVATE, 'sidecars')).map((name) => ({
        name,
        text: readPrivate('sidecars', name),
      })),
      instanceFile: { name: 'apicoords.ttl', text: readPrivate('apicoords.ttl') },
    })
    expect(prepared.sidecars.every((entry) => entry.match.isExact)).toBe(true)
    const targets = Object.fromEntries(prepared.sidecars.map((entry) => [entry.filename, entry.match.mathRef]))
    const rows = withReservoirs(apply.planRows(prepared, targets))
    expect(rows.every((row) => row.mathRef)).toBe(true)
    await apply.applyAnnotations(prepared, { targets, rows })

    const componentOf = (mathRef) => mathRef.split(':')[1]
    const instances = (list) => list.map(({ name, mathRef }) => `${name}:${componentOf(mathRef)}`).sort()
    expect(instances(nodes.value.map((node) => node.data))).toEqual(instances(expected.instances))

    await nextTick()
    await suggestions.refresh()
    await suggestions.acceptAll()
    const nameOf = (id) => findNode(id).data.name
    const tuples = (list) =>
      list
        .flatMap(({ source, target, couplings }) => couplings.map(([sv, tv]) => `${source}.${sv} -> ${target}.${tv}`))
        .sort()
    const made = edges.value.map((edge) => ({
      source: nameOf(edge.source),
      target: nameOf(edge.target),
      couplings: edge.data.couplings.map(({ sourcePort, targetPort }) => [sourcePort.variables[0], targetPort.variables[0]]),
    }))
    expect(made).toHaveLength(expected.edges.length)
    expect(made.flatMap((edge) => edge.couplings)).toHaveLength(
      expected.edges.reduce((count, edge) => count + edge.couplings.length, 0)
    )
    expect(tuples(made)).toEqual(tuples(expected.edges))
  })
})
