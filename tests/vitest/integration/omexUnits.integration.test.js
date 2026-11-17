// @vitest-environment happy-dom
import JSZip from 'jszip'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { analyzeMathXml } from '../../../src/services/math/analyzeMath.js'
import { reconcileRows } from '../../../src/services/math/reconcileRows.js'
import { generateOmexArchive } from '../../../src/services/compress.js'
import { importOmexFile, registerArchiveUnits } from '../../../src/services/import/omex.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { generateFlattenedModel } from '../../../src/utils/cellml.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

const MATH_REF = 'file:decay'
// dx/dt = -k * x, with k in units only the user's units file defines.
const XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="decay">
  <component name="decay">
    <variable name="t" units="second" interface="public"/>
    <variable name="x" units="dimensionless" initial_value="2" interface="public"/>
    <variable name="k" units="per_fortnight" initial_value="0.5"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply>
        <apply><minus/><apply><times/><ci>k</ci><ci>x</ci></apply></apply>
      </apply>
    </math>
  </component>
</model>`
const USER_UNITS = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="user_units">
  <units name="per_fortnight"><unit units="second" exponent="-1" multiplier="8.267e-7"/></units>
</model>`

/** A library with the user's units file and the decay math, and a node built from it. */
function setUpLibrary({ withUnits }) {
  setActivePinia(createPinia())
  const store = useLibraryStore()
  if (withUnits) store.addUnitsFile({ componentFile: 'user_units.cellml', model: USER_UNITS })
  store.addMath(MATH_REF, XML)
  const rows = reconcileRows(analyzeMathXml(store.availableMath.get(MATH_REF)), [], { defaults: store.getMathDefaults(MATH_REF) })
  const node = { id: 'n1', type: 'instanceNode', data: { name: 'decay_1', mathRef: MATH_REF, variables: rows, ports: [] } }
  return { store, node }
}

describe('OMEX units files round trip', () => {
  let archivePayload

  beforeAll(async () => {
    await ensureLibCellmlReady()
  }, 120000)

  beforeEach(async () => {
    const { store, node } = setUpLibrary({ withUnits: true })
    const blob = await generateFlattenedModel([node], [], store)
    const settings = { startingPoint: 0, endingPoint: 1, initialPoint: 0, pointInterval: 0.1 }
    const omex = await generateOmexArchive({ blob }, '{}', { simulationSettings: settings }, {
      cellmlFileName: 'model.cellml',
      unitsFiles: store.availableUnits,
      extractedData: { voi: null, mappedParameters: {} },
    })
    archivePayload = await omex.arrayBuffer()
  })

  it('reimports the model CellML and registers the archive units in the library', async () => {
    const result = await importOmexFile(archivePayload)
    expect(result.files.cellml).toBe('model.cellml')
    expect(result.otherCellmls).toEqual(['units/user_units.cellml'])

    const { store } = setUpLibrary({ withUnits: false })
    const added = await registerArchiveUnits(await JSZip.loadAsync(archivePayload), result.otherCellmls, store)

    expect(added).toEqual(['user_units.cellml'])
    expect(store.hasUnits('per_fortnight')).toBe(true)
    // Named once, not again on each round trip.
    const registered = store.availableUnits.find((file) => file.componentFile === 'user_units.cellml').model
    expect(registered).toMatch(/name="OnlyUnitsFrom_user_units"/)
  })

  it('keeps the units model name across a second round trip', async () => {
    const { store } = setUpLibrary({ withUnits: false })
    const first = await importOmexFile(archivePayload)
    await registerArchiveUnits(await JSZip.loadAsync(archivePayload), first.otherCellmls, store)

    const blob = new Blob(['<model xmlns="http://www.cellml.org/cellml/2.0#" name="m"/>'])
    const omex = await generateOmexArchive({ blob }, '{}', {}, {
      cellmlFileName: 'model.cellml',
      unitsFiles: store.availableUnits,
      extractedData: { voi: null, mappedParameters: {} },
    })
    const payload = await omex.arrayBuffer()
    const second = await importOmexFile(payload)
    await registerArchiveUnits(await JSZip.loadAsync(payload), second.otherCellmls, store)

    const registered = store.availableUnits.find((file) => file.componentFile === 'user_units.cellml').model
    expect(registered).toMatch(/name="OnlyUnitsFrom_user_units"/)
  })

  it('flattens after an import whose units are only in the archive', async () => {
    const result = await importOmexFile(archivePayload)
    const { store, node } = setUpLibrary({ withUnits: false })
    expect(() => generateFlattenedModel([node], [], store)).toThrow(/no units file defines: per_fortnight/)

    await registerArchiveUnits(await JSZip.loadAsync(archivePayload), result.otherCellmls, store)
    const text = await (await generateFlattenedModel([node], [], store)).text()
    expect(text).toMatch(/<units name="per_fortnight">/)
  })
})
