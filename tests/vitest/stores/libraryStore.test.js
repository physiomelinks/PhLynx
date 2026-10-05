// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { CellMLTextParser } from 'cellml-text-editor'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { buildInstance } from '../../../src/services/import/buildWorkflow.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'
import { GHOST_MATH_REF } from '../../../src/utils/constants.js'

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

describe('libraryStore removing and restoring math', () => {
  let store, layout
  const moduleRef = 'decay:default'

  beforeAll(async () => {
    await ensureLibCellmlReady()
    layout = new CellMLTextParser({ simplified: true }).parse('// Exponential decay\node(x, t) = -k * x;\n', {
      componentName: 'decay',
      baseXml: XML,
    }).layout
  })

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
  })

  it('removes math with its hash, defaults, layout and analysis', () => {
    store.addMath(MATH_REF, XML, true, layout)
    expect(store.getMathLayout(MATH_REF)).not.toBeNull()
    const hash = store.getMathHashByRef(MATH_REF)
    expect(store.getMathRefsByHash(hash)).toEqual([MATH_REF])
    expect(store.getMathAnalysis(MATH_REF)).not.toBeNull()

    store.removeMath(MATH_REF)
    expect(store.availableMath.has(MATH_REF)).toBe(false)
    expect(store.getMathHashByRef(MATH_REF)).toBeFalsy()
    expect(store.getMathRefsByHash(hash)).toEqual([])
    expect(store.getMathDefaults(MATH_REF).size).toBe(0)
    expect(store.getMathLayout(MATH_REF)).toBeNull()
    expect(store.getMathAnalysis(MATH_REF)).toBeNull()
  })

  it('marks the math’s modules as stubs, until the math is added again', () => {
    store.addMathFile('file', [{ name: 'decay', math: XML }])
    store.removeMath(MATH_REF)
    expect(store.availableModules.get(moduleRef).isStub).toBe(true)

    store.addMath(MATH_REF, XML)
    expect(store.availableModules.get(moduleRef).isStub).toBeUndefined()
  })

  it('skips a collection entry whose module is missing', () => {
    store.addMathFile('file', [{ name: 'decay', math: XML }])
    store.availableModules.delete(moduleRef)
    expect(() => store.removeMath(MATH_REF)).not.toThrow()
  })

  it('never removes the ghost math', () => {
    store.addMath(GHOST_MATH_REF, XML)
    store.removeMath(GHOST_MATH_REF)
    expect(store.availableMath.has(GHOST_MATH_REF)).toBe(true)
  })

  it('restores overwritten math exactly, replacing defaults and layout', () => {
    store.addMath(MATH_REF, XML)
    const entry = store.getMathEntry(MATH_REF)
    const stored = store.availableMath.get(MATH_REF)

    const other = XML.replace('initial_value="0.5"', 'initial_value="2"').replace('<variable name="t"', '<variable name="y" units="metre" initial_value="3"/>\n    <variable name="t"')
    store.addMath(MATH_REF, other, true, layout)
    expect(store.getMathDefaults(MATH_REF).get('y')).toBe('3')
    expect(store.getMathLayout(MATH_REF)).not.toBeNull()

    store.restoreMathEntry(MATH_REF, entry)
    expect(store.availableMath.get(MATH_REF)).toBe(stored)
    expect(store.findMathRefByMath(stored)).toBe(MATH_REF)
    expect(store.getMathDefaults(MATH_REF)).toEqual(new Map([['x_init', '1.5'], ['k', '0.5']]))
    expect(store.getMathLayout(MATH_REF)).toBeNull()
  })

  it('keeps an entry separate from later changes to the store, before and after restoring it', () => {
    const changeStore = () => {
      store.getMathDefaults(MATH_REF).set('k', '9')
      store.getMathLayout(MATH_REF).changed = true
    }
    store.addMath(MATH_REF, XML, true, structuredClone(layout))
    const entry = store.getMathEntry(MATH_REF)

    changeStore()
    expect(entry.defaults.get('k')).toBe('0.5')
    expect(entry.layout).toEqual(layout)

    store.restoreMathEntry(MATH_REF, entry)
    expect(store.getMathLayout(MATH_REF)).toEqual(layout)
    changeStore()
    expect(entry.defaults.get('k')).toBe('0.5')
    expect(entry.layout).toEqual(layout)
  })

  it('removes math restored from a null entry', () => {
    expect(store.getMathEntry(MATH_REF)).toBeNull()
    store.addMath(MATH_REF, XML)
    store.restoreMathEntry(MATH_REF, null)
    expect(store.availableMath.has(MATH_REF)).toBe(false)
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
    expect(store.builtInUnitExpansions.get('per_millis')).toBe('10³ s⁻¹')

    store.addUnitsFile({ componentFile: 'u.cellml', model: UNITS('<unit units="second" exponent="-1"/>') })
    expect(store.unitExpansions.get('per_millis')).toBe('s⁻¹')
    expect(store.builtInUnitExpansions.get('per_millis')).toBe('s⁻¹')

    expect(Object.keys(store.getState())).not.toContain('unitExpansions')
    expect(Object.keys(store.getState())).not.toContain('builtInUnitExpansions')
  })
})

describe('libraryStore generated units', () => {
  beforeEach(() => setActivePinia(createPinia()))

  const MV_PER_MS = [
    { units: 'volt', prefix: -3, exponent: 1, multiplier: 1 },
    { units: 'second', prefix: -3, exponent: -1, multiplier: 1 },
  ]

  it('adds each units to one generated file, which saves like any units file', () => {
    const store = useLibraryStore()
    store.addGeneratedUnits({ name: 'mV_per_ms', parts: MV_PER_MS })
    store.addGeneratedUnits({ name: 'per_min', parts: [{ units: 'second', prefix: 0, exponent: -1, multiplier: 1 / 60 }] })

    expect(store.availableUnits.map((file) => file.componentFile)).toEqual(['generated_units.cellml'])
    expect(store.availableUnitNames.has('mV_per_ms')).toBe(true)
    expect(store.unitDefinitions.get('mV_per_ms')).toEqual(MV_PER_MS)
    expect(store.unitExpansions.get('mV_per_ms')).toBe('kg·m²·s⁻⁴·A⁻¹')
    expect(store.getState().availableUnits[0].model).toContain('<units name="per_min">')
  })

  it('comes back with a loaded workspace', () => {
    const store = useLibraryStore()
    store.addGeneratedUnits({ name: 'mV_per_ms', parts: MV_PER_MS })
    const saved = JSON.parse(JSON.stringify(store.getState()))

    setActivePinia(createPinia())
    const loaded = useLibraryStore()
    loaded.loadState(saved)
    expect(loaded.unitDefinitions.get('mV_per_ms')).toEqual(MV_PER_MS)
  })
})
