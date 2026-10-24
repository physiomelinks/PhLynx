// @vitest-environment happy-dom
import { reactive, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { useInstanceSave } from '../../../src/composables/useInstanceSave.js'
import { useNodeDataHistory } from '../../../src/composables/useNodeDataHistory.js'
import { useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
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
    const ports = [{ label: 'p', portType: 'general_ports', variables: ['x'] }]
    edges.value = [
      { id: 'e', source: 'a', target: 'b', data: { couplings: [] } },
      { id: 'f', source: 'b', target: 'a', data: { couplings: [] } },
    ]
    const preview = new Map(detachReactivity([...previewCouplings('a', ports, nodes.value, edges.value)]))

    await saveInstanceEdit(buildSave({ ports }))
    expect(detachReactivity(edges.value.map((edge) => edge.data.couplings))).toEqual([preview.get('e'), preview.get('f')])
    expect(preview.get('e')).toHaveLength(1)
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

    it('leaves the module alone when the math already has one', async () => {
      library.addModule({ moduleRef: 'decay:default', mathRef: DECAY_REF, ports: [], variables: [] })
      await saveInstanceEdit(buildSave({ math: DECAY_WITHOUT_K }))
      expect(findNode('a').data.moduleRef).toBe(NEW_MODULE_REF)
      expect([...library.availableCollections.get(DECAY_REF)]).toEqual(['decay:default'])
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
})
