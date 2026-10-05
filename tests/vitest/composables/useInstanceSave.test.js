// @vitest-environment happy-dom
import { reactive, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { useInstanceSave } from '../../../src/composables/useInstanceSave.js'
import { useNodeDataHistory } from '../../../src/composables/useNodeDataHistory.js'
import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { detachReactivity } from '../../../src/utils/reactivity.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

const nodes = ref([])
const edges = ref([])

vi.mock('@vue-flow/core', async (importOriginal) => ({
  ...(await importOriginal()),
  // Writes data the way vue-flow does: a new data object on the same node.
  useVueFlow: () => ({
    nodes,
    edges,
    findNode: (id) => nodes.value.find((node) => node.id === id),
    findEdge: (id) => edges.value.find((edge) => edge.id === id),
    updateNodeData: (id, patch) => {
      const node = nodes.value.find((candidate) => candidate.id === id)
      if (node) node.data = { ...node.data, ...patch }
    },
  }),
}))

const DECAY_REF = 'file:decay'
const GROWTH_REF = 'file:growth'
const DECAY_XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="decay">
  <component name="decay">
    <variable name="t" units="second" interface="public_and_private"/>
    <variable name="x" units="metre" initial_value="x0"/>
    <variable name="x0" units="metre" initial_value="1"/>
    <variable name="k" units="per_second" initial_value="0.5"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply>
        <apply><times/><apply><minus/><ci>k</ci></apply><ci>x</ci></apply>
      </apply>
    </math>
  </component>
</model>`
const DECAY_WITHOUT_K = DECAY_XML.replace('<apply><minus/><ci>k</ci></apply>', '<apply><minus/><cn>1</cn></apply>')
const GROWTH_XML = DECAY_XML.replaceAll('decay', 'growth').replace('<apply><minus/><ci>k</ci></apply>', '<ci>k</ci>')

/**
 * Creates a node on the decay math, with port `p` carrying `x` and `k`.
 *
 * @param {string} id
 * @returns {Object}
 */
function createNode(id) {
  return reactive({
    id,
    data: {
      name: id,
      mathRef: DECAY_REF,
      variables: [
        { name: 'x', units: 'metre', type: 'variable' },
        { name: 'k', value: '0.5', units: 'per_second', type: 'constant' },
      ],
      ports: [{ label: 'p', portType: 'general_ports', variables: ['x', 'k'] }],
    },
  })
}

const findNode = (id) => nodes.value.find((node) => node.id === id)
const snapshot = () => detachReactivity({ nodes: nodes.value.map(({ id, data }) => ({ id, data })), edges: edges.value })

/**
 * Builds an instance editor save for node `a`.
 *
 * @param {Object} [overrides]
 * @returns {Object}
 */
function buildSave(overrides = {}) {
  return {
    id: 'a',
    name: 'a2',
    mathRef: DECAY_REF,
    previousMathRef: DECAY_REF,
    math: null,
    layout: null,
    isLayoutChanged: false,
    globalConstants: [],
    variables: findNode('a').data.variables,
    ports: findNode('a').data.ports,
    updateAll: false,
    siblings: [],
    ...overrides,
  }
}

const fork = () =>
  buildSave({
    mathRef: GROWTH_REF,
    math: GROWTH_XML,
    globalConstants: [{ name: 'g', value: '2', units: 'second', data_reference: null }],
    variables: [...findNode('a').data.variables, { name: 'g', units: 'second', type: 'global_constant' }],
    updateAll: true,
    siblings: ['b'],
  })

describe('useInstanceSave', () => {
  let history, library, saveInstanceEdit

  beforeAll(async () => {
    await ensureLibCellmlReady()
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    history = useFlowHistoryStore()
    library = useLibraryStore()
    library.addMath(DECAY_REF, DECAY_XML)
    nodes.value = [createNode('a'), createNode('b')]
    edges.value = [{ id: 'e', source: 'a', target: 'b', data: { couplings: [] } }]
    ;({ saveInstanceEdit } = useInstanceSave())
  })

  it('undoes a fork applied to every instance as one step, and redoes it exactly', async () => {
    const before = snapshot()
    expect(await saveInstanceEdit(fork())).toBe(2)
    const after = snapshot()
    expect(findNode('b').data.mathRef).toBe(GROWTH_REF)
    expect(library.availableMath.has(GROWTH_REF)).toBe(true)
    expect(library.getGlobalConstant('g')).toBeDefined()
    expect(edges.value[0].data.couplings).not.toEqual([])

    await history.undo()
    expect(snapshot()).toEqual(before)
    expect(library.availableMath.has(GROWTH_REF)).toBe(false)
    expect(library.getGlobalConstant('g')).toBeUndefined()
    expect(history.canUndo).toBe(false)

    await history.redo()
    expect(snapshot()).toEqual(after)
    expect(library.availableMath.has(GROWTH_REF)).toBe(true)
    expect(library.getGlobalConstant('g')).toMatchObject({ value: '2' })
  })

  it('undoes an overwrite in place, including the unticked instances it rebuilt', async () => {
    const before = snapshot()
    const mathBefore = library.getMathEntry(DECAY_REF)
    await saveInstanceEdit(buildSave({ math: DECAY_WITHOUT_K }))
    expect(findNode('b').data.variables).not.toEqual(before.nodes[1].data.variables)

    await history.undo()
    expect(snapshot()).toEqual(before)
    expect(library.getMathEntry(DECAY_REF)).toEqual(mathBefore)
  })

  it('undoes a layout-only save back to no layout', async () => {
    const layout = { format: 'cellml-text', components: [] }
    await saveInstanceEdit(buildSave({ layout, isLayoutChanged: true }))
    expect(library.getMathLayout(DECAY_REF)).toEqual(layout)

    await history.undo()
    expect(library.getMathLayout(DECAY_REF)).toBeNull()
  })

  it('undoes a save after a later rename, one step at a time', async () => {
    await saveInstanceEdit(fork())
    const { recordEdit } = useNodeDataHistory()
    await recordEdit({ type: 'rename-node', nodeIds: ['a'], keys: ['name'], apply: () => (findNode('a').data = { ...findNode('a').data, name: 'later' }) })

    await history.undo()
    expect(findNode('a').data.name).toBe('a2')
    await history.undo()
    expect(findNode('a').data).toMatchObject({ name: 'a', mathRef: DECAY_REF })
  })

  it('keeps forked math and constants that another instance now uses', async () => {
    await saveInstanceEdit(fork())
    const other = createNode('c')
    other.data = { ...other.data, mathRef: GROWTH_REF, variables: [{ name: 'g', units: 'second', type: 'global_constant' }] }
    nodes.value = [...nodes.value, other]

    await history.undo()
    expect(findNode('a').data.mathRef).toBe(DECAY_REF)
    expect(library.availableMath.has(GROWTH_REF)).toBe(true)
    expect(library.getGlobalConstant('g')).toBeDefined()
  })

  it('undoes a save on an instance that was deleted and restored', async () => {
    const before = snapshot()
    await saveInstanceEdit(fork())
    const restored = reactive(detachReactivity({ id: 'a', data: findNode('a').data }))
    nodes.value = [findNode('b')]
    nodes.value = [restored, findNode('b')]

    await history.undo()
    expect(findNode('a').data).toEqual(before.nodes[0].data)
  })

  it('leaves a workspace loaded since the save untouched', async () => {
    await saveInstanceEdit(fork())
    nodes.value = [createNode('a'), createNode('b')]
    findNode('a').data = { ...findNode('a').data, name: 'loaded', mathRef: GROWTH_REF }
    edges.value = [{ id: 'e', source: 'a', target: 'b', data: { couplings: [{ loaded: true }] } }]
    library.addMath(GROWTH_REF, GROWTH_XML.replace('initial_value="0.5"', 'initial_value="9"'))
    library.assignGlobalConstant('g', '7', 'second', null, true)
    const loaded = snapshot()
    const loadedMath = library.getMathEntry(GROWTH_REF)

    await history.undo()
    expect(snapshot()).toEqual(loaded)
    expect(library.getMathEntry(GROWTH_REF)).toEqual(loadedMath)
    expect(library.getGlobalConstant('g').value).toBe('7')
  })

  it('leaves math in place when the library has changed it since an overwrite', async () => {
    await saveInstanceEdit(buildSave({ math: DECAY_WITHOUT_K }))
    library.addMath(DECAY_REF, DECAY_XML.replace('initial_value="0.5"', 'initial_value="9"'))
    const loaded = snapshot()
    const loadedMath = library.getMathEntry(DECAY_REF)

    await history.undo()
    expect(library.getMathEntry(DECAY_REF)).toEqual(loadedMath)
    expect(snapshot()).toEqual(loaded)
  })

  it('applies nothing when one rebuilt instance has changed since', async () => {
    await saveInstanceEdit(buildSave({ math: DECAY_WITHOUT_K }))
    findNode('a').data = { ...findNode('a').data, variables: [{ name: 'x', value: 'csv', type: 'variable' }] }
    const changed = snapshot()
    const savedMath = library.getMathEntry(DECAY_REF)

    await history.undo()
    expect(snapshot()).toEqual(changed)
    expect(library.getMathEntry(DECAY_REF)).toEqual(savedMath)
  })

  it('redoes nothing when only the math has changed since the undo', async () => {
    await saveInstanceEdit(buildSave({ math: DECAY_WITHOUT_K }))
    await history.undo()
    library.addMath(DECAY_REF, DECAY_XML.replace('initial_value="0.5"', 'initial_value="9"'))
    const changed = snapshot()
    const changedMath = library.getMathEntry(DECAY_REF)

    await history.redo()
    expect(snapshot()).toEqual(changed)
    expect(library.getMathEntry(DECAY_REF)).toEqual(changedMath)
  })

  it('redoes nothing when the instances have changed since the undo', async () => {
    await saveInstanceEdit(fork())
    await history.undo()
    findNode('b').data = { ...findNode('b').data, name: 'elsewhere' }
    const changed = snapshot()

    await history.redo()
    expect(snapshot()).toEqual(changed)
    expect(library.availableMath.has(GROWTH_REF)).toBe(false)
  })

  it('redoes a fork whose math an undo kept for another instance', async () => {
    await saveInstanceEdit(fork())
    const other = createNode('c')
    other.data = { ...other.data, mathRef: GROWTH_REF }
    nodes.value = [...nodes.value, other]
    await history.undo()
    expect(library.availableMath.has(GROWTH_REF)).toBe(true)

    await history.redo()
    expect(findNode('a').data.mathRef).toBe(GROWTH_REF)
  })

  it('updates a shared constant the node already used, and undo puts it back', async () => {
    library.assignGlobalConstant('g', '1', 'second', 'Smith2020')
    const globalConstants = [{ name: 'g', value: '2', units: 'metre', data_reference: null, overwrite: true }]

    await saveInstanceEdit(buildSave({ globalConstants }))
    expect(library.getGlobalConstant('g')).toEqual({ value: '2', units: 'second', data_reference: 'Smith2020' })

    await history.undo()
    expect(library.getGlobalConstant('g')).toEqual({ value: '1', units: 'second', data_reference: 'Smith2020' })
  })

  it('keeps the shared value when a row is switched to a constant that already exists', async () => {
    library.assignGlobalConstant('g', '1', 'second', null)
    const globalConstants = [{ name: 'g', value: '9', units: 'second', data_reference: null, overwrite: false }]

    await saveInstanceEdit(buildSave({ globalConstants }))
    expect(library.getGlobalConstant('g').value).toBe('1')
  })
})
