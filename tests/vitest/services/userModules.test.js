import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import { knownUnitsForModule } from '../../../src/services/celldl/knownUnits.js'
import {
  diagramSaveRef,
  findInGrouping,
  groupingCellmlFile,
  groupingUnitsAfterSave,
  keptGroupingUnits,
  newComponentGrouping,
} from '../../../src/services/userModules.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { extractUnitDefinitions } from '../../../src/utils/units.js'

const GROUP = 'User_Modules.celldl'

/** A one-component model whose variables have the given units. */
const math = (name, ...units) =>
  `<model xmlns="http://www.cellml.org/cellml/2.0#" name="m"><component name="${name}">${units
    .map((u, i) => `<variable name="v${i}" units="${u}"/>`)
    .join('')}</component></model>`

/** A units model defining each name as a power of metre, `per_mm` on `mm` to test a chain. */
const unitsModel = (...names) =>
  `<model xmlns="http://www.cellml.org/cellml/2.0#" name="units">${names
    .map((name, i) =>
      name === 'per_mm'
        ? '<units name="per_mm"><unit units="mm" exponent="-1"/></units>'
        : `<units name="${name}"><unit units="metre" exponent="${i + 2}"/></units>`
    )
    .join('')}</model>`

describe('groupingCellmlFile', () => {
  it('keeps a CellML grouping, and names a CellDL one as CellML apart from it', () => {
    expect(groupingCellmlFile('User_Modules.cellml')).toBe('User_Modules.cellml')
    expect(groupingCellmlFile('User_Modules.celldl')).toBe('User_CellDL_Modules.cellml')
    expect(groupingCellmlFile('rc.celldl')).toBe('rc_CellDL.cellml')
  })
})

describe('newComponentGrouping and diagramSaveRef', () => {
  const TEMPLATE = 'template_modules.cellml:new_module'

  it("puts the template's new components in the user modules groupings, and others' in their own", () => {
    expect(newComponentGrouping(TEMPLATE, { isDiagram: true })).toBe('User_Modules.celldl')
    expect(newComponentGrouping(TEMPLATE)).toBe('User_Modules.cellml')
    expect(newComponentGrouping('file:decay', { isDiagram: true })).toBe('file')
    expect(newComponentGrouping(null)).toBeUndefined()
  })

  it('names the math a diagram saves to, under its own name unless renamed', () => {
    expect(diagramSaveRef(TEMPLATE)).toBe('User_Modules.celldl:new_module')
    expect(diagramSaveRef('file:decay')).toBe('file:decay')
    expect(diagramSaveRef('file:decay', 'fast')).toBe('file:fast')
    expect(diagramSaveRef(null)).toBeNull()
  })

  it("previews the template against User_Modules.celldl's units, keeping those its modules use", () => {
    setActivePinia(createPinia())
    const store = useLibraryStore()
    store.addUnitsFile({ componentFile: 'template_modules.cellml', model: unitsModel('tpl') })
    store.addUnitsFile({ componentFile: GROUP, model: unitsModel('mm', 'unused') })
    store.addMath(`${GROUP}:rc`, math('rc', 'mm'))
    const known = knownUnitsForModule(store, diagramSaveRef(TEMPLATE)).join('')

    expect(known).toContain('tpl')
    expect(known).toContain('mm')
    expect(known).not.toContain('unused')
  })
})

describe('findInGrouping', () => {
  it('finds a component in one grouping, ignoring case', () => {
    const refs = ['User_Modules.cellml:pump', 'User_Modules.celldl:Pump']
    expect(findInGrouping(refs, GROUP, 'pump')).toBe('User_Modules.celldl:Pump')
    expect(findInGrouping(refs, 'User_Modules.cellml', 'PUMP')).toBe('User_Modules.cellml:pump')
    expect(findInGrouping(refs, 'BG_modules.cellml', 'pump')).toBeNull()
  })
})

describe('grouping units', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    store.addMath(`${GROUP}:a`, math('a', 'shared', 'per_mm'))
    store.addMath(`${GROUP}:b`, math('b', 'shared', 'b_only'))
    store.addUnitsFile({ componentFile: GROUP, model: unitsModel('shared', 'b_only', 'mm', 'per_mm') })
    store.addUnitsFile({ componentFile: 'BG_modules.cellml', model: unitsModel('bg') })
  })

  it("keeps the units the grouping's other modules use, with those they're made of", () => {
    expect([...keptGroupingUnits(store, `${GROUP}:b`).keys()].sort()).toEqual(['mm', 'per_mm', 'shared'])
    expect([...keptGroupingUnits(store, `${GROUP}:a`).keys()].sort()).toEqual(['b_only', 'shared'])
    expect([...keptGroupingUnits(store, `${GROUP}:new`).keys()].sort()).toEqual(['b_only', 'mm', 'per_mm', 'shared'])
  })

  it("merges a module's new units with the others', dropping only units no other module uses", () => {
    const { componentFile, model } = groupingUnitsAfterSave(store, `${GROUP}:b`, unitsModel('shared', 'b_new'))
    expect(componentFile).toBe(GROUP)
    expect([...extractUnitDefinitions(model).keys()].sort()).toEqual(['b_new', 'mm', 'per_mm', 'shared'])
  })

  it("keeps the other modules' units when a module saves none", () => {
    const { model } = groupingUnitsAfterSave(store, `${GROUP}:b`, null)
    expect([...extractUnitDefinitions(model).keys()].sort()).toEqual(['mm', 'per_mm', 'shared'])
  })

  it("gives a module alone in its grouping, such as an older workspace's own-file diagram, its units as they are", () => {
    const own = unitsModel('rc_units')
    expect(groupingUnitsAfterSave(store, 'rc.cellml:rc', own)).toEqual({ componentFile: 'rc.cellml', model: own })
    expect(groupingUnitsAfterSave(store, 'rc.cellml:rc', null)).toEqual({ componentFile: 'rc.cellml', model: null })
  })

  it("names a conversion's units around every other grouping's and the kept ones, not the module's own", () => {
    const known = knownUnitsForModule(store, `${GROUP}:b`)
    expect(known).toHaveLength(2)
    expect(known[0]).toContain('name="bg"')
    expect([...extractUnitDefinitions(known[1]).keys()].sort()).toEqual(['mm', 'per_mm', 'shared'])
    expect(knownUnitsForModule(store, 'rc.cellml:rc')).toHaveLength(2)
    expect(knownUnitsForModule(store, null)).toHaveLength(2)
  })

  it("leaves an older workspace's own-file diagram, and its units, as they load", () => {
    const own = unitsModel('rc_units')
    store.loadState({
      availableMath: [['rc.cellml:rc', math('rc', 'rc_units')]],
      mathSources: [['rc.cellml:rc', { format: 'celldl', document: '<svg/>', documentUri: 'https://example.org/rc.celldl' }]],
      availableUnits: [{ componentFile: 'rc.cellml', model: own }],
    })

    expect(store.getMathFormat('rc.cellml:rc')).toBe('celldl')
    expect(knownUnitsForModule(store, 'rc.cellml:rc')).toEqual([])
    expect(knownUnitsForModule(store, `${GROUP}:new`)).toEqual([own])
    expect(groupingUnitsAfterSave(store, 'rc.cellml:rc', own)).toEqual({ componentFile: 'rc.cellml', model: own })
  })
})
