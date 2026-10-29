import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { convertCelldl } = vi.hoisted(() => ({ convertCelldl: vi.fn() }))
vi.mock('../../../../src/services/celldl/convert.js', async (importActual) => ({ ...(await importActual()), convertCelldl }))

import { celldlImportNames, importCelldl } from '../../../../src/services/celldl/importCelldl.js'
import { useLibraryStore } from '../../../../src/stores/libraryStore.js'
import { ensureLibCellmlReady } from '../../helpers/libcellml-bootstrap.js'

const MATH = '<component name="rc"><variable name="x" units="dimensionless"/></component>'

describe('importCelldl', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
  })

  it("names a diagram apart, ignoring case, from User_Modules.celldl's components and the templates", () => {
    store.addMath('User_Modules.celldl:RC', MATH.replace('"rc"', '"RC"'))
    // Another grouping's component, or units file, of the name doesn't matter.
    store.addMath('User_Modules.cellml:pump', MATH.replace('"rc"', '"pump"'))
    store.addUnitsFile({ componentFile: 'pump.cellml', model: '<model/>' })

    expect(celldlImportNames('rc.celldl', store)).toEqual({ componentName: 'rc_1', mathRef: 'User_Modules.celldl:rc_1' })
    expect(celldlImportNames('pump.celldl', store)).toEqual({ componentName: 'pump', mathRef: 'User_Modules.celldl:pump' })
    expect(celldlImportNames('New_Module.celldl', store).componentName).toBe('New_Module_1')
    expect(celldlImportNames('2 pools.CELLDL', store).componentName).toBe('_2_pools')
  })

  it('adds nothing when the CellML has no component of the name asked for', async () => {
    convertCelldl.mockResolvedValueOnce({
      ok: true,
      components: [{ name: 'other', math: MATH }],
      errors: [],
      warnings: [],
    })

    const result = await importCelldl('rc.celldl', '<svg/>', store)

    expect(result).toMatchObject({ ok: false, errors: [expect.objectContaining({ message: expect.stringContaining('rc') })] })
    expect(store.getMathSource('User_Modules.celldl:rc')).toBeNull()
    expect(store.availableMath.size).toBe(0)
  })

  it("stores the diagram's section layout with its math", async () => {
    await ensureLibCellmlReady()
    const layout = { format: 'cellml-text-layout', version: 1, components: [{ name: 'rc' }] }
    convertCelldl.mockResolvedValueOnce({
      ok: true,
      components: [{ name: 'rc', math: `<model xmlns="http://www.cellml.org/cellml/2.0#" name="m">${MATH}</model>` }],
      layout,
      unitsModel: null,
      elements: {},
      errors: [],
      warnings: [],
    })

    const result = await importCelldl('rc.celldl', '<svg/>', store)

    expect(result.ok).toBe(true)
    expect(store.getMathLayout('User_Modules.celldl:rc')).toEqual(layout)
  }, 120000)
})
