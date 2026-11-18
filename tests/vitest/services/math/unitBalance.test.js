// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { findUnitImbalances, summariseImbalance, unitsNeededBy } from '../../../../src/services/math/unitBalance.js'
import { useLibraryStore } from '../../../../src/stores/libraryStore.js'
import { getLibCellML } from '../../../../src/utils/cellml.js'
import { mergeUnitDefinitions } from '../../../../src/utils/units.js'
import { ensureLibCellmlReady } from '../../helpers/libcellml-bootstrap.js'

const UNITS = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="units">
  <units name="per_second"><unit units="second" exponent="-1"/></units>
  <units name="ms"><unit units="second" prefix="milli"/></units>
  <units name="per_ms"><unit units="ms" exponent="-1"/></units>
</model>`
const DEFINITIONS = mergeUnitDefinitions([UNITS])

/** dx/dt = k*x, as the library keeps math: no values and no units of its own. */
const decay = (kUnits) => `<model xmlns="http://www.cellml.org/cellml/2.0#" name="PhLynxComponent">
  <component name="decay">
    <variable name="t" units="second" interface="public_and_private"/>
    <variable name="x" units="metre" interface="public_and_private"/>
    <variable name="k" units="${kUnits}" interface="public_and_private"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply>
        <apply><times/><ci>k</ci><ci>x</ci></apply>
      </apply>
    </math>
  </component>
</model>`

describe('unitsNeededBy', () => {
  it('takes the library units the math uses and those they build on, but no built-in units', () => {
    expect([...unitsNeededBy(decay('per_ms'), DEFINITIONS).keys()].sort()).toEqual(['ms', 'per_ms'])
  })

  it('stands an affine units in as its base units', () => {
    expect(unitsNeededBy('<variable name="T" units="celsius"/>', DEFINITIONS).get('celsius')).toEqual([{ units: 'kelvin' }])
  })

  it("leaves out units the math defines itself", () => {
    const xml = '<model><units name="per_second"><unit units="second" exponent="-1"/></units><variable units="per_second"/></model>'
    expect(unitsNeededBy(xml, DEFINITIONS).size).toBe(0)
  })
})

describe('findUnitImbalances', () => {
  let libcellml

  beforeAll(async () => {
    await ensureLibCellmlReady()
    libcellml = getLibCellML()
  }, 120000)

  it('finds none in math whose units balance', () => {
    expect(findUnitImbalances(libcellml, decay('per_second'), DEFINITIONS)).toEqual([])
  })

  it('finds an equation whose sides have different dimensions', () => {
    const [imbalance, ...rest] = findUnitImbalances(libcellml, decay('second'), DEFINITIONS)
    expect(rest).toEqual([])
    expect(summariseImbalance(imbalance)).toBe(
      "dx/dt = k*x: 'dx/dt' is in 'metre x second^-1' while 'k*x' is in 'metre x second'."
    )
  })

  it('finds an equation whose sides differ only in scale', () => {
    expect(findUnitImbalances(libcellml, decay('per_ms'), DEFINITIONS)).toHaveLength(1)
  })

  it("can't check math using units the library lacks", () => {
    expect(findUnitImbalances(libcellml, decay('per_fortnight'), DEFINITIONS)).toEqual([])
  })
})

describe('libraryStore.getMathUnitImbalances', () => {
  let store
  const settle = () => new Promise((resolve) => setTimeout(resolve))

  beforeAll(async () => {
    await ensureLibCellmlReady()
  }, 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    store.addMath('file:decay', decay('per_second'))
  })

  it('checks in the background, then keeps the result', async () => {
    store.addUnitsFile({ componentFile: 'units.cellml', model: UNITS })
    expect(store.getMathUnitImbalances('file:decay')).toEqual([])
    await settle()
    expect(store.getMathUnitImbalances('file:decay')).toEqual([])

    store.addMath('file:decay', decay('second'))
    store.getMathUnitImbalances('file:decay')
    await settle()
    expect(store.getMathUnitImbalances('file:decay')).toHaveLength(1)
  })

  it('checks again when the units change', async () => {
    store.getMathUnitImbalances('file:decay')
    await settle()
    expect(store.getMathUnitImbalances('file:decay')).toEqual([]) // per_second is unknown, so unchecked

    store.addUnitsFile({ componentFile: 'units.cellml', model: UNITS.replace('exponent="-1"', 'exponent="1"') })
    await settle() // the watcher
    store.getMathUnitImbalances('file:decay')
    await settle()
    expect(store.getMathUnitImbalances('file:decay')).toHaveLength(1)
  })
})
