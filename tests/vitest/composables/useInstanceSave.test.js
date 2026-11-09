// @vitest-environment happy-dom
import { reactive, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { useInstanceSave } from '../../../src/composables/useInstanceSave.js'
import { useNodeDataHistory } from '../../../src/composables/useNodeDataHistory.js'
import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { useDefaultParametersStore } from '../../../src/stores/defaultParametersStore.js'
import { useSimulationSettingsStore } from '../../../src/stores/simulationSettingsStore.js'
import { NEW_MODULE_FILENAME, NEW_MODULE_REF } from '../../../src/utils/constants.js'
import { previewCouplings } from '../../../src/utils/edges.js'
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
    updateNodeData: (id, update, options = { replace: false }) => {
      const node = nodes.value.find((candidate) => candidate.id === id)
      if (!node) return
      const patch = typeof update === 'function' ? update(node) : update
      node.data = options.replace ? patch : { ...node.data, ...patch }
    },
  }),
}))

// Loaded after the mock, since it calls useVueFlow on import.
const { isModuleConfig } = await import('../../../src/services/moduleConfig.js')

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
 * Creates a node on the decay math, from the template module, with port `p` carrying `x` and `k`.
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
      moduleRef: NEW_MODULE_REF,
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
  let history, library, saveInstanceEdit, savePortEdit

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
    ;({ saveInstanceEdit, savePortEdit } = useInstanceSave())
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

  it('records the parameter set the editor applied, which undo takes off again', async () => {
    const variables = [findNode('a').data.variables[0], { ...findNode('a').data.variables[1], value: '2' }]
    await saveInstanceEdit(buildSave({ variables, parameterisation: 'fast' }))
    expect(findNode('a').data).toMatchObject({ parameterisation: 'fast', variables: [{}, { value: '2' }] })

    await history.undo()
    expect(findNode('a').data).not.toHaveProperty('parameterisation')
    expect(findNode('a').data.variables[1].value).toBe('0.5')
  })

  describe('instance parameter sets', () => {
    const editK = (value) => [findNode('a').data.variables[0], { ...findNode('a').data.variables[1], value }]
    const kOf = (ref) => useDefaultParametersStore().getSet(DECAY_REF, ref).values.get('k').value

    it('writes the edits of an instance dropped with None to its own set, which undo and redo follow', async () => {
      const parameters = useDefaultParametersStore()
      parameters.addInstanceSet(DECAY_REF, 'a', 'a', findNode('a').data.variables)
      findNode('a').data.parameterisation = 'a'

      await saveInstanceEdit(buildSave({ variables: editK('2') }))
      expect(kOf('a')).toBe('2')
      // A rename keeps the set's name.
      expect(findNode('a').data).toMatchObject({ name: 'a2', parameterisation: 'a' })

      await history.undo()
      expect(kOf('a')).toBe('0.5')
      await history.redo()
      expect(kOf('a')).toBe('2')
    })

    it('never writes to an imported set, nor to a set another instance made', async () => {
      const parameters = useDefaultParametersStore()
      const param = (value) => ({ value, units: 'per_second', data_reference: '', extra: {} })
      parameters.addSet(
        { ref: 'fast', source: { file: 'fast_parameters.json', importedAt: '' }, globals: new Map(), values: new Map([['k', param('9')]]) },
        { mathRef: DECAY_REF }
      )
      parameters.addInstanceSet(DECAY_REF, 'b', 'b', findNode('b').data.variables)

      findNode('a').data.parameterisation = 'fast'
      await saveInstanceEdit(buildSave({ variables: editK('2') }))
      expect(kOf('fast')).toBe('9')

      findNode('a').data.parameterisation = 'b'
      await saveInstanceEdit(buildSave({ variables: editK('3') }))
      expect(kOf('b')).toBe('0.5')
    })

    describe('a set others share, as the editor asked', () => {
      const param = (value) => ({ value, units: 'per_second', data_reference: 'paper', extra: {} })
      let parameters
      // Other instances' rows are rebuilt from the math, so k is found by name.
      const kAt = (id) => findNode(id).data.variables.find((row) => row.name === 'k').value

      beforeEach(() => {
        parameters = useDefaultParametersStore()
        parameters.addSet(
          { ref: 'fast', source: { file: 'fast_parameters.json', importedAt: '' }, globals: new Map(), values: new Map([['k', param('0.5')]]) },
          { mathRef: DECAY_REF }
        )
        nodes.value.push(createNode('c'))
        findNode('a').data.parameterisation = 'fast'
        findNode('b').data.parameterisation = 'fast'
      })

      it('updates the set and every other instance tagged with it, all undone as one step', async () => {
        const before = snapshot()
        const setBefore = parameters.getSet(DECAY_REF, 'fast')
        await saveInstanceEdit(buildSave({ variables: editK('2'), parameterSet: { action: 'update' } }))

        expect(kOf('fast')).toBe('2')
        expect(parameters.getSet(DECAY_REF, 'fast').values.get('k').units).toBe('per_second')
        expect(kAt('b')).toBe('2')
        // Not tagged with the set.
        expect(kAt('c')).toBe('0.5')
        expect(findNode('a').data.parameterisation).toBe('fast')

        await history.undo()
        expect(snapshot()).toEqual(before)
        expect(parameters.getSet(DECAY_REF, 'fast')).toBe(setBefore)
        expect(history.canUndo).toBe(false)

        await history.redo()
        expect(kOf('fast')).toBe('2')
        expect(kAt('b')).toBe('2')
      })

      it("makes a set of the instance's own, named after it, which later edits follow", async () => {
        parameters.addInstanceSet(DECAY_REF, 'x', 'a2', [])
        await saveInstanceEdit(buildSave({ variables: editK('3'), parameterSet: { action: 'new' } }))

        const own = parameters.getSet(DECAY_REF, 'a2_2')
        expect(own).toMatchObject({ source: { kind: 'instance', nodeId: 'a' } })
        expect(kOf('a2_2')).toBe('3')
        expect(findNode('a').data.parameterisation).toBe('a2_2')
        expect(kOf('fast')).toBe('0.5')
        expect(kAt('b')).toBe('0.5')

        await saveInstanceEdit(buildSave({ variables: editK('4') }))
        expect(kOf('a2_2')).toBe('4')

        await history.undo()
        await history.undo()
        expect(parameters.getSet(DECAY_REF, 'a2_2')).toBeNull()
        expect(findNode('a').data.parameterisation).toBe('fast')
        await history.redo()
        expect(kOf('a2_2')).toBe('3')
        expect(findNode('a').data.parameterisation).toBe('a2_2')
      })

      it('changes no set when the save changes no value the set holds otherwise', async () => {
        const setBefore = parameters.getSet(DECAY_REF, 'fast')
        await saveInstanceEdit(buildSave({ parameterSet: { action: 'update' } }))
        expect(parameters.getSet(DECAY_REF, 'fast')).toBe(setBefore)
      })
    })

    describe("the instance's own set once another instance uses it", () => {
      const kAt = (id) => findNode(id).data.variables.find((row) => row.name === 'k').value
      let parameters

      beforeEach(() => {
        parameters = useDefaultParametersStore()
        parameters.addInstanceSet(DECAY_REF, 'a', 'a', findNode('a').data.variables)
        findNode('a').data.parameterisation = 'a'
        findNode('b').data.parameterisation = 'a'
      })

      it('never writes the set without being asked', async () => {
        await saveInstanceEdit(buildSave({ variables: editK('2') }))
        expect(kOf('a')).toBe('0.5')
        expect(kAt('b')).toBe('0.5')
      })

      it('updates the set and the other instances when asked, as one step', async () => {
        const before = snapshot()
        const setBefore = parameters.getSet(DECAY_REF, 'a')
        await saveInstanceEdit(buildSave({ variables: editK('2'), parameterSet: { action: 'update' } }))
        expect(kOf('a')).toBe('2')
        expect(kAt('b')).toBe('2')
        expect(parameters.getSet(DECAY_REF, 'a')).toMatchObject({ source: { kind: 'instance', nodeId: 'a' } })

        await history.undo()
        expect(snapshot()).toEqual(before)
        expect(parameters.getSet(DECAY_REF, 'a')).toBe(setBefore)
        expect(history.canUndo).toBe(false)
      })

      it('moves the instance to a new set of its own, leaving the old one to the others', async () => {
        await saveInstanceEdit(buildSave({ variables: editK('3'), parameterSet: { action: 'new' } }))
        expect(findNode('a').data.parameterisation).toBe('a2')
        expect(kOf('a2')).toBe('3')
        expect(kOf('a')).toBe('0.5')
        expect(kAt('b')).toBe('0.5')

        // Its new set is its own alone, so later edits follow without asking.
        await saveInstanceEdit(buildSave({ variables: editK('4') }))
        expect(kOf('a2')).toBe('4')
        expect(kOf('a')).toBe('0.5')
      })
    })

    describe('an instance with no set', () => {
      it('makes a set of its own, named after it, once a save gives it a value, and undo takes both off', async () => {
        const parameters = useDefaultParametersStore()
        await saveInstanceEdit(buildSave({ variables: editK('2') }))
        expect(findNode('a').data.parameterisation).toBe('a2')
        expect(parameters.getSet(DECAY_REF, 'a2')).toMatchObject({ source: { kind: 'instance', nodeId: 'a' } })
        expect(kOf('a2')).toBe('2')

        await history.undo()
        expect(parameters.getSet(DECAY_REF, 'a2')).toBeNull()
        expect(findNode('a').data).not.toHaveProperty('parameterisation')
        expect(history.canUndo).toBe(false)
        await history.redo()
        expect(findNode('a').data.parameterisation).toBe('a2')
        expect(kOf('a2')).toBe('2')
      })

      it('numbers the set past one of the same name', async () => {
        useDefaultParametersStore().addInstanceSet(DECAY_REF, 'x', 'a2', [])
        await saveInstanceEdit(buildSave({ variables: editK('2') }))
        expect(findNode('a').data.parameterisation).toBe('a2_2')
      })

      it('makes no set when the save gives no value: unchanged, or cleared', async () => {
        const parameters = useDefaultParametersStore()
        await saveInstanceEdit(buildSave({ name: 'a' }))
        await saveInstanceEdit(buildSave({ variables: editK('') }))
        expect(parameters.setsFor(DECAY_REF)).toEqual([])
        expect(findNode('a').data).not.toHaveProperty('parameterisation')
      })

      it("makes no set for a global constant's shared value, which the editor shows on the row", async () => {
        library.assignGlobalConstant('g', '2', 'second', null)
        findNode('a').data.variables.push({ name: 'g', units: 'second', type: 'global_constant' })
        const variables = findNode('a').data.variables.map((row) => (row.name === 'g' ? { ...row, value: '2' } : row))
        await saveInstanceEdit(buildSave({ variables }))
        expect(findNode('a').data).not.toHaveProperty('parameterisation')

        await saveInstanceEdit(buildSave({ variables: variables.map((row) => (row.name === 'g' ? { ...row, value: '3' } : row)) }))
        expect(findNode('a').data.parameterisation).toBe('a2')
      })

      it("makes no set while its config's default set is loaded", async () => {
        const parameters = useDefaultParametersStore()
        parameters.addSet({ ref: 'fast', source: { file: '', importedAt: '' }, globals: new Map(), values: new Map() }, { mathRef: DECAY_REF })
        library.addModule({ moduleRef: 'decay:lib', mathRef: DECAY_REF, ports: [], variables: [], defaultParameterisation: 'fast' })
        findNode('a').data.moduleRef = 'decay:lib'
        await saveInstanceEdit(buildSave({ variables: editK('2') }))
        expect(parameters.setsFor(DECAY_REF).map((set) => set.ref)).toEqual(['fast'])
      })
    })

    it("writes to the instance's own set only while it keeps it, not to a set the editor applied", async () => {
      const parameters = useDefaultParametersStore()
      parameters.addInstanceSet(DECAY_REF, 'a', 'a', findNode('a').data.variables)
      parameters.addInstanceSet(DECAY_REF, 'b', 'b', findNode('b').data.variables)
      findNode('a').data.parameterisation = 'a'

      await saveInstanceEdit(buildSave({ variables: editK('4'), parameterisation: 'b' }))
      expect([kOf('a'), kOf('b')]).toEqual(['0.5', '0.5'])
    })
  })

  it('undoes a layout-only save back to no layout', async () => {
    const layout = { format: 'cellml-text', components: [] }
    await saveInstanceEdit(buildSave({ layout, isLayoutChanged: true }))
    expect(library.getMathLayout(DECAY_REF)).toEqual(layout)

    await history.undo()
    expect(library.getMathLayout(DECAY_REF)).toBeNull()
  })

  describe('math generated from a source', () => {
    const SOURCE = { format: 'celldl', document: '<diagram/>', documentUri: 'local:decay.celldl' }
    // The decay math as a diagram might regenerate it, with a new parameter and its value.
    const GENERATED_XML = DECAY_XML.replace(
      '<variable name="k"',
      '<variable name="c" units="metre" initial_value="3"/>\n    <variable name="k"'
    ).replace('<ci>k</ci></apply><ci>x</ci>', '<ci>k</ci></apply><apply><plus/><ci>x</ci><ci>c</ci></apply>')

    it('undoes a source-only save as one step', async () => {
      const mathBefore = library.getMathEntry(DECAY_REF)
      await saveInstanceEdit(buildSave({ name: 'a', source: SOURCE, isSourceChanged: true }))
      expect(library.getMathSource(DECAY_REF)).toEqual(SOURCE)

      await history.undo()
      expect(library.getMathEntry(DECAY_REF)).toEqual(mathBefore)
      expect(history.canUndo).toBe(false)

      await history.redo()
      expect(library.getMathSource(DECAY_REF)).toEqual(SOURCE)
    })

    it("replaces only the diagram of a save that keeps its math, leaving the module's defaults and every instance's values", async () => {
      library.setMathSource(DECAY_REF, SOURCE)
      const moved = { ...SOURCE, document: '<diagram moved/>' }
      findNode('b').data.variables[1].value = '0.7'
      const mathBefore = library.getMathEntry(DECAY_REF)
      await saveInstanceEdit(buildSave({ name: 'a', source: moved, isSourceChanged: true, updateAll: true, siblings: ['b'] }))
      expect(library.getMathEntry(DECAY_REF)).toEqual({ ...mathBefore, source: moved })
      const valueOf = (id) => findNode(id).data.variables.find((row) => row.name === 'k').value
      expect([valueOf('a'), valueOf('b')]).toEqual(['0.5', '0.7'])

      await history.undo()
      expect(library.getMathEntry(DECAY_REF)).toEqual(mathBefore)
      expect(history.canUndo).toBe(false)
    })

    it('undoes the source and its generated math together', async () => {
      const mathBefore = library.getMathEntry(DECAY_REF)
      await saveInstanceEdit(buildSave({ math: GENERATED_XML, source: SOURCE, isSourceChanged: true }))
      expect(library.getMathFormat(DECAY_REF)).toBe('celldl')

      await history.undo()
      expect(library.getMathEntry(DECAY_REF)).toEqual(mathBefore)
      expect(library.getMathFormat(DECAY_REF)).toBe('cellml')
    })

    it("saves a regenerated math's section layout with it, in the same undo step, and drops the last one's", async () => {
      const old = { format: 'cellml-text-layout', version: 1, components: [{ name: 'old' }] }
      const sections = { format: 'cellml-text-layout', version: 1, components: [{ name: 'decay' }] }
      library.setMathLayout(DECAY_REF, old)
      await saveInstanceEdit(buildSave({ math: GENERATED_XML, layout: sections, source: SOURCE, isSourceChanged: true }))
      expect(library.getMathLayout(DECAY_REF)).toEqual(sections)

      await history.undo()
      expect(library.getMathLayout(DECAY_REF)).toEqual(old)

      // Math generated without sections keeps no layout from the last generation.
      await saveInstanceEdit(buildSave({ math: GENERATED_XML, source: SOURCE, isSourceChanged: true }))
      expect(library.getMathLayout(DECAY_REF)).toBeNull()
    })

    it('undoes the source, its math and its units together, and redoes them', async () => {
      const UNITS = { componentFile: 'file', model: '<model name="file_units"><units name="per_second"/></model>' }
      library.setMathSource(DECAY_REF, SOURCE)
      const mathBefore = library.getMathEntry(DECAY_REF)
      const unitsBefore = detachReactivity(library.availableUnits)
      const edited = { ...SOURCE, document: '<diagram edited/>' }
      await saveInstanceEdit(buildSave({ math: GENERATED_XML, source: edited, isSourceChanged: true, units: UNITS }))
      expect(library.getMathSource(DECAY_REF)).toEqual(edited)
      expect(library.availableUnits).toContainEqual(UNITS)
      expect(library.getMathDefaults(DECAY_REF).get('c')).toBe('3')

      await history.undo()
      expect(library.getMathEntry(DECAY_REF)).toEqual(mathBefore)
      expect(detachReactivity(library.availableUnits)).toEqual(unitsBefore)
      expect(history.canUndo).toBe(false)

      await history.redo()
      expect(library.getMathSource(DECAY_REF)).toEqual(edited)
      expect(library.availableUnits).toContainEqual(UNITS)
    })

    it('puts back the units file a save replaced', async () => {
      library.addUnitsFile({ componentFile: 'file', model: '<model name="old"/>' })
      await saveInstanceEdit(buildSave({ source: SOURCE, isSourceChanged: true, units: { componentFile: 'file', model: '<model name="new"/>' } }))
      expect(library.availableUnits.find((file) => file.componentFile === 'file').model).toBe('<model name="new"/>')

      await history.undo()
      expect(library.availableUnits.find((file) => file.componentFile === 'file').model).toBe('<model name="old"/>')
    })

    it('removes the units file of a diagram that no longer has units, and puts it back on undo', async () => {
      library.addUnitsFile({ componentFile: 'file', model: '<model name="old"/>' })
      await saveInstanceEdit(buildSave({ source: SOURCE, isSourceChanged: true, units: { componentFile: 'file', model: null } }))
      expect(library.availableUnits.some((file) => file.componentFile === 'file')).toBe(false)

      await history.undo()
      expect(library.availableUnits.find((file) => file.componentFile === 'file').model).toBe('<model name="old"/>')
      await history.redo()
      expect(library.availableUnits.some((file) => file.componentFile === 'file')).toBe(false)
    })

    it('fills the other instances\' blank values from the generated math, keeping their own', async () => {
      await saveInstanceEdit(buildSave({ math: GENERATED_XML, source: SOURCE, isSourceChanged: true }))

      const rows = Object.fromEntries(findNode('b').data.variables.map((row) => [row.name, row]))
      expect(rows.c.value).toBe('3')
      expect(rows.k.value).toBe('0.5')
    })

    it("keeps every instance's values and the module's defaults when a diagram is saved again, so only new variables take its values", async () => {
      library.setMathSource(DECAY_REF, SOURCE)
      const own = createNode('c')
      own.data.variables = own.data.variables.map((row) => (row.name === 'k' ? { ...row, value: '3' } : row))
      nodes.value.push(own)
      const edited = GENERATED_XML.replace('initial_value="0.5"', 'initial_value="0.8"')

      await saveInstanceEdit(
        buildSave({ math: edited, source: SOURCE, isSourceChanged: true, previousDefaults: [...library.getMathDefaults(DECAY_REF)] })
      )

      const rowsOf = (id) => Object.fromEntries(findNode(id).data.variables.map((row) => [row.name, row.value]))
      expect(rowsOf('b')).toMatchObject({ k: '0.5', c: '3' })
      expect(rowsOf('c')).toMatchObject({ k: '3', c: '3' })
      expect(library.getMathDefaults(DECAY_REF).get('k')).toBe('0.5')
      expect(library.getMathDefaults(DECAY_REF).get('c')).toBe('3')
    })

    describe('units the regenerated math changed', () => {
      // x from metre to mm: a value of 2 m is 2000 mm.
      const MM_XML = GENERATED_XML.replaceAll('units="metre"', 'units="mm"')
      const RESCALES = ['x', 'x0'].map((name) => ({ name, from: 'metre', to: 'mm', factor: { coefficient: 1, power: 3 } }))
      const withX0 = (node, value) =>
        (node.data.variables = [...node.data.variables, { name: 'x0', value, units: 'metre', type: 'constant' }])

      beforeEach(() => {
        library.setMathSource(DECAY_REF, SOURCE)
        withX0(findNode('a'), '1')
        withX0(findNode('b'), '2')
      })

      it("rescales every instance's values on an overwrite, and undoes it", async () => {
        const bBefore = detachReactivity(findNode('b').data.variables)
        const variables = findNode('a').data.variables.map((row) =>
          row.name === 'x0' ? { ...row, value: '1000', units: 'mm' } : row.name === 'x' ? { ...row, units: 'mm' } : row
        )

        await saveInstanceEdit(buildSave({ math: MM_XML, source: SOURCE, isSourceChanged: true, variables, unitRescales: RESCALES }))

        const x0 = findNode('b').data.variables.find((row) => row.name === 'x0')
        expect(x0).toMatchObject({ value: '2000', units: 'mm' })
        await history.undo()
        expect(detachReactivity(findNode('b').data.variables)).toEqual(bBefore)
        await history.redo()
        expect(findNode('b').data.variables.find((row) => row.name === 'x0')).toMatchObject({ value: '2000', units: 'mm' })
      })

      it("rescales only this instance's values when saved as a new component", async () => {
        const bBefore = detachReactivity(findNode('b').data.variables)

        await saveInstanceEdit(
          buildSave({ mathRef: 'fast.cellml:fast', math: MM_XML.replaceAll('decay', 'fast'), source: SOURCE, isSourceChanged: true, unitRescales: RESCALES })
        )

        expect(detachReactivity(findNode('b').data.variables)).toEqual(bBefore)
      })

      it('leaves a row in other units alone', async () => {
        const rescales = [{ name: 'k', from: 'per_second', to: 'per_ms', factor: { coefficient: 1, power: -3 } }]
        findNode('b').data.variables = findNode('b').data.variables.map((row) => (row.name === 'k' ? { ...row, units: 'per_minute' } : row))

        await saveInstanceEdit(buildSave({ math: GENERATED_XML, source: SOURCE, isSourceChanged: true, unitRescales: rescales }))

        expect(findNode('b').data.variables.find((row) => row.name === 'k')).toMatchObject({ value: '0.5', units: 'per_minute' })
      })
    })

    it("moves every instance's values, ports and the module's defaults to the variables a diagram edit renamed", async () => {
      library.setMathSource(DECAY_REF, SOURCE)
      const own = createNode('c')
      own.data.variables = own.data.variables.map((row) => (row.name === 'k' ? { ...row, value: '3' } : row))
      nodes.value.push(own)
      const renamed = DECAY_XML.replaceAll('<ci>k</ci>', '<ci>kr</ci>').replace('name="k" units="per_second" initial_value="0.5"', 'name="kr" units="per_second" initial_value="0.8"')

      await saveInstanceEdit(
        buildSave({ math: renamed, source: SOURCE, isSourceChanged: true, previousDefaults: [...library.getMathDefaults(DECAY_REF)], renames: [['k', 'kr']] })
      )

      const rowsOf = (id) => Object.fromEntries(findNode(id).data.variables.map((row) => [row.name, row]))
      expect(rowsOf('b').kr.value).toBe('0.5')
      expect(rowsOf('b').k).toBeUndefined()
      expect(rowsOf('c').kr.value).toBe('3')
      expect(findNode('c').data.ports[0].variables).toEqual(['x', 'kr'])
      expect(library.getMathDefaults(DECAY_REF).get('kr')).toBe('0.5')
    })

    describe('a diagram saved under a new component name', () => {
      const NEW_REF = 'fast.cellml:fast'
      const NEW_SOURCE = { format: 'celldl', document: '<diagram copied/>', documentUri: 'local:fast.cellml_fast.celldl' }
      const NEW_UNITS = { componentFile: 'fast.cellml', model: '<model name="fast_units"/>' }
      const renamedSave = (overrides) =>
        buildSave({
          mathRef: NEW_REF,
          math: GENERATED_XML.replaceAll('decay', 'fast').replace('initial_value="0.5"', 'initial_value="0.8"'),
          source: NEW_SOURCE,
          isSourceChanged: true,
          units: NEW_UNITS,
          previousDefaults: [...library.getMathDefaults(DECAY_REF)],
          ...overrides,
        })

      beforeEach(() => {
        library.setMathSource(DECAY_REF, SOURCE)
        library.addUnitsFile({ componentFile: 'file', model: '<model name="file_units"/>' })
      })

      it('makes a new module for this instance only, leaving the old one and its other instances alone', async () => {
        const decayBefore = library.getMathEntry(DECAY_REF)
        const bBefore = detachReactivity(findNode('b').data)

        await saveInstanceEdit(renamedSave())

        expect(findNode('a').data).toMatchObject({ mathRef: NEW_REF, moduleRef: 'fast:default' })
        expect(detachReactivity(findNode('b').data)).toEqual(bBefore)
        expect(library.getMathEntry(DECAY_REF)).toEqual(decayBefore)
        expect(library.getMathSource(NEW_REF)).toEqual(NEW_SOURCE)
        expect(library.availableUnits.find((file) => file.componentFile === 'file').model).toBe('<model name="file_units"/>')
        expect(library.availableUnits).toContainEqual(NEW_UNITS)
        // The new module keeps the old one's defaults for the variables it already had.
        expect(library.getMathDefaults(NEW_REF).get('k')).toBe('0.5')
        expect(library.getMathDefaults(NEW_REF).get('c')).toBe('3')

        await history.undo()
        expect(findNode('a').data.mathRef).toBe(DECAY_REF)
        expect(library.availableMath.has(NEW_REF)).toBe(false)
        expect(library.availableUnits.some((file) => file.componentFile === 'fast.cellml')).toBe(false)
        expect(library.getMathSource(NEW_REF)).toBeNull()
        expect(library.availableModules.has('fast:default')).toBe(false)
        expect(library.getMathEntry(DECAY_REF)).toEqual(decayBefore)

        await history.redo()
        expect(findNode('a').data).toMatchObject({ mathRef: NEW_REF, moduleRef: 'fast:default' })
        expect(library.getMathSource(NEW_REF)).toEqual(NEW_SOURCE)
        expect(library.availableUnits).toContainEqual(NEW_UNITS)
        expect(library.availableModules.has('fast:default')).toBe(true)
        expect(library.getMathEntry(DECAY_REF)).toEqual(decayBefore)
      })

      it('moves the other instances too when the save applies to all, keeping their values', async () => {
        findNode('b').data.variables = findNode('b').data.variables.map((row) => (row.name === 'k' ? { ...row, value: '7' } : row))

        expect(await saveInstanceEdit(renamedSave({ updateAll: true, siblings: ['b'] }))).toBe(2)

        expect(findNode('b').data).toMatchObject({ mathRef: NEW_REF, moduleRef: 'fast:default' })
        const rows = Object.fromEntries(findNode('b').data.variables.map((row) => [row.name, row.value]))
        expect(rows).toMatchObject({ k: '7', c: '3' })
        expect(library.getMathSource(DECAY_REF)).toEqual(SOURCE)
      })
    })

    describe("a diagram renamed onto another diagram's module", () => {
      const OTHER_REF = 'growth.cellml:growth'
      const OTHER_SOURCE = { format: 'celldl', document: '<diagram growth/>', documentUri: 'local:growth.celldl' }
      const OVERWRITTEN = { format: 'celldl', document: '<diagram decay renamed/>', documentUri: 'local:growth.celldl' }
      const UNITS = { componentFile: 'growth.cellml', model: '<model name="new_units"/>' }

      beforeEach(() => {
        library.addMath(OTHER_REF, GROWTH_XML)
        library.setMathSource(OTHER_REF, OTHER_SOURCE)
        library.addUnitsFile({ componentFile: 'growth.cellml', model: '<model name="old_units"/>' })
        const other = createNode('c')
        other.data.mathRef = OTHER_REF
        other.data.variables = other.data.variables.map((row) => (row.name === 'k' ? { ...row, value: '9' } : row))
        nodes.value.push(other)
      })

      it("overwrites it and moves this instance to it, leaving its instances' rows unrenamed, and undoes as one step", async () => {
        const otherBefore = library.getMathEntry(OTHER_REF)
        const renamed = GROWTH_XML.replaceAll('<ci>k</ci>', '<ci>kr</ci>').replace('name="k" units', 'name="kr" units')
        const variables = findNode('a').data.variables.map((row) => (row.name === 'k' ? { ...row, name: 'kr' } : row))

        await saveInstanceEdit(
          buildSave({ mathRef: OTHER_REF, math: renamed, source: OVERWRITTEN, isSourceChanged: true, units: UNITS, variables, renames: [['k', 'kr']] })
        )

        expect(findNode('a').data.mathRef).toBe(OTHER_REF)
        expect(findNode('b').data.mathRef).toBe(DECAY_REF)
        expect(library.getMathSource(OTHER_REF)).toEqual(OVERWRITTEN)
        expect(library.availableUnits).toContainEqual(UNITS)
        // Its own instance's rows follow its math, not this diagram's renames.
        const rows = Object.fromEntries(findNode('c').data.variables.map((row) => [row.name, row]))
        expect(rows.kr.value).not.toBe('9')
        expect(findNode('c').data.ports.flatMap((port) => port.variables)).not.toContain('kr')

        await history.undo()
        expect(findNode('a').data.mathRef).toBe(DECAY_REF)
        expect(library.getMathEntry(OTHER_REF)).toEqual(otherBefore)
        expect(library.availableUnits.find((file) => file.componentFile === 'growth.cellml').model).toBe('<model name="old_units"/>')
      })
    })

    it('leaves the other instances\' new rows blank for CellML math', async () => {
      await saveInstanceEdit(buildSave({ math: GENERATED_XML }))

      const rows = Object.fromEntries(findNode('b').data.variables.map((row) => [row.name, row]))
      expect(rows.c.value ?? '').toBe('')
    })
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

  it('couples the edited ports as the instance editor previews them', async () => {
    const ports = [{ label: 'p', portType: 'general_ports', variables: ['k', 'x'] }]
    edges.value = [
      { id: 'e', source: 'a', target: 'b', data: { couplings: [] } },
      { id: 'f', source: 'b', target: 'a', data: { couplings: [] } },
    ]
    const preview = new Map(detachReactivity([...previewCouplings('a', ports, nodes.value, edges.value)]))

    await saveInstanceEdit(buildSave({ ports }))
    expect(detachReactivity(edges.value.map((edge) => edge.data.couplings))).toEqual([preview.get('e'), preview.get('f')])
    expect(preview.get('e')).toHaveLength(1)
  })

  describe('a coupling that drives a store', () => {
    const ports = (name) => [{ label: 'p', portType: 'general_ports', variables: [name] }]
    const drive = (couplings) => couplings.map((coupling) => ({ ...coupling, drivesState: true }))

    beforeEach(() => {
      // One variable a side, as a coupling pairs ports with the same number of variables. The variable must be one
      // b has, or the save's port clean-up drops the port.
      findNode('b').data.ports = ports('x')
      edges.value = [{ id: 'e', source: 'a', target: 'b', data: { couplings: [] } }]
      edges.value[0].data.couplings = drive(previewCouplings('a', ports('x'), nodes.value, edges.value).get('e'))
    })

    it('keeps its mark while it joins the same variables', async () => {
      await saveInstanceEdit(buildSave({ ports: ports('x') }))
      expect(edges.value[0].data.couplings[0].drivesState).toBe(true)
    })

    it('loses its mark when the port now joins another variable', async () => {
      await saveInstanceEdit(buildSave({ ports: ports('k') }))
      expect(edges.value[0].data.couplings[0].drivesState).toBeUndefined()
      expect(edges.value[0].data.couplings[0].sourcePort.variables).toEqual(['k'])

      await history.undo()
      expect(edges.value[0].data.couplings[0].drivesState).toBe(true)
    })

    it('keeps the mark the save confirmed, under the names before a rename', async () => {
      const confirmed = detachReactivity(edges.value[0].data.couplings)
      await saveInstanceEdit(buildSave({ ports: ports('k'), drivenCouplings: [['e', confirmed]] }))
      expect(edges.value[0].data.couplings[0]).toMatchObject({ drivesState: true, sourcePort: { variables: ['k'] } })
    })
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

  it('leaves math in place when the library has changed its source since an overwrite', async () => {
    await saveInstanceEdit(buildSave({ math: DECAY_WITHOUT_K }))
    library.setMathSource(DECAY_REF, { format: 'celldl', document: null, documentUri: 'https://example.org/decay.celldl' })
    const loadedMath = library.getMathEntry(DECAY_REF)

    await history.undo()
    expect(library.getMathEntry(DECAY_REF)).toEqual(loadedMath)
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

  describe('new components', () => {
    const GROWTH_MODULE_REF = 'growth:default'

    it('adds a module for the new math, used by every instance saved, and undo and redo remove and put it back', async () => {
      await saveInstanceEdit(fork())
      expect([...library.availableCollections.get(GROWTH_REF)]).toEqual([GROWTH_MODULE_REF])
      expect(library.availableModules.get(GROWTH_MODULE_REF)).toMatchObject({ mathRef: GROWTH_REF, ports: findNode('a').data.ports })
      expect(findNode('a').data.moduleRef).toBe(GROWTH_MODULE_REF)
      expect(findNode('b').data.moduleRef).toBe(GROWTH_MODULE_REF)

      await history.undo()
      expect(library.availableModules.has(GROWTH_MODULE_REF)).toBe(false)
      expect(library.availableCollections.has(GROWTH_REF)).toBe(false)
      expect(findNode('a').data.moduleRef).toBe(NEW_MODULE_REF)

      await history.redo()
      expect([...library.availableCollections.get(GROWTH_REF)]).toEqual([GROWTH_MODULE_REF])
      expect(library.availableModules.get(GROWTH_MODULE_REF).isStub).toBeUndefined()
      expect(findNode('b').data.moduleRef).toBe(GROWTH_MODULE_REF)
    })

    it('moves only the edited node to math saved for it alone, and undo puts it back in one step', async () => {
      const before = snapshot()
      const mathBefore = library.getMathEntry(DECAY_REF)
      const growth = buildSave({ mathRef: GROWTH_REF, math: GROWTH_XML })
      expect(await saveInstanceEdit(growth)).toBe(1)
      expect(findNode('a').data).toMatchObject({ mathRef: GROWTH_REF, moduleRef: GROWTH_MODULE_REF })
      // Made for this instance's math, the module is its own config.
      expect(library.availableModules.get(GROWTH_MODULE_REF).source).toEqual({ kind: 'instance', nodeId: 'a' })
      expect(findNode('b').data).toEqual(before.nodes[1].data)
      expect(library.getMathEntry(DECAY_REF)).toEqual(mathBefore)

      await history.undo()
      expect(snapshot()).toEqual(before)
      expect(library.availableMath.has(GROWTH_REF)).toBe(false)
      expect(library.availableModules.has(GROWTH_MODULE_REF)).toBe(false)
      expect(history.canUndo).toBe(false)
    })

    it('moves only the siblings on the edited node\'s module to the new one', async () => {
      findNode('b').data.moduleRef = 'decay:fast'
      await saveInstanceEdit(fork())
      expect(findNode('a').data.moduleRef).toBe(GROWTH_MODULE_REF)
      expect(findNode('b').data).toMatchObject({ mathRef: GROWTH_REF, moduleRef: 'decay:fast' })

      await history.undo()
      expect(findNode('b').data).toMatchObject({ mathRef: DECAY_REF, moduleRef: 'decay:fast' })
      expect(library.availableModules.has(GROWTH_MODULE_REF)).toBe(false)
    })

    it('keeps the module an undo would remove while another node uses it', async () => {
      await saveInstanceEdit(fork())
      const other = createNode('c')
      other.data = { ...other.data, mathRef: GROWTH_REF, moduleRef: GROWTH_MODULE_REF }
      nodes.value = [...nodes.value, other]

      await history.undo()
      expect(findNode('a').data.moduleRef).toBe(NEW_MODULE_REF)
      expect(library.availableModules.has(GROWTH_MODULE_REF)).toBe(true)
    })

    it('gives components saved from the template distinct modules, even when a library module has the name', async () => {
      library.addModule({ moduleRef: GROWTH_MODULE_REF, mathRef: 'library.cellml:growth', ports: [], variables: [] })
      const templateGrowth = `${NEW_MODULE_FILENAME}:growth`
      const templateOther = `${NEW_MODULE_FILENAME}:other`

      await saveInstanceEdit(buildSave({ mathRef: templateGrowth, math: GROWTH_XML }))
      await saveInstanceEdit(buildSave({ id: 'b', mathRef: templateOther, math: GROWTH_XML.replaceAll('growth', 'other') }))
      expect(findNode('a').data.moduleRef).toBe('growth:default_2')
      expect(findNode('b').data.moduleRef).toBe('other:default')
      expect([...library.availableCollections.get(templateGrowth)]).toEqual(['growth:default_2'])
      expect([...library.availableCollections.get('library.cellml:growth')]).toEqual([GROWTH_MODULE_REF])
    })

    it('makes a diagram saved from the template a CellDL module in its own file, and undo removes it all', async () => {
      const mathRef = 'growth.cellml:growth'
      const source = { format: 'celldl', document: '<diagram/>', documentUri: 'local:growth.celldl' }
      const units = { componentFile: 'growth.cellml', model: '<model name="units"/>' }
      await saveInstanceEdit(buildSave({ mathRef, math: GROWTH_XML, source, isSourceChanged: true, units }))

      expect(library.getMathFormat(mathRef)).toBe('celldl')
      expect(library.getMathSource(mathRef)).toEqual(source)
      expect(library.availableUnits.find((file) => file.componentFile === 'growth.cellml')?.model).toBe(units.model)
      expect(findNode('a').data).toMatchObject({ mathRef, moduleRef: 'growth:default' })
      expect(findNode('b').data.mathRef).toBe(DECAY_REF)

      await history.undo()
      expect(library.availableMath.has(mathRef)).toBe(false)
      expect(library.getMathSource(mathRef)).toBeNull()
      expect(library.availableUnits.some((file) => file.componentFile === 'growth.cellml')).toBe(false)
    })

    it('writes math whose ids alone changed without making a module, and undo puts the math back', async () => {
      const before = library.availableMath.get(DECAY_REF)
      const withId = before.replace('<variable name="x"', '<variable name="x" id="vx0000000"')
      await saveInstanceEdit(buildSave({ math: withId, idsChanged: true }))
      expect(library.availableMath.get(DECAY_REF)).toContain('id="vx0000000"')
      expect(library.availableCollections.has(DECAY_REF)).toBe(false)
      expect(findNode('a').data.moduleRef).toBe(NEW_MODULE_REF)

      await history.undo()
      expect(library.availableMath.get(DECAY_REF)).toBe(before)
    })

    it('leaves the module alone when the math already has one', async () => {
      library.addModule({ moduleRef: 'decay:default', mathRef: DECAY_REF, ports: [], variables: [] })
      await saveInstanceEdit(buildSave({ math: DECAY_WITHOUT_K }))
      expect(findNode('a').data.moduleRef).toBe(NEW_MODULE_REF)
      expect([...library.availableCollections.get(DECAY_REF)]).toEqual(['decay:default'])
    })
  })

  describe('module configs', () => {
    const BASE_REF = 'decay:base'
    const baseModule = () => ({
      moduleRef: BASE_REF,
      mathRef: DECAY_REF,
      ports: [{ label: 'p', portType: 'general_ports', variables: ['x', 'k'] }],
      variables: [
        { name: 'x', value: null, units: 'metre', access: 'access', type: 'variable', data_reference: null },
        { name: 'k', value: '0.5', units: 'per_second', access: 'access', type: 'constant', data_reference: null },
      ],
    })
    const ports = [{ label: 'q', portType: 'general_ports', variables: ['x'] }]
    const variables = () =>
      findNode('a').data.variables.map((row) => (row.name === 'k' ? { ...row, value: '3', units: 'per_minute' } : row))
    const module = (ref = BASE_REF) => detachReactivity(library.availableModules.get(ref) ?? null)

    beforeEach(() => {
      library.addModule(baseModule())
      nodes.value.forEach((node) => (node.data.moduleRef = BASE_REF))
      findNode('b').data.variables[1].value = '7'
    })

    it('updates the module and every other instance on it, keeping their values, and undo puts both back', async () => {
      const before = snapshot()
      const moduleBefore = module()
      await saveInstanceEdit(buildSave({ ports, variables: variables(), config: { action: 'update' } }))
      const after = snapshot()
      const moduleAfter = module()
      expect(moduleAfter.ports).toEqual(ports)
      expect(moduleAfter.variables.find((row) => row.name === 'k')).toMatchObject({ units: 'per_minute', value: '0.5' })
      expect(findNode('b').data.ports).toEqual(ports)
      expect(findNode('b').data.variables.find((row) => row.name === 'k')).toMatchObject({ units: 'per_minute', value: '7' })

      await history.undo()
      expect(snapshot()).toEqual(before)
      expect(module()).toEqual(moduleBefore)
      expect(history.canUndo).toBe(false)

      await history.redo()
      expect(snapshot()).toEqual(after)
      expect(module()).toEqual(moduleAfter)
    })

    it('saves a new config for this instance alone, and undo removes it', async () => {
      const before = snapshot()
      const config = { action: 'new', moduleRef: 'decay:a_only' }
      await saveInstanceEdit(buildSave({ ports, variables: variables(), config }))
      expect(findNode('a').data.moduleRef).toBe('decay:a_only')
      expect(module('decay:a_only')).toMatchObject({ mathRef: DECAY_REF, ports, source: { kind: 'instance', nodeId: 'a' } })
      expect([...library.availableCollections.get(DECAY_REF)]).toContain('decay:a_only')
      expect(findNode('b').data).toMatchObject({ moduleRef: BASE_REF, ports: before.nodes[1].data.ports })
      expect(module()).toEqual(baseModule())

      await history.undo()
      expect(snapshot()).toEqual(before)
      expect(library.availableModules.has('decay:a_only')).toBe(false)

      await history.redo()
      expect(findNode('a').data.moduleRef).toBe('decay:a_only')
      expect(module('decay:a_only')).toMatchObject({ ports, source: { kind: 'instance', nodeId: 'a' } })
    })

    it('keeps the instance that made a config its owner when it is overwritten', async () => {
      library.replaceModule({ ...baseModule(), source: { kind: 'instance', nodeId: 'a' } })
      await saveInstanceEdit(buildSave({ ports, variables: variables(), config: { action: 'update' } }))
      expect(module()).toMatchObject({ ports, source: { kind: 'instance', nodeId: 'a' } })
      await history.undo()
      expect(module()).toEqual({ ...baseModule(), source: { kind: 'instance', nodeId: 'a' } })
    })

    it('moves the module to math every instance switched to, and undo moves it back', async () => {
      library.addMath(GROWTH_REF, GROWTH_XML)
      library.addModule({ moduleRef: 'growth:lib', mathRef: GROWTH_REF, ports: [], variables: [] })
      const config = { action: 'follow' }
      await saveInstanceEdit(buildSave({ mathRef: GROWTH_REF, math: GROWTH_XML, updateAll: true, siblings: ['b'], config }))
      expect(module().mathRef).toBe(GROWTH_REF)
      expect([...library.availableCollections.get(GROWTH_REF)]).toContain(BASE_REF)

      await history.undo()
      expect(module().mathRef).toBe(DECAY_REF)
      expect([...library.availableCollections.get(DECAY_REF)]).toContain(BASE_REF)
    })

    it('moves the module it leaves to math every instance switched to, and undo puts both modules back', async () => {
      library.addMath(GROWTH_REF, GROWTH_XML)
      library.addModule({ moduleRef: 'growth:lib', mathRef: GROWTH_REF, ports: [], variables: [] })
      const config = { action: 'new', moduleRef: 'decay:a_only', follow: true }
      await saveInstanceEdit(buildSave({ mathRef: GROWTH_REF, math: GROWTH_XML, updateAll: true, siblings: ['b'], ports, config }))
      expect(findNode('a').data.moduleRef).toBe('decay:a_only')
      expect(module().mathRef).toBe(GROWTH_REF)
      expect(module('decay:a_only')).toMatchObject({ mathRef: GROWTH_REF, ports })

      await history.undo()
      expect(module()).toEqual(baseModule())
      expect(library.availableModules.has('decay:a_only')).toBe(false)

      await history.redo()
      expect(module().mathRef).toBe(GROWTH_REF)
      expect(module('decay:a_only')).toMatchObject({ ports })
    })

    /**
     * Checks that every node's ports and variable kinds are its module's.
     */
    const expectNodesMatchModules = () =>
      nodes.value.forEach(({ id, data }) => {
        const nodeModule = library.availableModules.get(data.moduleRef)
        expect(isModuleConfig(data, nodeModule, library.getMathAnalysis(nodeModule.mathRef)), id).toBe(true)
      })

    it('updates a module only this instance uses, and undo puts it back', async () => {
      findNode('b').data.moduleRef = NEW_MODULE_REF
      const before = snapshot()
      await saveInstanceEdit(buildSave({ ports, variables: variables(), config: { action: 'update' } }))
      expect(module().ports).toEqual(ports)
      expect(findNode('b').data).toMatchObject({ moduleRef: NEW_MODULE_REF, ports: before.nodes[1].data.ports })

      await history.undo()
      expect(snapshot()).toEqual(before)
      expect(module()).toEqual(baseModule())
    })

    describe('with math saved as a new component for every instance', () => {
      const GROWTH_MODULE_REF = 'growth:default'
      const growth = (config, overrides = {}) =>
        buildSave({ mathRef: GROWTH_REF, math: GROWTH_XML, updateAll: true, siblings: ['b'], ports, variables: variables(), config, ...overrides })

      beforeEach(() => {
        library.replaceModule({ ...baseModule(), variables: detachReactivity(findNode('a').data.variables) })
        expectNodesMatchModules()
      })

      it('gives the instances that switch this one\'s ports and kinds on update, and undo puts every module back', async () => {
        const before = snapshot()
        const moduleBefore = module()
        await saveInstanceEdit(growth({ action: 'update' }))
        expect(findNode('b').data).toMatchObject({ moduleRef: GROWTH_MODULE_REF, ports })
        expect(findNode('b').data.variables.find((row) => row.name === 'k')).toMatchObject({ units: 'per_minute', value: '7' })
        expect(module(GROWTH_MODULE_REF)).toMatchObject({ mathRef: GROWTH_REF, ports })
        expect(module()).toEqual(moduleBefore)
        expectNodesMatchModules()

        await history.undo()
        expect(snapshot()).toEqual(before)
        expect(module()).toEqual(moduleBefore)
        expect(library.availableModules.has(GROWTH_MODULE_REF)).toBe(false)

        await history.redo()
        expectNodesMatchModules()
      })

      it('builds the new math\'s module from the instances that switch when this one saves a new config', async () => {
        const before = snapshot()
        const moduleBefore = module()
        await saveInstanceEdit(growth({ action: 'new', moduleRef: 'growth:a_only' }))
        expect(findNode('a').data.moduleRef).toBe('growth:a_only')
        expect(module('growth:a_only')).toMatchObject({ mathRef: GROWTH_REF, ports })
        expect(findNode('b').data).toMatchObject({ moduleRef: GROWTH_MODULE_REF, ports: before.nodes[1].data.ports })
        expect(module(GROWTH_MODULE_REF)).toMatchObject({ mathRef: GROWTH_REF, ports: moduleBefore.ports })
        // The new math's module is the switching instances', so no one's own; the new config is this one's.
        expect(module(GROWTH_MODULE_REF).source).toBeUndefined()
        expect(module('growth:a_only').source).toEqual({ kind: 'instance', nodeId: 'a' })
        expect(module()).toEqual(moduleBefore)
        expectNodesMatchModules()

        await history.undo()
        expect(snapshot()).toEqual(before)
        expect(library.availableModules.has('growth:a_only')).toBe(false)
        expect(library.availableModules.has(GROWTH_MODULE_REF)).toBe(false)

        await history.redo()
        expectNodesMatchModules()
      })

      it('builds the new math\'s module from what the switching instances keep when that math drops a port\'s variable', async () => {
        const before = snapshot()
        const math = GROWTH_XML.replace('<variable name="k" units="per_second" initial_value="0.5"/>', '').replace(
          '<apply><times/><ci>k</ci><ci>x</ci></apply>',
          '<ci>x</ci>'
        )
        const rows = variables().filter((row) => row.name !== 'k')
        await saveInstanceEdit(growth({ action: 'new', moduleRef: 'growth:a_only' }, { math, variables: rows }))
        expect(findNode('b').data.ports).toEqual([])
        expect(module(GROWTH_MODULE_REF)).toMatchObject({ ports: [] })
        expect(module(GROWTH_MODULE_REF).variables.some((row) => row.name === 'k')).toBe(false)
        expectNodesMatchModules()

        await history.undo()
        expect(snapshot()).toEqual(before)
        expect(library.availableModules.has(GROWTH_MODULE_REF)).toBe(false)

        await history.redo()
        expectNodesMatchModules()
      })
    })

    describe('with saved math that drops a variable the module\'s port carries', () => {
      const math = DECAY_XML.replace('<variable name="k" units="per_second" initial_value="0.5"/>', '').replace(
        '<apply><times/><apply><minus/><ci>k</ci></apply><ci>x</ci></apply>',
        '<ci>x</ci>'
      )
      const rows = () => findNode('a').data.variables.filter((row) => row.name !== 'k')

      beforeEach(() => library.replaceModule({ ...baseModule(), variables: detachReactivity(findNode('a').data.variables) }))

      it('gives the module it leaves the instances staying on it, and undo puts it back', async () => {
        const before = snapshot()
        const moduleBefore = module()
        const config = { action: 'new', moduleRef: 'decay:a_only' }
        await saveInstanceEdit(buildSave({ math, updateAll: true, siblings: ['b'], ports, variables: rows(), config }))
        expect(findNode('b').data.ports).toEqual([])
        expect(module()).toMatchObject({ ports: [] })
        expectNodesMatchModules()

        await history.undo()
        expect(snapshot()).toEqual(before)
        expect(module()).toEqual(moduleBefore)

        await history.redo()
        expectNodesMatchModules()
      })
    })

    it("keeps a store mark the save confirmed on the edge of another instance its update reaches", async () => {
      nodes.value.push(createNode('s'))
      findNode('s').data.ports = ports
      // b's port is held by this edge alone.
      edges.value = [{ id: 's--b', source: 's', target: 'b', data: { couplings: [] } }]
      const marked = [{ sourcePort: ports[0], targetPort: ports[0], drivesState: true }]
      await saveInstanceEdit(buildSave({ ports, variables: variables(), config: { action: 'update' }, drivenCouplings: [['s--b', marked]] }))
      expect(findNode('b').data.ports).toEqual(ports)
      expect(edges.value[0].data.couplings).toEqual([expect.objectContaining({ drivesState: true })])
    })

    it('leaves the module alone without a config', async () => {
      await saveInstanceEdit(buildSave({ ports }))
      expect(module()).toEqual(baseModule())
      expect(findNode('b').data.ports).not.toEqual(ports)
    })

    describe("the default set of the instance's own config", () => {
      const editK = (value) => findNode('a').data.variables.map((row) => (row.name === 'k' ? { ...row, value } : row))
      const own = { kind: 'instance', nodeId: 'a' }

      it('is the set a value saved on the instance makes, undone with it', async () => {
        library.replaceModule({ ...baseModule(), source: own })
        findNode('b').data.moduleRef = NEW_MODULE_REF
        const moduleBefore = module()
        await saveInstanceEdit(buildSave({ variables: editK('2'), config: { action: 'update' } }))
        expect(module()).toMatchObject({ defaultParameterisation: 'a2' })

        await history.undo()
        expect(module()).toEqual(moduleBefore)
        expect(useDefaultParametersStore().getSet(DECAY_REF, 'a2')).toBeNull()
        expect(history.canUndo).toBe(false)
        await history.redo()
        expect(module()).toMatchObject({ defaultParameterisation: 'a2' })
      })

      it("is the instance's own set once it creates a new config, which undo removes", async () => {
        useDefaultParametersStore().addInstanceSet(DECAY_REF, 'a', 'a', findNode('a').data.variables)
        findNode('a').data.parameterisation = 'a'
        await saveInstanceEdit(buildSave({ ports, config: { action: 'new', moduleRef: 'decay:a_only' } }))
        expect(module('decay:a_only')).toMatchObject({ source: own, defaultParameterisation: 'a' })
        expect(module()).toEqual(baseModule())

        await history.undo()
        expect(library.availableModules.has('decay:a_only')).toBe(false)
        await history.redo()
        expect(module('decay:a_only')).toMatchObject({ defaultParameterisation: 'a' })
      })

      it('is given from a ports edit outside the editor too', async () => {
        useDefaultParametersStore().addInstanceSet(DECAY_REF, 'a', 'a', findNode('a').data.variables)
        findNode('a').data.parameterisation = 'a'
        await savePortEdit({ type: 'edit-connection', ports: [['a', []]], configs: new Map([['a', { action: 'new', moduleRef: 'decay:a_only' }]]) })
        expect(module('decay:a_only')).toMatchObject({ defaultParameterisation: 'a' })
      })

      it('stays empty on a library config, and on an own config another instance uses', async () => {
        await saveInstanceEdit(buildSave({ variables: editK('2'), config: { action: 'update' } }))
        expect(findNode('a').data.parameterisation).toBe('a2')
        expect(module()).not.toHaveProperty('defaultParameterisation')

        library.replaceModule({ ...module(), source: own })
        await saveInstanceEdit(buildSave({ variables: editK('3'), config: { action: 'update' } }))
        expect(module()).not.toHaveProperty('defaultParameterisation')
      })

      it('keeps a default the config already names', async () => {
        library.replaceModule({ ...baseModule(), source: own, defaultParameterisation: 'slow' })
        findNode('b').data.moduleRef = NEW_MODULE_REF
        await saveInstanceEdit(buildSave({ variables: editK('2'), config: { action: 'update' } }))
        expect(findNode('a').data.parameterisation).toBe('a2')
        expect(module().defaultParameterisation).toBe('slow')
      })
    })

    describe('in the same save as values changed from a shared parameter set', () => {
      const param = (value) => ({ value, units: 'per_second', data_reference: '', extra: {} })
      // A port deleted and k changed, in one save.
      const portDeleted = () => buildSave({ ports: [], variables: editK('3') })
      const editK = (value) => findNode('a').data.variables.map((row) => (row.name === 'k' ? { ...row, value } : row))
      const kAt = (id) => findNode(id).data.variables.find((row) => row.name === 'k').value
      let parameters

      beforeEach(() => {
        parameters = useDefaultParametersStore()
        parameters.addSet(
          { ref: 'fast', source: { file: 'fast_parameters.json', importedAt: '' }, globals: new Map(), values: new Map([['k', param('0.5')]]) },
          { mathRef: DECAY_REF }
        )
        library.replaceModule({ ...baseModule(), defaultParameterisation: 'fast' })
        findNode('b').data.variables[1].value = '0.5'
        nodes.value.forEach((node) => (node.data.parameterisation = 'fast'))
      })

      it('saves a new config carrying the default set and updates the set, all undone as one step', async () => {
        const before = snapshot()
        const setBefore = parameters.getSet(DECAY_REF, 'fast')
        const config = { action: 'new', moduleRef: 'decay:a_only' }
        await saveInstanceEdit({ ...portDeleted(), config, parameterSet: { action: 'update' } })

        expect(findNode('a').data).toMatchObject({ moduleRef: 'decay:a_only', ports: [], parameterisation: 'fast' })
        expect(module('decay:a_only')).toMatchObject({ ports: [], defaultParameterisation: 'fast' })
        expect(parameters.getSet(DECAY_REF, 'fast').values.get('k').value).toBe('3')
        expect(findNode('b').data).toMatchObject({ moduleRef: BASE_REF, ports: before.nodes[1].data.ports })
        expect(kAt('b')).toBe('3')

        await history.undo()
        expect(snapshot()).toEqual(before)
        expect(library.availableModules.has('decay:a_only')).toBe(false)
        expect(parameters.getSet(DECAY_REF, 'fast')).toBe(setBefore)
        expect(history.canUndo).toBe(false)

        await history.redo()
        expect(findNode('a').data.moduleRef).toBe('decay:a_only')
        expect(parameters.getSet(DECAY_REF, 'fast').values.get('k').value).toBe('3')
      })

      it("updates the module's config and gives the instance a set of its own, all undone as one step", async () => {
        const before = snapshot()
        const moduleBefore = module()
        await saveInstanceEdit({ ...portDeleted(), config: { action: 'update' }, parameterSet: { action: 'new' } })

        expect(module()).toMatchObject({ ports: [], defaultParameterisation: 'fast' })
        expect(findNode('b').data.ports).toEqual([])
        expect(kAt('b')).toBe('0.5')
        expect(findNode('a').data.parameterisation).toBe('a2')
        expect(parameters.getSet(DECAY_REF, 'a2').values.get('k').value).toBe('3')
        expect(parameters.getSet(DECAY_REF, 'fast').values.get('k').value).toBe('0.5')

        await history.undo()
        expect(snapshot()).toEqual(before)
        expect(module()).toEqual(moduleBefore)
        expect(parameters.getSet(DECAY_REF, 'a2')).toBeNull()
        expect(history.canUndo).toBe(false)
      })
    })

    describe('from a ports edit outside the editor', () => {
      // The connection dialog's ports carry ids of their own.
      const dialogPorts = (id, list) => list.map((port, index) => ({ ...port, _uid: `${id}_${index}` }))
      const coupling = { sourcePort: { label: 'p' }, targetPort: { label: 'p' } }
      const portEdit = (configs, aPorts = [], bPorts = findNode('b').data.ports) =>
        savePortEdit({
          type: 'edit-connection',
          ports: [
            ['a', dialogPorts('a', aPorts)],
            ['b', dialogPorts('b', bPorts)],
          ],
          configs: new Map(configs),
          apply: () => (edges.value[0].data = { ...edges.value[0].data, couplings: [coupling] }),
        })

      it('updates the module and every other instance, without the dialog’s ids, as one undo step', async () => {
        nodes.value.push(createNode('c'))
        nodes.value[2].data.moduleRef = BASE_REF
        const before = snapshot()
        await portEdit([['a', { action: 'update' }]])
        const after = snapshot()
        expect(module().ports).toEqual([])
        expect(findNode('c').data.ports).toEqual([])
        expect(findNode('a').data.ports).toEqual([])

        await history.undo()
        expect(snapshot()).toEqual(before)
        expect(module()).toEqual(baseModule())
        expect(history.canUndo).toBe(false)

        await history.redo()
        expect(snapshot()).toEqual(after)
        expect(module().ports).toEqual([])
      })

      it('gives an instance at the other end on the same module the update, not the ports it was shown with', async () => {
        await portEdit([['a', { action: 'update' }]])
        expect(findNode('b').data.ports).toEqual([])
      })

      it('saves a new config for this instance alone, and undo removes it', async () => {
        const before = snapshot()
        await portEdit([['a', { action: 'new', moduleRef: 'decay:a_only' }]], ports)
        expect(findNode('a').data.moduleRef).toBe('decay:a_only')
        expect(module('decay:a_only').ports).toEqual(ports)
        expect(module('decay:a_only').source).toEqual({ kind: 'instance', nodeId: 'a' })
        expect(findNode('b').data.ports).toEqual(dialogPorts('b', before.nodes[1].data.ports))
        expect(module()).toEqual(baseModule())

        await history.undo()
        expect(snapshot()).toEqual(before)
        expect(library.availableModules.has('decay:a_only')).toBe(false)
        expect(history.canUndo).toBe(false)
      })

      it('updates the config it made on a later edit, leaving the library module alone, one undo step each', async () => {
        await portEdit([['a', { action: 'new', moduleRef: 'decay:a_only' }]], ports)
        const afterNew = snapshot()
        await portEdit([['a', { action: 'update' }]], [], findNode('b').data.ports)
        expect(module('decay:a_only')).toMatchObject({ ports: [], source: { kind: 'instance', nodeId: 'a' } })
        expect(module()).toEqual(baseModule())
        expect(findNode('b').data.moduleRef).toBe(BASE_REF)

        await history.undo()
        expect(snapshot()).toEqual(afterNew)
        expect(module('decay:a_only').ports).toEqual(ports)
      })

      it("keeps a store mark confirmed on another instance's edge the update reaches", async () => {
        nodes.value.push(createNode('c'), createNode('s'))
        nodes.value[2].data.moduleRef = BASE_REF
        findNode('s').data.ports = ports
        edges.value.push({ id: 's--c', source: 's', target: 'c', data: { couplings: [] } })
        const marked = [{ sourcePort: ports[0], targetPort: ports[0], drivesState: true }]
        await savePortEdit({
          type: 'edit-connection',
          ports: [['a', ports]],
          configs: new Map([['a', { action: 'update' }]]),
          drivenCouplings: new Map([['s--c', marked]]),
        })
        expect(findNode('c').data.ports).toEqual(ports)
        expect(edges.value[1].data.couplings).toEqual([expect.objectContaining({ drivesState: true })])
      })

      it('leaves the modules alone for a couplings-only edit, still one undo step', async () => {
        const before = snapshot()
        await portEdit([], findNode('a').data.ports)
        expect(edges.value[0].data.couplings).toEqual([coupling])
        expect(module()).toEqual(baseModule())

        await history.undo()
        expect(snapshot()).toEqual(before)
      })
    })
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

  describe('plotted variables', () => {
    const plotOf = (nodeId, variableName, nodeName = nodeId) => ({
      key: `${nodeId}::${variableName}`,
      nodeId,
      nodeName,
      variableName,
      units: 'metre',
      type: 'variable',
      plot: true,
      groupId: 'plot-1',
    })

    it('plots the chosen variables under the saved name, and undo puts the plot config back with the edit', async () => {
      const simulation = useSimulationSettingsStore()
      simulation.setPlotConfig({ groups: [{ id: 'plot-1', name: 'Plot 1' }], selections: [plotOf('b', 'x')] })
      const before = simulation.getState().plotConfig

      await saveInstanceEdit(buildSave({ plotVariables: [{ name: 'x' }] }))
      const after = simulation.getState().plotConfig
      expect(after.selections).toEqual([plotOf('b', 'x'), plotOf('a', 'x', 'a2')])

      await history.undo()
      expect(simulation.getState().plotConfig.selections).toEqual(before.selections)
      expect(findNode('a').data.name).toBe('a')

      await history.redo()
      expect(simulation.getState().plotConfig.selections).toEqual(after.selections)
    })

    it('records a save that only changes the plotted variables', async () => {
      await saveInstanceEdit(buildSave({ name: 'a', plotVariables: [{ name: 'x' }] }))
      expect(history.canUndo).toBe(true)

      await history.undo()
      expect(useSimulationSettingsStore().plotConfig.selections).toEqual([])
    })

    it('still undoes the edit after Simulation Settings rewrites the other nodes’ plots', async () => {
      const simulation = useSimulationSettingsStore()
      simulation.setPlotConfig({ groups: [{ id: 'plot-1', name: 'Plot 1' }], selections: [plotOf('b', 'x')] })
      await saveInstanceEdit(buildSave({ plotVariables: [{ name: 'x' }] }))

      // Simulation Settings saves every selection again, sorted by node name, with others changed.
      const { selections } = simulation.getState().plotConfig
      simulation.setPlotConfig({ groups: [{ id: 'plot-2', name: 'Other' }], selections: [...selections].reverse().map((s) => (s.nodeId === 'b' ? { ...s, groupId: 'plot-2' } : s)) })

      await history.undo()
      expect(findNode('a').data.name).toBe('a')
      expect(simulation.plotConfig.selections.map((selection) => selection.key)).toEqual(['b::x'])
    })

    it('leaves the edit in place when its own plotted variables have changed since', async () => {
      const simulation = useSimulationSettingsStore()
      await saveInstanceEdit(buildSave({ plotVariables: [{ name: 'x' }] }))
      simulation.setPlotConfig({ groups: [{ id: 'plot-1', name: 'Plot 1' }], selections: [] })

      await history.undo()
      expect(findNode('a').data.name).toBe('a2')
    })

    it('records nothing when the save changes nothing, plotted variables included', async () => {
      // The first save fills in the edge's couplings, which the fixture leaves empty.
      await saveInstanceEdit(buildSave({ name: 'a' }))
      history.clear()

      await saveInstanceEdit(buildSave({ name: 'a', plotVariables: [] }))
      expect(history.canUndo).toBe(false)
      expect(useSimulationSettingsStore().plotConfig).toEqual({})
    })
  })

  describe('module annotations', () => {
    const DECAY_SIDECAR = `@prefix bqbiol: <http://biomodels.net/biology-qualifiers/> .
@prefix semsim: <http://bime.uw.edu/semsim/> .
@prefix opb: <https://identifiers.org/opb/OPB_> .
@prefix chebi: <https://identifiers.org/chebi/CHEBI:> .
@prefix m: <./file#> .
@prefix local: <./decay.ttl#> .

m:vdecayx01 bqbiol:isVersionOf opb:00154 ;
    bqbiol:isPropertyOf local:entity_self .
m:vdecayk01 bqbiol:isVersionOf opb:00592 ; bqbiol:isPropertyOf local:process_vdecayk01 .
local:process_vdecayk01 semsim:hasSinkParticipant local:sink_vdecayk01 .
local:sink_vdecayk01 semsim:hasPhysicalEntityReference local:entity_vdecayk01 .
local:entity_vdecayk01 bqbiol:is chebi:29101 ; bqbiol:isPartOf local:entity_self .
`
    const X_SUBJECT = 'https://phlynx.invalid/modules/file#vdecayx01'
    const K_SUBJECT = 'https://phlynx.invalid/modules/file#vdecayk01'
    // The math's annotated variables carry the ids the sidecar names, as a save keeps them.
    const withIds = (xml) =>
      xml
        .replace('<variable name="x"', '<variable id="vdecayx01" name="x"')
        .replace('<variable name="k"', '<variable id="vdecayk01" name="k"')
    const renameK = (xml) => xml.replaceAll('"k"', '"kd"').replaceAll('<ci>k</ci>', '<ci>kd</ci>')
    const RENAMED_GROWTH_XML = renameK(withIds(GROWTH_XML))
    const forkWithIds = () => ({ ...fork(), math: withIds(GROWTH_XML) })

    beforeEach(() => {
      library.addMath(DECAY_REF, withIds(DECAY_XML))
      library.setModuleAnnotations(DECAY_REF, DECAY_SIDECAR)
    })

    it('copies the sidecar to forked math, which the old math keeps, and one undo removes the copy', async () => {
      await saveInstanceEdit(forkWithIds())
      const copied = library.getModuleAnnotations(GROWTH_REF)
      expect(copied).toContain('m:vdecayx01')
      expect(copied).toContain('@prefix local: <./growth.ttl#> .')
      expect(copied).toContain('bqbiol:isPropertyOf local:entity_self .')
      expect(copied).not.toContain('m:decay')
      expect(library.getModuleAnnotations(DECAY_REF)).toBe(DECAY_SIDECAR)

      await history.undo()
      expect(library.getModuleAnnotations(GROWTH_REF)).toBeNull()
      expect(findNode('a').data.mathRef).toBe(DECAY_REF)

      await history.redo()
      expect(library.getModuleAnnotations(GROWTH_REF)).toBe(copied)
    })

    it('keeps the id subjects of variables the new math renamed, which resolve to their new names', async () => {
      await saveInstanceEdit(buildSave({ mathRef: GROWTH_REF, math: RENAMED_GROWTH_XML }))
      const copied = library.getModuleAnnotations(GROWTH_REF)
      expect(copied).toContain('m:vdecayk01')
      expect(copied).toContain('m:vdecayx01')
      const parsed = await library.ensureModuleAnnotations(GROWTH_REF)
      expect(parsed.variables.map(({ variable, id }) => [variable, id])).toEqual([
        ['x', 'vdecayx01'],
        ['kd', 'vdecayk01'],
      ])
    })

    it('leaves the sidecar as it is when math overwritten under its own reference renames a variable', async () => {
      await saveInstanceEdit(buildSave({ math: renameK(withIds(DECAY_XML)) }))
      expect(library.getModuleAnnotations(DECAY_REF)).toBe(DECAY_SIDECAR)
      const parsed = await library.ensureModuleAnnotations(DECAY_REF)
      expect(parsed.variables.find((entry) => entry.id === 'vdecayk01').variable).toBe('kd')
    })

    it('writes the annotations a save carries, and one undo puts back the sidecar and the nodes', async () => {
      const text = DECAY_SIDECAR.replace('opb:00592', 'opb:00318')
      await saveInstanceEdit(buildSave({ annotations: { text } }))
      expect(library.getModuleAnnotations(DECAY_REF)).toBe(text)
      expect(findNode('a').data.name).toBe('a2')

      await history.undo()
      expect(library.getModuleAnnotations(DECAY_REF)).toBe(DECAY_SIDECAR)
      expect(findNode('a').data.name).toBe('a')
    })

    it('clears the sidecar when a save carries empty annotations', async () => {
      await saveInstanceEdit(buildSave({ annotations: { text: '' } }))
      expect(library.getModuleAnnotations(DECAY_REF)).toBeNull()

      await history.undo()
      expect(library.getModuleAnnotations(DECAY_REF)).toBe(DECAY_SIDECAR)
    })

    it('records a save that only changes the annotations', async () => {
      await saveInstanceEdit(buildSave({ name: 'a' }))
      history.clear()
      await saveInstanceEdit(buildSave({ name: 'a', annotations: { text: DECAY_SIDECAR.replace('opb:00592', 'opb:00318') } }))
      expect(history.canUndo).toBe(true)
    })

    it('replaces the sidecar of math a save overwrites, and undo puts it back', async () => {
      library.addMath(GROWTH_REF, GROWTH_XML)
      const growthSidecar = DECAY_SIDECAR.replaceAll('decay', 'growth').replace('opb:00592', 'opb:00318')
      library.setModuleAnnotations(GROWTH_REF, growthSidecar)
      await saveInstanceEdit(buildSave({ mathRef: GROWTH_REF, math: GROWTH_XML.replace('<ci>k</ci>', '<cn>2</cn>') }))
      expect(library.getModuleAnnotations(GROWTH_REF)).toContain('opb:00592')

      await history.undo()
      expect(library.getModuleAnnotations(GROWTH_REF)).toBe(growthSidecar)
      expect(library.getModuleAnnotations(DECAY_REF)).toBe(DECAY_SIDECAR)
    })

    it('still saves, leaving the sidecars as they are, when the old sidecar does not parse', async () => {
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
      library.setModuleAnnotations(DECAY_REF, 'not turtle ;;')
      await saveInstanceEdit(forkWithIds())
      expect(findNode('a').data.mathRef).toBe(GROWTH_REF)
      expect(library.getModuleAnnotations(GROWTH_REF)).toBeNull()
      expect(library.getModuleAnnotations(DECAY_REF)).toBe('not turtle ;;')
      expect(warn).toHaveBeenCalled()
      warn.mockRestore()
    })

    it('leaves the sidecar alone when the save keeps the math', async () => {
      await saveInstanceEdit(buildSave({ name: 'a' }))
      history.clear()
      await saveInstanceEdit(buildSave({ name: 'a' }))
      expect(history.canUndo).toBe(false)
      expect(library.getModuleAnnotations(DECAY_REF)).toBe(DECAY_SIDECAR)
    })
  })
})
