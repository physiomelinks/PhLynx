// @vitest-environment node
// The converter's wasm doesn't start under happy-dom, and happy-dom's DOMParser drops the CDATA a
// CellDL document keeps its Turtle in; so, as in convert.test.js, these run in Node with xmldom.
import fs from 'node:fs'
import path from 'node:path'

import { DOMParser, XMLSerializer } from '@xmldom/xmldom'
import { Window } from 'happy-dom'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../../../src/utils/notify', () => ({ notify: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() } }))

import { useCelldlImport } from '../../../src/composables/useCelldlImport.js'
import { analyzeMathXml } from '../../../src/services/math/analyzeMath.js'
import { reconcileRows } from '../../../src/services/math/reconcileRows.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { generateFlattenedModel } from '../../../src/utils/cellml.js'
import { notify } from '../../../src/utils/notify'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

globalThis.DOMParser ??= DOMParser
globalThis.XMLSerializer ??= XMLSerializer

const fixture = (name) => fs.readFileSync(path.resolve(__dirname, '../fixtures/celldl', name), 'utf8')

/** Runs `run` with happy-dom's DOMParser, XMLSerializer and Node, which flattening needs. */
async function withHappyDom(run) {
  const window = new Window()
  const saved = { DOMParser: globalThis.DOMParser, XMLSerializer: globalThis.XMLSerializer, Node: globalThis.Node }
  Object.assign(globalThis, { DOMParser: window.DOMParser, XMLSerializer: window.XMLSerializer, Node: window.Node })
  try {
    return await run()
  } finally {
    Object.assign(globalThis, saved)
    await window.happyDOM.close()
  }
}

/** The library's state, to check an import added nothing. */
const librarySnapshot = (store) => ({
  math: [...store.availableMath.keys()],
  modules: [...store.availableModules.keys()],
  units: store.availableUnits.map((file) => file.componentFile),
  sources: [...store.availableMath.keys()].filter((mathRef) => store.getMathSource(mathRef)),
})

describe('useCelldlImport', () => {
  let store
  let confirm
  let libcellml

  beforeAll(async () => {
    ;({ instance: libcellml } = await ensureLibCellmlReady())
  }, 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    confirm = vi.fn(async () => true)
    vi.clearAllMocks()
  })

  it('adds a diagram as a module, with its source and units', async () => {
    const { loadCelldlFiles } = useCelldlImport({ confirm })
    const document = fixture('rc.celldl')

    const [result] = await loadCelldlFiles([{ name: 'my rc.celldl', content: document }])

    expect(result).toEqual({ ok: true, name: 'my rc.celldl', mathRef: 'User_Modules.celldl:my_rc' })
    expect(store.availableMath.has('User_Modules.celldl:my_rc')).toBe(true)
    expect(store.getMathFormat('User_Modules.celldl:my_rc')).toBe('celldl')
    expect(store.getMathSource('User_Modules.celldl:my_rc')).toMatchObject({
      format: 'celldl',
      document,
      documentUri: expect.stringContaining('User_Modules.celldl_my_rc.celldl'),
      elements: expect.objectContaining({ I_R: expect.any(Object) }),
      generator: { name: '@physiomelinks/bg2cellml', version: expect.any(String) },
      frameworkVersion: expect.any(String),
    })
    expect(store.availableUnits.find((file) => file.componentFile === 'User_Modules.celldl')?.model).toContain('<units ')
    expect(store.availableModules.get('my_rc:default')?.mathRef).toBe('User_Modules.celldl:my_rc')
    expect(notify.success).toHaveBeenCalledOnce()
  }, 120000)

  it('gives typed rows: constants with values, every other variable computed', async () => {
    const { loadCelldlFiles } = useCelldlImport({ confirm })
    const [{ mathRef }] = await loadCelldlFiles([{ name: 'rc.celldl', content: fixture('rc.celldl') }])

    const rows = reconcileRows(analyzeMathXml(store.availableMath.get(mathRef)), [], {
      defaults: store.getMathDefaults(mathRef),
    })
    const byName = Object.fromEntries(rows.map((row) => [row.name, row]))
    expect(byName.R_R_0).toMatchObject({ type: 'constant', value: '10' })
    expect(byName.C_q_1).toMatchObject({ type: 'constant', value: '0.001' })
    // I_R is solved from the bond network, not given; a value-less parameter would block runs.
    expect(byName.I_R).toMatchObject({ type: 'variable' })
    for (const row of rows) {
      if (row.type === 'constant') expect(row.value, row.name).not.toBe('')
      else expect(row.type, row.name).toBe('variable')
    }
  }, 120000)

  it('gives a module two instances of which flatten and validate', async () => {
    const { loadCelldlFiles } = useCelldlImport({ confirm })
    const [{ mathRef }] = await loadCelldlFiles([{ name: 'rc.celldl', content: fixture('rc.celldl') }])
    const rows = reconcileRows(analyzeMathXml(store.availableMath.get(mathRef)), [], {
      defaults: store.getMathDefaults(mathRef),
    })
    const node = (id) => ({ id, type: 'instanceNode', data: { name: id, mathRef, variables: rows, ports: [] } })

    const flat = await withHappyDom(async () => (await generateFlattenedModel([node('rc_a'), node('rc_b')], [], store)).text())

    const validator = new libcellml.Validator()
    validator.validateModel(new libcellml.Parser(false).parseModel(flat))
    expect(validator.errorCount()).toBe(0)
    expect(flat).toContain('id="rc_a-')
    expect(flat).toContain('id="rc_b-')
  }, 120000)

  it('names a second import of a diagram apart from the first', async () => {
    const { loadCelldlFiles } = useCelldlImport({ confirm })
    const results = await loadCelldlFiles([
      { name: 'rc.celldl', content: fixture('rc.celldl') },
      { name: 'rc.celldl', content: fixture('rc.celldl') },
    ])

    expect(results.map((result) => result.mathRef)).toEqual(['User_Modules.celldl:rc', 'User_Modules.celldl:rc_1'])
    expect(store.getMathSource('User_Modules.celldl:rc_1').documentUri).not.toBe(
      store.getMathSource('User_Modules.celldl:rc').documentUri
    )
  }, 120000)

  it("keeps every diagram's units in User_Modules.celldl's one units entry, and flattens them together", async () => {
    const { loadCelldlFiles } = useCelldlImport({ confirm })
    const [rc, enzyme] = await loadCelldlFiles([
      { name: 'rc.celldl', content: fixture('rc.celldl') },
      { name: 'enzyme.celldl', content: fixture('enzyme_canonical.celldl') },
    ])
    expect(rc.ok && enzyme.ok).toBe(true)

    const units = store.availableUnits.filter((file) => file.componentFile.startsWith('User_Modules'))
    expect(units.map((file) => file.componentFile)).toEqual(['User_Modules.celldl'])
    const node = (id, mathRef) => {
      const variables = reconcileRows(analyzeMathXml(store.availableMath.get(mathRef)), [], {
        defaults: store.getMathDefaults(mathRef),
      })
      return { id, type: 'instanceNode', data: { name: id, mathRef, variables, ports: [] } }
    }
    const flat = await withHappyDom(async () =>
      (await generateFlattenedModel([node('rc_a', rc.mathRef), node('enzyme_a', enzyme.mathRef)], [], store)).text()
    )
    const validator = new libcellml.Validator()
    validator.validateModel(new libcellml.Parser(false).parseModel(flat))
    expect(validator.errorCount()).toBe(0)
  }, 120000)

  it("adds nothing for a diagram that doesn't convert, and lists its errors", async () => {
    const { loadCelldlFiles } = useCelldlImport({ confirm })
    const before = librarySnapshot(store)

    const [result] = await loadCelldlFiles([{ name: 'rc.celldl', content: fixture('rc_unbonded.celldl') }])

    expect(result).toEqual({ ok: false, name: 'rc.celldl', mathRef: undefined })
    expect(librarySnapshot(store)).toEqual(before)
    expect(confirm).not.toHaveBeenCalled()
    expect(notify.error).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'CellDL Import Error', message: expect.stringContaining('• V_C.L: ') })
    )
  }, 120000)

  it("adds nothing for a diagram that converts but doesn't draw its elements, which the editor can't open", async () => {
    const { loadCelldlFiles } = useCelldlImport({ confirm })
    const before = librarySnapshot(store)
    const undrawn = fixture('rc.celldl').replace(/<g id="([^"]+)"><rect[^>]*\/><\/g>/g, '<g id="$1"/>').replace('<g id="q_1"/>', '')

    const [result] = await loadCelldlFiles([{ name: 'rc.celldl', content: undrawn }])

    expect(result.ok).toBe(false)
    expect(librarySnapshot(store)).toEqual(before)
    expect(notify.error).toHaveBeenCalledWith({
      title: 'CellDL Import Error',
      message: "rc.celldl can&#39;t be imported:<br>• The diagram has no drawing of R_0, V_in, q_1, V_C and I_R, so the CellDL editor can&#39;t open it",
    })
  }, 120000)

  it('asks before adding a diagram with warnings, and adds nothing if declined', async () => {
    confirm.mockResolvedValueOnce(false)
    const { loadCelldlFiles } = useCelldlImport({ confirm })
    const before = librarySnapshot(store)

    const [declined] = await loadCelldlFiles([{ name: 'rc.celldl', content: fixture('rc_sine.celldl') }])
    expect(declined.ok).toBe(false)
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ header: 'CellDL Diagram Warnings', severity: 'warning' }))
    expect(librarySnapshot(store)).toEqual(before)
    expect(notify.error).not.toHaveBeenCalled()

    const [accepted] = await loadCelldlFiles([{ name: 'rc.celldl', content: fixture('rc_sine.celldl') }])
    expect(accepted).toMatchObject({ ok: true, mathRef: 'User_Modules.celldl:rc' })
  }, 120000)
})
