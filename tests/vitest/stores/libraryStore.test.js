// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CellMLTextParser } from 'cellml-text-editor'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { buildInstance } from '../../../src/services/import/buildWorkflow.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

const MATH_REF = 'file:decay'
const XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="decay">
  <component name="decay">
    <variable name="t" units="second"/>
    <variable name="x" units="metre" initial_value="1.5"/>
    <variable name="k" units="per_second" initial_value="0.5"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply>
        <apply><times/><apply><minus/><ci>k</ci></apply><ci>x</ci></apply>
      </apply>
    </math>
  </component>
</model>`

describe('libraryStore math', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
  })

  it('stores math without its values, keeping them as defaults', () => {
    store.addMath(MATH_REF, XML)
    const stored = store.availableMath.get(MATH_REF)
    expect(stored).not.toMatch(/initial_value="[\d.]+"/)
    expect(stored).toContain('initial_value="x_init"')
    expect(store.getMathDefaults(MATH_REF)).toEqual(new Map([['x_init', '1.5'], ['k', '0.5']]))
  })

  it('keeps the defaults when separated math is stored again', () => {
    store.addMath(MATH_REF, XML)
    store.addMath(MATH_REF, store.availableMath.get(MATH_REF))
    expect(store.getMathDefaults(MATH_REF).get('k')).toBe('0.5')
  })

  it('saves and restores the defaults with the workspace', () => {
    store.addMath(MATH_REF, XML)
    const state = JSON.parse(JSON.stringify(store.getState()))

    setActivePinia(createPinia())
    const restored = useLibraryStore()
    restored.loadState(state)
    expect(restored.getMathDefaults(MATH_REF)).toEqual(new Map([['x_init', '1.5'], ['k', '0.5']]))
    expect(restored.availableMath.get(MATH_REF)).toBe(store.availableMath.get(MATH_REF))
  })

  it('separates the math of an older saved workspace as it loads', () => {
    store.loadState({ availableMath: [[MATH_REF, XML]] })
    expect(store.availableMath.get(MATH_REF)).not.toMatch(/initial_value="[\d.]+"/)
    expect(store.getMathDefaults(MATH_REF).get('k')).toBe('0.5')
  })
})

describe('libraryStore math layouts', () => {
  let store
  const layout = new CellMLTextParser().parse('// Exponential decay\node(x, t) = -k * x;\n', { componentName: 'decay' }).layout

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
  })

  it('keeps a layout added with its math', () => {
    store.addMath(MATH_REF, XML, true, layout)
    expect(store.getMathLayout(MATH_REF)).toEqual(layout)
  })

  it('keeps the layout when the math is overwritten without one', () => {
    store.addMath(MATH_REF, XML, true, layout)
    store.addMath(MATH_REF, XML)
    expect(store.getMathLayout(MATH_REF)).toEqual(layout)
  })

  it('removes a layout set to null', () => {
    store.addMath(MATH_REF, XML, true, layout)
    store.setMathLayout(MATH_REF, null)
    expect(store.getMathLayout(MATH_REF)).toBeNull()
  })

  it('saves and restores layouts with the workspace, skipping invalid ones', () => {
    store.addMath(MATH_REF, XML, true, layout)
    const state = JSON.parse(JSON.stringify(store.getState()))
    state.mathLayouts.push(['file:other', { format: 'something-else', components: [] }])

    setActivePinia(createPinia())
    const restored = useLibraryStore()
    restored.loadState(state)
    expect(restored.getMathLayout(MATH_REF)).toEqual(layout)
    expect(restored.getMathLayout('file:other')).toBeNull()
  })
})

describe('instances of a module built from a CellML file', () => {
  beforeAll(async () => {
    await ensureLibCellmlReady() // extractVariablesFromMath parses with libcellml
  }, 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
  })

  it('take their values from the math, which the module itself no longer holds', () => {
    const store = useLibraryStore()
    store.addMathFile('file', [{ name: 'decay', math: XML }])
    const module = store.availableModules.get('decay:default')

    const instance = buildInstance('n1', 'decay_1', 'instanceNode', module, [], null, store.getMathAnalysis(MATH_REF), store.getMathDefaults(MATH_REF))
    const rows = Object.fromEntries(instance.data.variables.map((row) => [row.name, row.value]))
    expect(rows).toMatchObject({ k: '0.5', x_init: '1.5' })
  })
})

describe('libraryStore unit expansions', () => {
  const UNITS = (definition) =>
    `<model xmlns="http://www.cellml.org/cellml/2.0#" name="u"><units name="per_millis">${definition}</units></model>`

  beforeEach(() => setActivePinia(createPinia()))

  it('follows the units files, and is never saved', () => {
    const store = useLibraryStore()
    store.addUnitsFile({ componentFile: 'u.cellml', model: UNITS('<unit prefix="milli" units="second" exponent="-1"/>') })
    expect(store.unitExpansions.get('per_millis')).toBe('10³ s⁻¹')

    store.addUnitsFile({ componentFile: 'u.cellml', model: UNITS('<unit units="second" exponent="-1"/>') })
    expect(store.unitExpansions.get('per_millis')).toBe('s⁻¹')

    expect(Object.keys(store.getState())).not.toContain('unitExpansions')
  })
})
