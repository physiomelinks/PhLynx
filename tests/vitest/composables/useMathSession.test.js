// @vitest-environment happy-dom
import fs from 'node:fs'
import path from 'node:path'
import { reactive, ref } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  CellMLTextGenerator,
  CellMLTextParser,
  applyVariableDefinitions,
  mergeSimpleLayout,
  renameIdentifier,
} from 'cellml-text-editor'

import { useMathSession } from '../../../src/composables/useMathSession.js'
import { createHistory, useFlowHistoryStore } from '../../../src/stores/historyStore.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { reconcileRows } from '../../../src/services/math/reconcileRows.js'
import { setLinkedUnits } from '../../../src/utils/variables.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

const MATH_REF = 'file:decay'
const XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="decay">
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

const GROWTH_REF = 'file:growth'
const GROWTH_XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="growth">
  <component name="growth">
    <variable name="t" units="second" interface="public_and_private"/>
    <variable name="n" units="metre" initial_value="2"/>
    <variable name="r" units="per_second" initial_value="0.1"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>n</ci></apply>
        <apply><times/><ci>r</ci><ci>n</ci></apply>
      </apply>
    </math>
  </component>
</model>`

const byName = (rows) => Object.fromEntries(rows.map((row) => [row.name, row]))

/** Stands in for CellMLTextEditor: parses text the way it does and reports `change` events. */
function fakeEditor(session) {
  const editor = {
    format: 'cellml-text',
    text: '',
    lastXml: XML,
    lastLayout: null,
    componentName: 'decay',
    report(source, text, simple) {
      const parser = new CellMLTextParser({ simplified: simple })
      const result = parser.parse(text, {
        baseXml: editor.lastXml,
        componentName: editor.componentName,
        finalise: simple
          ? (doc) => applyVariableDefinitions(doc, session.editorDefinitions.value, { keep: session.keptVariables.value })
          : undefined,
      })
      const valid = result.errors.length === 0 && !!result.xml
      editor.text = text
      if (valid) {
        editor.lastXml = result.xml
        editor.lastLayout = simple ? mergeSimpleLayout(editor.lastLayout, result.layout) : result.layout
      }
      session.handleEditorChange({
        source,
        format: editor.format,
        text,
        valid,
        xml: valid ? result.xml : null,
        layout: valid ? editor.lastLayout : null,
      })
      return session.flushPendingChanges()
    },
    setText: vi.fn(async (text) => {
      editor.text = text
    }),
    setModel: vi.fn(async () => {}),
    renameVariable: vi.fn((from, to) => editor.report('edit', renameIdentifier(editor.text, from, to), true)),
    flush: () => {},
  }
  return editor
}

describe('useMathSession', () => {
  let session, editorRef, history, ports, plotVariables

  beforeAll(async () => {
    await ensureLibCellmlReady() // isDirty compares models with libcellml
  })

  beforeEach(async () => {
    setActivePinia(createPinia())
    useLibraryStore().addMath(MATH_REF, XML)
    history = useFlowHistoryStore()
    editorRef = ref(null)
    ports = ref([{ label: 'p', variables: ['x', 'k'] }])
    plotVariables = ref([{ name: 'x', groupId: 'plot-2' }])
    session = useMathSession({ history, editorRef, ports, plotVariables })
    editorRef.value = fakeEditor(session)
    await session.load({ mathRef: MATH_REF, rows: [], managed: true })
  })

  it('builds rows from the cached analysis on open, with units applied', async () => {
    // A new instance's rows are seeded from the math's defaults; the session itself never reads them.
    const store = useLibraryStore()
    const seeded = reconcileRows(store.getMathAnalysis(MATH_REF), [], { defaults: store.getMathDefaults(MATH_REF) })
    await session.load({ mathRef: MATH_REF, rows: seeded, managed: true })

    const rows = byName(session.parameterRows.value)
    expect(rows.x).toMatchObject({ stateRole: 'state', initialiser: 'x0', units: 'metre' })
    expect(rows.x0.value).toBe('1')
    expect(rows.k).toMatchObject({ value: '0.5', units: 'per_second', type: 'constant' })
    expect(session.parameterRows.value.filter(session.isMissingUnits)).toEqual([])
  })

  it('reports no missing units after the simple-mode editor round-trips the definitions', async () => {
    const simpleText = new CellMLTextGenerator({ simplified: true }).generate(XML)
    await editorRef.value.report('init', simpleText, true)
    expect(session.parameterRows.value.filter(session.isMissingUnits)).toEqual([])
    expect(session.isDirty()).toBe(false)
  })

  it('flags a row whose units are cleared', () => {
    byName(session.parameterRows.value).k.units = ''
    expect(session.parameterRows.value.filter(session.isMissingUnits).map((r) => r.name)).toEqual(['k'])
  })

  it('keeps a state and its initialiser on the same units when an edit lands mid-typing', async () => {
    await editorRef.value.report('init', 'ode(x, t) = -x;\n', true)
    setLinkedUnits(session.parameterRows.value, byName(session.parameterRows.value).x, 'm')
    await editorRef.value.report('edit', 'ode(x, t) = -k * x;\n', true)

    setLinkedUnits(session.parameterRows.value, byName(session.parameterRows.value).x, 'metre')
    expect(byName(session.parameterRows.value).x0.units).toBe('metre')
  })

  it('gives a drifted initialiser its state units when the math is edited', async () => {
    await editorRef.value.report('init', 'ode(x, t) = -x;\n', true)
    byName(session.parameterRows.value).x0.units = 'm'
    await editorRef.value.report('edit', 'ode(x, t) = -k * x;\n', true)
    expect(byName(session.parameterRows.value)).toMatchObject({ x: { units: 'metre' }, x0: { units: 'metre' } })
  })

  it('turns a valid edit into rows and port changes that undo together', async () => {
    const generator = new CellMLTextGenerator({ simplified: true })
    const simpleText = generator.generate(XML)
    await editorRef.value.report('init', simpleText, true)

    const edited = simpleText.replace(/\bk\b/g, 'rate')
    expect(edited).not.toBe(simpleText)
    await editorRef.value.report('edit', edited, true)

    const names = session.parameterRows.value.map((r) => r.name)
    expect(names).toContain('rate')
    expect(names).not.toContain('k')

    await history.undo()
    expect(session.parameterRows.value.map((r) => r.name)).toContain('k')
  })

  describe('when a variable drops out of the math for a moment', () => {
    const SIMPLE_TEXT = 'ode(x, t) = -k * x;\n'

    beforeEach(async () => {
      const rows = [{ name: 'k', value: '3', units: 'per_second', type: 'constant', data_reference: 'Smith2020' }]
      await session.load({ mathRef: MATH_REF, rows, managed: true })
      await editorRef.value.report('init', SIMPLE_TEXT, true)
    })

    it('gives its row back, value and source, when the name returns', async () => {
      await editorRef.value.report('edit', 'ode(x, t) = -x;\n', true)
      expect(byName(session.parameterRows.value).k).toBeUndefined()

      await editorRef.value.report('edit', SIMPLE_TEXT, true)
      expect(byName(session.parameterRows.value).k).toMatchObject({ value: '3', data_reference: 'Smith2020' })
    })

    it('forgets removed rows when another instance is loaded', async () => {
      await editorRef.value.report('edit', 'ode(x, t) = -x;\n', true)
      await session.load({ mathRef: MATH_REF, rows: [], managed: true })
      await editorRef.value.report('init', 'ode(x, t) = -x;\n', true)
      await editorRef.value.report('edit', SIMPLE_TEXT, true)
      expect(byName(session.parameterRows.value).k.data_reference).toBeNull()
    })
  })

  describe('when a load is overtaken by another before its analysis arrives (#609)', () => {
    const SAVED_K = [{ name: 'k', value: '3', units: 'per_second', type: 'constant', data_reference: null }]
    let store, resolveFirst

    beforeEach(async () => {
      store = useLibraryStore()
      store.addMath(GROWTH_REF, GROWTH_XML)
      const decayAnalysis = await store.ensureMathAnalysis(MATH_REF)
      // The first load waits on the worker until the test lets it finish.
      vi.spyOn(store, 'ensureMathAnalysis').mockImplementationOnce(
        () => new Promise((resolve) => (resolveFirst = () => resolve(decayAnalysis)))
      )
    })

    it('keeps the later instance’s rows and analysis', async () => {
      const first = session.load({ mathRef: MATH_REF, rows: SAVED_K, managed: true })
      await session.load({ mathRef: GROWTH_REF, rows: [], managed: true })
      resolveFirst()
      await first

      const names = session.parameterRows.value.map((row) => row.name)
      expect(names).toEqual(expect.arrayContaining(['n', 'r']))
      expect(names).not.toContain('k')
      expect(names).not.toContain('x')
      expect(session.mathReferences.value.has('r')).toBe(true)
      expect(session.mathReferences.value.has('k')).toBe(false)
    })

    it('keeps the later instance’s empty session when it has no math', async () => {
      const first = session.load({ mathRef: MATH_REF, rows: SAVED_K, managed: true })
      await session.load({ mathRef: null, rows: [], managed: true })
      resolveFirst()
      await first

      expect(session.parameterRows.value).toEqual([])
      expect(session.mathReferences.value.size).toBe(0)
    })

    it('keeps the later instance’s values when both share the math', async () => {
      const first = session.load({ mathRef: MATH_REF, rows: SAVED_K, managed: true })
      await session.load({ mathRef: MATH_REF, rows: [{ ...SAVED_K[0], value: '7' }], managed: true })
      resolveFirst()
      await first

      expect(byName(session.parameterRows.value).k.value).toBe('7')
    })
  })

  it('starts a row the session adds blank, even when the math has a default for it', async () => {
    expect(useLibraryStore().getMathDefaults(MATH_REF).get('k')).toBe('0.5')
    await editorRef.value.report('init', 'ode(x, t) = -x;\n', true)
    await editorRef.value.report('edit', 'ode(x, t) = -k * x;\n', true)
    expect(byName(session.parameterRows.value).k.value).toBe('')
  })

  it('reports an edit that leaves the math invalid as unsaved', async () => {
    await editorRef.value.report('init', 'ode(x, t) = -k * x;\n', true)
    expect(session.hasUnsavedInvalidEdit()).toBe(false)
    await editorRef.value.report('edit', 'ode(x, t) = -k *', true)
    expect(session.hasUnsavedInvalidEdit()).toBe(true)
    await editorRef.value.report('edit', 'ode(x, t) = -k * x;\n', true)
    expect(session.hasUnsavedInvalidEdit()).toBe(false)
  })

  it('follows undo and redo across an edit that leaves the math invalid', async () => {
    await editorRef.value.report('init', 'ode(x, t) = -k * x;\n', true)
    await editorRef.value.report('edit', 'ode(x, t) = -k *', true)

    await history.undo()
    expect(session.hasUnsavedInvalidEdit()).toBe(false)
    await history.redo()
    expect(session.hasUnsavedInvalidEdit()).toBe(true)
  })

  describe('when a variable is renamed in the text', () => {
    const SIMPLE_TEXT = 'ode(x, t) = -k * x;\n'

    beforeEach(async () => {
      await editorRef.value.report('init', SIMPLE_TEXT, true)
    })

    it('keeps its units and initialiser, and renames it in ports', async () => {
      await editorRef.value.report('edit', 'ode(y, t) = -k * y;\n', true)

      const rows = byName(session.parameterRows.value)
      expect(rows.y).toMatchObject({ units: 'metre', stateRole: 'state', initialiser: 'x0' })
      expect(rows.x).toBeUndefined()
      expect(rows.y_init).toBeUndefined()
      expect(ports.value[0].variables).toEqual(['y', 'k'])
      expect(session.pendingRename.value).toBeNull()

      await history.undo()
      expect(byName(session.parameterRows.value).x).toMatchObject({ units: 'metre', initialiser: 'x0' })
      expect(ports.value[0].variables).toEqual(['x', 'k'])
    })

    it('follows a name typed a letter at a time', async () => {
      await editorRef.value.report('edit', 'ode(y, t) = -k * y;\n', true)
      await editorRef.value.report('edit', 'ode(ym, t) = -k * ym;\n', true)
      expect(byName(session.parameterRows.value).ym).toMatchObject({ units: 'metre', initialiser: 'x0' })
      expect(ports.value[0].variables).toEqual(['ym', 'k'])
    })

    it('offers to rename the remaining uses, and renames them as one undo step', async () => {
      await editorRef.value.report('edit', 'ode(x, t) = -k * y;\n', true)
      expect(session.pendingRename.value).toEqual({ from: 'x', to: 'y', uses: 1 })
      expect(byName(session.parameterRows.value).y.units).toBe('metre')

      await session.renameEverywhere()
      expect(editorRef.value.renameVariable).toHaveBeenCalledWith('x', 'y')
      expect(editorRef.value.text).toBe('ode(y, t) = -k * y;\n')
      expect(session.pendingRename.value).toBeNull()
      const rows = byName(session.parameterRows.value)
      expect(rows.x).toBeUndefined()
      expect(rows.y).toMatchObject({ units: 'metre', stateRole: 'state', initialiser: 'x0' })
      expect(rows.y_init).toBeUndefined()
      expect(ports.value[0].variables).toEqual(['y', 'k'])

      await history.undo()
      expect(session.parameterRows.value.map((row) => row.name)).toEqual(expect.arrayContaining(['x', 'y']))
      expect(ports.value[0].variables).toEqual(['x', 'k'])
    })

    it('keeps the multiport type and factor of a renamed port variable', async () => {
      Object.assign(ports.value[0], { multiportType: ['multiply', 'True'], multiplyFactor: 2 })
      await editorRef.value.report('edit', 'ode(y, t) = -k * y;\n', true)
      expect(ports.value[0]).toMatchObject({ variables: ['y', 'k'], multiportType: ['multiply', 'True'], multiplyFactor: 2 })

      await history.undo()
      expect(ports.value[0]).toMatchObject({ variables: ['x', 'k'], multiportType: ['multiply', 'True'] })
    })

    it('drops the multiport type of a removed port variable, until undone', async () => {
      ports.value[0].multiportType = ['sum', 'True']
      await editorRef.value.report('edit', 'ode(x, t) = -x;\n', true)
      expect(ports.value[0]).toMatchObject({ variables: ['x'], multiportType: 'Sum' })

      await history.undo()
      expect(ports.value[0]).toMatchObject({ variables: ['x', 'k'], multiportType: ['sum', 'True'] })
    })

    it('keeps a multiport change made after a rename when the rename is undone', async () => {
      ports.value[0].multiportType = 'True'
      await editorRef.value.report('edit', 'ode(y, t) = -k * y;\n', true)
      ports.value[0].multiportType = ['sum', 'True']

      await history.undo()
      expect(ports.value[0]).toMatchObject({ variables: ['x', 'k'], multiportType: ['sum', 'True'] })
    })

    it('renames it in the plotted variables, keeping its group, until undone', async () => {
      await editorRef.value.report('edit', 'ode(y, t) = -k * y;\n', true)
      expect(plotVariables.value).toEqual([{ name: 'y', groupId: 'plot-2' }])

      await history.undo()
      expect(plotVariables.value).toEqual([{ name: 'x', groupId: 'plot-2' }])
    })

    it('keeps a variable plotted after a rename when the rename is undone', async () => {
      await editorRef.value.report('edit', 'ode(y, t) = -k * y;\n', true)
      plotVariables.value = [...plotVariables.value, { name: 'k' }]

      await history.undo()
      expect(plotVariables.value).toEqual([{ name: 'x', groupId: 'plot-2' }, { name: 'k' }])
    })

    it('keeps a tick on the new name when a partial rename is finished, and undo restores both', async () => {
      await editorRef.value.report('edit', 'ode(x, t) = -k * y;\n', true)
      plotVariables.value = [...plotVariables.value, { name: 'y', groupId: 'g2' }]

      await session.renameEverywhere()
      expect(plotVariables.value).toEqual([{ name: 'y', groupId: 'plot-2' }])

      await history.undo()
      expect(plotVariables.value).toEqual([{ name: 'x', groupId: 'plot-2' }, { name: 'y', groupId: 'g2' }])
    })

    it('keeps both names when the offer is dismissed', async () => {
      await editorRef.value.report('edit', 'ode(x, t) = -k * y;\n', true)
      session.dismissRename()
      expect(session.pendingRename.value).toBeNull()

      await session.renameEverywhere()
      expect(editorRef.value.renameVariable).not.toHaveBeenCalled()
      expect(ports.value[0].variables).toEqual(['x', 'k'])
    })
  })

  it('rebuilds rows for Advanced Mode, where the text owns initial values', async () => {
    session.isManaged.value = false
    const advancedText = new CellMLTextGenerator({ simplified: false }).generate(XML)
    await editorRef.value.report('external', advancedText, false)

    const rows = byName(session.parameterRows.value)
    expect(rows.k.textInit).toBe('0.5')
    expect(rows.x.stateRole).toBe('state')
  })

  it('moves values typed into Advanced Mode text into the rows', async () => {
    session.isManaged.value = false
    const typed = new CellMLTextGenerator({ simplified: false }).generate(XML).replace('0.5', '0.25')
    await editorRef.value.report('edit', typed, false)
    expect(byName(session.parameterRows.value).k.textInit).toBe('0.25')

    session.separateTypedValues()
    const rows = byName(session.parameterRows.value)
    expect(rows.k.value).toBe('0.25')
    expect(rows.k.textInit).toBeUndefined()
    expect(rows.x0.value).toBe('1')
    expect(session.currentModel.value).not.toMatch(/initial_value="[\d.]+"/)
    expect(session.currentModel.value).toContain('initial_value="x0"')
  })

  it('keeps the math unchanged when only a value is edited in Simple Mode', async () => {
    const simpleText = new CellMLTextGenerator({ simplified: true }).generate(XML)
    await editorRef.value.report('init', simpleText, true)
    byName(session.parameterRows.value).k.value = '2'
    // The editor reparses whenever the definitions change.
    await editorRef.value.report('external', simpleText, true)
    expect(session.isDirty()).toBe(false)
  })

  it('opens stored math without values, taking them from the math defaults', () => {
    const stored = useLibraryStore().availableMath.get(MATH_REF)
    expect(stored).not.toMatch(/initial_value="[\d.]+"/)
    expect(stored).toContain('initial_value="x0"')
  })

  it('keeps the row set (and so row order and focus) when an initialiser is renamed in the table', async () => {
    const simpleText = new CellMLTextGenerator({ simplified: true }).generate(XML)
    await editorRef.value.report('init', simpleText, true)
    const rows = session.parameterRows.value
    const initialiser = rows.find((row) => row.name === 'x0')

    // What ParameterTable.commitRename does.
    initialiser.name = 'x_start'
    rows.find((row) => row.name === 'x').initialiser = 'x_start'
    await editorRef.value.report('external', simpleText, true)

    expect(session.parameterRows.value).toBe(rows)
    expect(session.parameterRows.value.map((row) => row.name)).not.toContain('x0')
    expect(editorRef.value.lastXml).toContain('initial_value="x_start"')
  })

  describe('when an editor mounted after a switch reports init', () => {
    // Reported directly, so each "editor" writes the same math in exactly the way the test needs.
    const report = (source, xml) => {
      session.handleEditorChange({ source, format: 'mathml', text: xml, valid: true, xml })
      return session.flushPendingChanges()
    }
    const reformatted = XML.replace('initial_value="0.5"', 'initial_value="0.50"')

    it('takes the new editor’s version as the baseline if nothing changed', async () => {
      await report('init', XML)
      await report('init', reformatted)
      expect(session.isDirty()).toBe(false)
      expect(session.currentModel.value).toBe(reformatted)
    })

    it('keeps edits made before the switch', async () => {
      await report('init', XML)
      await report('edit', XML.replace('initial_value="0.5"', 'initial_value="0.7"'))
      await report('init', reformatted.replace('initial_value="0.50"', 'initial_value="0.70"'))
      expect(session.isDirty()).toBe(true)
    })
  })

  it('gets square roots from the text editor as <root/>', async () => {
    const withRoot = XML.replace('<apply><minus/><ci>k</ci></apply>', '<apply><root/><ci>k</ci></apply>')
    const simpleText = new CellMLTextGenerator({ simplified: true }).generate(withRoot)
    expect(simpleText).toContain('sqrt(k)')
    await editorRef.value.report('init', simpleText, true)
    expect(session.currentModel.value).toContain('<root/>')
    expect(session.currentModel.value).not.toContain('sqrt')
  })

  it('restores through setModel when the mounted editor writes another format', async () => {
    const simpleText = new CellMLTextGenerator({ simplified: true }).generate(XML)
    await editorRef.value.report('init', simpleText, true)
    const initialXml = session.currentModel.value
    await editorRef.value.report('edit', simpleText.replace(/\bk\b/g, 'rate'), true)

    const mathEditor = { ...fakeEditor(session), format: 'mathml' }
    editorRef.value = mathEditor
    await history.undo()

    expect(mathEditor.setModel).toHaveBeenCalledWith(initialXml)
    expect(mathEditor.setText).not.toHaveBeenCalled()
    expect(session.currentModel.value).toBe(initialXml)
  })

  it('replays an edit that does not parse in the editor that wrote it', async () => {
    const simpleText = new CellMLTextGenerator({ simplified: true }).generate(XML)
    await editorRef.value.report('init', simpleText, true)
    await editorRef.value.report('edit', simpleText + '\nbroken = ;', true)

    await history.undo()
    expect(editorRef.value.setText).toHaveBeenLastCalledWith(simpleText)
    expect(editorRef.value.setModel).not.toHaveBeenCalled()
  })

  describe('with the editor’s own history (#605)', () => {
    const SIMPLE_TEXT = 'ode(x, t) = -k * x;\n'
    let local

    beforeEach(async () => {
      local = reactive(createHistory())
      session = useMathSession({ history: local, editorRef, ports })
      editorRef.value = fakeEditor(session)
      const rows = [{ name: 'k', value: '3', units: 'per_second', type: 'constant' }]
      await session.load({ mathRef: MATH_REF, rows, managed: true })
      await editorRef.value.report('init', SIMPLE_TEXT, true)
    })

    /** What the dialog does when another instance is opened. */
    async function openAnother(text) {
      local.clear()
      await session.load({ mathRef: MATH_REF, rows: [], managed: true })
      await editorRef.value.report('init', text, true)
      editorRef.value.setText.mockClear()
      editorRef.value.setModel.mockClear()
    }

    it('records edits in its own history, not the workspace’s', async () => {
      await editorRef.value.report('edit', 'ode(x, t) = -x;\n', true)
      expect(local.canUndo).toBe(true)
      expect(history.canUndo).toBe(false)
    })

    it('does not replay an earlier instance’s edits into the next one', async () => {
      await editorRef.value.report('edit', 'ode(x, t) = -x;\n', true)
      await openAnother('ode(x, t) = -x;\n')
      const rows = session.parameterRows.value
      const model = session.currentModel.value

      await local.undo()

      expect(session.parameterRows.value).toBe(rows)
      expect(session.currentModel.value).toBe(model)
      expect(byName(rows).k).toBeUndefined()
      expect(editorRef.value.setText).not.toHaveBeenCalled()
      expect(editorRef.value.setModel).not.toHaveBeenCalled()
      expect(local.canUndo).toBe(false)
    })

    it('leaves saved ports alone once cleared', async () => {
      await editorRef.value.report('edit', 'ode(y, t) = -k * y;\n', true)
      const saved = ports.value[0]
      expect(saved.variables).toEqual(['y', 'k'])

      local.clear()
      await local.undo()
      expect(saved.variables).toEqual(['y', 'k'])
    })

    it('still undoes edits made after another instance is opened', async () => {
      await editorRef.value.report('edit', 'ode(x, t) = -x;\n', true)
      await openAnother(SIMPLE_TEXT)
      await editorRef.value.report('edit', 'ode(x, t) = -x;\n', true)
      expect(byName(session.parameterRows.value).k).toBeUndefined()

      await local.undo()
      expect(byName(session.parameterRows.value).k).toBeDefined()
      expect(editorRef.value.setText).toHaveBeenLastCalledWith(SIMPLE_TEXT)
      expect(local.canUndo).toBe(false)
    })
  })

  describe('text layout', () => {
    const generateSimple = () => new CellMLTextGenerator({ simplified: true }).generate(XML)

    it('opens with the layout saved with the math', async () => {
      const layout = new CellMLTextParser().parse('// decay\node(x, t) = -k * x;\n', { componentName: 'decay' }).layout
      useLibraryStore().setMathLayout(MATH_REF, layout)
      await session.load({ mathRef: MATH_REF, rows: [], managed: true })
      expect(session.currentLayout.value).toEqual(layout)
      expect(session.isLayoutDirty()).toBe(false)
    })

    it('records an edit to comments alone as a layout change that undoes', async () => {
      const simpleText = generateSimple()
      await editorRef.value.report('init', simpleText, true)
      expect(session.isLayoutDirty()).toBe(false)

      await editorRef.value.report('edit', `// Exponential decay\n${simpleText}`, true)
      expect(session.isDirty()).toBe(false)
      expect(session.isLayoutDirty()).toBe(true)
      expect(JSON.stringify(session.currentLayout.value)).toContain('// Exponential decay')

      await history.undo()
      expect(editorRef.value.setText).toHaveBeenLastCalledWith(simpleText)
      expect(session.isLayoutDirty()).toBe(false)
    })

    it('keeps a comment on a variable whose typed value moves into the rows', async () => {
      session.isManaged.value = false
      const advancedText = new CellMLTextGenerator({ simplified: false }).generate(XML)
      const commented = advancedText.replace(/(var k: [^\n]*;)/, '$1 // decay rate')
      expect(commented).not.toBe(advancedText)
      await editorRef.value.report('edit', commented, false)

      session.separateTypedValues()
      const result = new CellMLTextGenerator({ simplified: false }).generateResult(session.currentModel.value, {
        layout: session.currentLayout.value,
      })
      expect(result.layoutRejected).toBeUndefined()
      expect(result.text).toMatch(/var k: [^\n]*; \/\/ decay rate/)
      expect(result.text).not.toContain('init: 0.5')
    })
  })

  describe('with a declared variable no equation uses', () => {
    const UNUSED_REF = 'file:unused'
    const UNUSED_XML = XML.replace(
      '<variable name="k"',
      '<variable name="cAMP" units="dimensionless" interface="public"/>\n    <variable name="k"'
    )
    const CAMP = { name: 'cAMP', units: 'dimensionless', value: '0.01', type: 'constant', data_reference: 'user_defined' }
    const simpleText = new CellMLTextGenerator({ simplified: true }).generate(UNUSED_XML)
    const declares = (name) => session.currentModel.value.includes(`name="${name}"`)
    let onInit

    beforeEach(async () => {
      onInit = vi.fn()
      session = useMathSession({ history, editorRef, ports, plotVariables, onInit })
      editorRef.value = fakeEditor(session)
      editorRef.value.lastXml = UNUSED_XML
      useLibraryStore().addMath(UNUSED_REF, UNUSED_XML)
      await session.load({ mathRef: UNUSED_REF, rows: [{ ...CAMP }], managed: true })
    })

    it('keeps it declared, with its row and value, through init and edits in Simple Mode', async () => {
      expect(session.keptVariables.value).toEqual(['cAMP'])
      const rowsBefore = JSON.stringify(session.parameterRows.value)

      await editorRef.value.report('init', simpleText, true)
      expect(declares('cAMP')).toBe(true)
      expect(JSON.stringify(session.parameterRows.value)).toBe(rowsBefore)

      await editorRef.value.report('edit', simpleText.replace('-k', '-2 * k'), true)
      expect(declares('cAMP')).toBe(true)
      expect(byName(session.parameterRows.value).cAMP).toMatchObject(CAMP)
    })

    it('keeps it once an equation has used it and stops again', async () => {
      await editorRef.value.report('init', simpleText, true)
      await editorRef.value.report('edit', 'ode(x, t) = -k * cAMP * x;\n', true)
      await editorRef.value.report('edit', simpleText, true)
      expect(byName(session.parameterRows.value).cAMP).toMatchObject(CAMP)
    })

    it('follows Advanced Mode, where the text owns declarations', async () => {
      await editorRef.value.report('init', simpleText, true)
      session.isManaged.value = false
      const advancedText = new CellMLTextGenerator({ simplified: false }).generate(session.currentModel.value)
      const withoutCamp = advancedText.replace(/ *var cAMP[^\n]*\n/, '')
      expect(withoutCamp).not.toBe(advancedText)
      await editorRef.value.report('edit', withoutCamp.replace(/( *var k)/, '    var extra: metre;\n$1'), false)
      expect(session.keptVariables.value).toEqual(['extra'])

      session.isManaged.value = true
      await editorRef.value.report('external', simpleText, true)
      const names = session.parameterRows.value.map((row) => row.name)
      expect(names).toContain('extra')
      expect(names).not.toContain('cAMP')
    })

    it('tells onInit once, after the first init since the load', async () => {
      await editorRef.value.report('init', simpleText, true)
      expect(onInit).toHaveBeenCalledTimes(1)
      await editorRef.value.report('init', simpleText, true) // another editor mounted
      expect(onInit).toHaveBeenCalledTimes(1)

      await session.load({ mathRef: UNUSED_REF, rows: [{ ...CAMP }], managed: true })
      await editorRef.value.report('init', 'not cellml', true)
      expect(onInit).toHaveBeenCalledTimes(2)
    })
  })

  // The SN simple workspace's var_SN instance: its math and rows, as saved.
  describe('SN_varicosity from the SN simple workspace', () => {
    const FIXTURE = path.resolve(process.cwd(), 'tests/resources/math-session/sn_varicosity.json')
    const UNUSED = ['N_avo', 'cAMP', 'Ca_ER_RyR_tau_mid', 'Ca_ER_RyR_tau_den']
    const node = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'))
    const MATH = node.math
    const generator = new CellMLTextGenerator({ simplified: true })
    const pick = (rows) =>
      rows.map(({ name, value, type, units, initialiser, data_reference }) => ({ name, value, type, units, initialiser, data_reference }))

    /** Opens the instance from saved rows and math, as the dialog does, and reports the editor's init. */
    async function openAndInit(rows, math) {
      useLibraryStore().addMath(node.mathRef, math)
      editorRef.value.lastXml = math
      editorRef.value.componentName = 'SN_varicosity'
      await session.load({ mathRef: node.mathRef, rows: structuredClone(rows), managed: true })
      const loaded = pick(session.parameterRows.value)
      await editorRef.value.report('init', generator.generate(math), true)
      return loaded
    }

    /** What Save writes: the rows and the math. */
    const save = () => ({ rows: structuredClone(pick(session.parameterRows.value)), math: session.currentModel.value })

    it('keeps the unused parameters and their values through edit, save, reopen and save', async () => {
      const expected = node.variables.filter((row) => UNUSED.includes(row.name)).map(({ name, value }) => ({ name, value }))
      const unusedRows = (rows) => rows.filter((row) => UNUSED.includes(row.name)).map(({ name, value }) => ({ name, value }))

      const loaded = await openAndInit(node.variables, MATH)
      expect(session.keptVariables.value).toEqual(expect.arrayContaining(UNUSED))
      // Nothing changes on open, so no save note shows.
      expect(pick(session.parameterRows.value)).toEqual(loaded)
      expect(session.isDirty()).toBe(false)

      const text = editorRef.value.text
      const edited = text.replace(/\bk_NET\b/, '(2 * k_NET)')
      expect(edited).not.toBe(text)
      await editorRef.value.report('edit', edited, true)
      expect(session.isDirty()).toBe(true)

      const first = save()
      expect(unusedRows(first.rows)).toEqual(expected)
      for (const name of UNUSED) expect(first.math).toContain(`name="${name}"`)

      const reloaded = await openAndInit(first.rows, first.math)
      expect(pick(session.parameterRows.value)).toEqual(reloaded)
      expect(session.isDirty()).toBe(false)
      expect(unusedRows(save().rows)).toEqual(expected)
    })
  })

  describe('locked math', () => {
    // The decay math as a diagram might generate it, with an extra parameter and new values.
    const GENERATED_XML = XML.replace('initial_value="0.5"', 'initial_value="0.7"').replace(
      '<variable name="k"',
      '<variable name="c" units="metre" initial_value="3"/>\n    <variable name="k"'
    )

    beforeEach(async () => {
      useLibraryStore().setMathSource(MATH_REF, { format: 'celldl', document: '', documentUri: 'local:decay.celldl' })
      await session.load({ mathRef: MATH_REF, rows: [{ name: 'k', value: '2', units: 'per_second', type: 'constant' }], managed: false })
    })

    it('is locked only for math generated from a source', async () => {
      expect(session.isMathLocked.value).toBe(true)
      useLibraryStore().setMathSource(MATH_REF, null)
      expect(session.isMathLocked.value).toBe(false)
    })

    it('ignores what the editors report', async () => {
      const text = new CellMLTextGenerator({ simplified: false }).generate(XML)
      await editorRef.value.report('init', text, false)
      await editorRef.value.report('edit', text.replace(/\bk\b/g, 'kk'), false)
      await editorRef.value.report('external', text.replace(/\bk\b/g, 'kk'), false)

      expect(session.currentModel.value).toBe(useLibraryStore().availableMath.get(MATH_REF))
      expect(session.isDirty()).toBe(false)
      expect(byName(session.parameterRows.value).k).toBeDefined()
      expect(history.canUndo).toBe(false)
    })

    it('follows a lock its caller gives over the stored format, and reports edits once it lifts', async () => {
      const isLocked = ref(true)
      useLibraryStore().setMathSource(MATH_REF, null)
      session = useMathSession({ history, editorRef, ports, isLocked: () => isLocked.value })
      editorRef.value = fakeEditor(session)
      await session.load({ mathRef: MATH_REF, rows: [], managed: false })
      const text = new CellMLTextGenerator({ simplified: false }).generate(XML)
      await editorRef.value.report('init', text, false)

      await editorRef.value.report('edit', text.replace(/\bk\b/g, 'kk'), false)
      expect(session.isMathLocked.value).toBe(true)
      expect(session.isDirty()).toBe(false)

      isLocked.value = false
      await editorRef.value.report('edit', text.replace(/\bk\b/g, 'kk'), false)
      expect(session.isDirty()).toBe(true)
    })

    it("keeps every generated constant's value, even one no equation uses, on a first save", async () => {
      await session.load({ mathRef: MATH_REF, rows: [], managed: false })
      session.applyGeneratedModel(
        GENERATED_XML.replace('<variable name="k"', '<variable name="F" units="C_per_mol" initial_value="96485"/>\n    <variable name="k"')
      )

      const rows = byName(session.parameterRows.value)
      expect(rows.F).toMatchObject({ value: '96485', type: 'constant' })
      expect(rows.c.value).toBe('3')
      expect(rows.k.value).toBe('0.7')
      expect(rows.x0.value).toBe('1')
    })

    it("keeps the instance's values, and fills blank rows from the module's previous defaults, new ones from the source", async () => {
      await session.load({
        mathRef: MATH_REF,
        rows: [
          { name: 'k', value: '2', units: 'per_second', type: 'constant' },
          { name: 'x0', value: '', units: 'metre', type: 'constant' },
        ],
        managed: false,
      })
      session.applyGeneratedModel(GENERATED_XML, {
        previousDefaults: new Map([
          ['k', '0.5'],
          ['x0', '0.9'],
        ]),
      })

      const rows = byName(session.parameterRows.value)
      expect(rows.x0.value).toBe('0.9')
      expect(rows.k.value).toBe('2')
      expect(rows.c.value).toBe('3')
    })

    it('keeps the instance values and fills the rest from a generated model', () => {
      session.applyGeneratedModel(GENERATED_XML)

      const rows = byName(session.parameterRows.value)
      expect(rows.k.value).toBe('2')
      expect(rows.c.value).toBe('3')
      expect(rows.x0.value).toBe('1')
      expect(session.currentModel.value).not.toContain('initial_value="3"')
      expect(session.isDirty()).toBe(true)
    })
  })
})
