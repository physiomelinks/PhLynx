// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { checkMath, summariseImbalance, summariseInvalid, unitsNeededBy } from '../../../../src/services/math/checkMath.js'
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

describe('checkMath', () => {
  let libcellml

  beforeAll(async () => {
    await ensureLibCellmlReady()
    libcellml = getLibCellML()
  }, 120000)

  it('finds nothing in valid math whose units balance', () => {
    expect(checkMath(libcellml, decay('per_second'), DEFINITIONS)).toEqual({ invalid: [], imbalances: [] })
  })

  it("doesn't count what only its parameter rows and connections give it", () => {
    // decay has no initial value for x, nor a value for k: the Analyser's errors, not the Validator's.
    expect(checkMath(libcellml, decay('per_second'), DEFINITIONS).invalid).toEqual([])
  })

  it('finds an equation whose sides have different dimensions', () => {
    const { invalid, imbalances } = checkMath(libcellml, decay('second'), DEFINITIONS)
    expect(invalid).toEqual([])
    expect(imbalances.map(summariseImbalance)).toEqual([
      "dx/dt = k*x: 'dx/dt' is in 'metre x second^-1' while 'k*x' is in 'metre x second'.",
    ])
  })

  it('finds a term that should be dimensionless', () => {
    const xml = decay('per_second').replace('<ci>k</ci><ci>x</ci>', '<ci>k</ci><apply><exp/><ci>x</ci></apply>')
    expect(checkMath(libcellml, xml, DEFINITIONS).imbalances.map(summariseImbalance)).toEqual([
      "dx/dt = k*exp(x): 'x' in 'exp(x)' is not dimensionless; 'x' is in 'metre'.",
    ])
  })

  it('finds an equation whose sides differ only in scale', () => {
    expect(checkMath(libcellml, decay('per_ms'), DEFINITIONS).imbalances).toHaveLength(1)
  })

  it('finds math using units the library lacks invalid, and leaves its units unchecked', () => {
    const { invalid, imbalances } = checkMath(libcellml, decay('per_fortnight'), DEFINITIONS)
    expect(invalid.map(summariseInvalid)).toEqual([
      "Variable 'k' has a units reference 'per_fortnight' which is neither standard nor defined in the units library.",
    ])
    expect(imbalances).toEqual([])
  })

  it('finds math using a variable it does not declare invalid', () => {
    // Named twice, reported once.
    const xml = decay('per_second').replace('<ci>k</ci><ci>x</ci>', '<ci>k_typo</ci><ci>k_typo</ci>')
    expect(checkMath(libcellml, xml, DEFINITIONS).invalid.map(summariseInvalid)).toEqual([
      "MathML ci element has the child text 'k_typo' which does not correspond with any variable names.",
    ])
  })
})

describe('libraryStore.getMathCheck', () => {
  let store
  // Asks for the check until it lands, as a node's computed would when the result arrives.
  const checked = (expected) => vi.waitFor(() => expect(store.getMathCheck('file:decay')).toMatchObject(expected))

  beforeAll(async () => {
    await ensureLibCellmlReady()
  }, 120000)

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
  })

  it('finds nothing until the background check lands', () => {
    store.addMath('file:decay', decay('second'))
    expect(store.getMathCheck('file:decay')).toEqual({ invalid: [], imbalances: [] })
  })

  it('checks again when the math changes', async () => {
    store.addUnitsFile({ componentFile: 'units.cellml', model: UNITS })
    store.addMath('file:decay', decay('second'))
    await checked({ imbalances: [expect.any(String)] })

    store.addMath('file:decay', decay('per_second'))
    await checked({ invalid: [], imbalances: [] })
  })

  it('checks again when the units change', async () => {
    store.addMath('file:decay', decay('per_second'))
    await checked({ invalid: [expect.stringContaining("'per_second'")], imbalances: [] })

    store.addUnitsFile({ componentFile: 'units.cellml', model: UNITS.replace('exponent="-1"', 'exponent="1"') })
    await checked({ invalid: [], imbalances: [expect.any(String)] })
  })
})
