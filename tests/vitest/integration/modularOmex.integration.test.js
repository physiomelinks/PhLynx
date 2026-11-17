// @vitest-environment happy-dom
// The OMEX export, modular as it is, run by libOpenCOR: its SED-ML names the main model, which imports each
// instance's component from a module file and its units from a units file, and libOpenCOR resolves both.
import { createNodeLibOpenCOR } from '../helpers/libopencor.js'
import JSZip from 'jszip'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { generateOmexArchive } from '../../../src/services/compress.js'
import { buildModularModel } from '../../../src/services/export/modularCellml.js'
import { analyzeMathXml } from '../../../src/services/math/analyzeMath.js'
import { reconcileRows } from '../../../src/services/math/reconcileRows.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

vi.mock('../../../src/stores/omexStore.js', () => ({ useOmexStore: () => ({ preservedExtras: [] }) }))

const MATH_REF = 'decay.cellml:decay'
// dx/dt = -k * x, with k in units only the units file defines, themselves in terms of another units it defines.
const DECAY = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="decay">
  <component name="decay">
    <variable name="t" units="second" interface="public"/>
    <variable name="x" units="dimensionless" initial_value="2" interface="public"/>
    <variable name="k" units="per_tick" initial_value="0.5"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply>
        <apply><minus/><apply><times/><ci>k</ci><ci>x</ci></apply></apply>
      </apply>
    </math>
  </component>
</model>`
const UNITS = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="ticks">
  <units name="tick"><unit units="second"/></units>
  <units name="per_tick"><unit units="tick" exponent="-1"/></units>
</model>`
const SETTINGS = { startingPoint: 0, endingPoint: 1, initialPoint: 0, pointInterval: 0.1 }

describe('the modular OMEX export, run by libOpenCOR', () => {
  let libOpenCOR

  beforeAll(async () => {
    await ensureLibCellmlReady()
    libOpenCOR = await createNodeLibOpenCOR()
  }, 120000)

  /** Gives a libOpenCOR object's issues' descriptions. */
  const issuesOf = (logger) => Array.from({ length: logger.issueCount }, (_, i) => logger.issue(i).description)

  it('resolves the module and units imports, and runs each instance', async () => {
    setActivePinia(createPinia())
    const store = useLibraryStore()
    store.addUnitsFile({ componentFile: 'ticks.cellml', model: UNITS })
    store.addMath(MATH_REF, DECAY)
    const rows = reconcileRows(analyzeMathXml(store.availableMath.get(MATH_REF)), [], { defaults: store.getMathDefaults(MATH_REF) })
    const nodes = ['decay_1', 'decay_2'].map((name) => ({
      id: name,
      type: 'instanceNode',
      data: { name, mathRef: MATH_REF, variables: rows.map((row) => ({ ...row })), ports: [] },
    }))

    const modular = await buildModularModel(nodes, [], store)
    const omex = await generateOmexArchive(
      { blob: new Blob([modular.main]), flat: modular.flat },
      '{}',
      { simulationSettings: SETTINGS },
      {
        cellmlFileName: 'model.cellml',
        extractedData: {},
        moduleFiles: modular.files,
        unitsFiles: store.availableUnits,
      }
    )
    const bytes = new Uint8Array(await omex.arrayBuffer())

    // The archive is modular all the way: no flattened copy, and nothing defines the units but the units file.
    const archive = await JSZip.loadAsync(bytes)
    expect(archive.file(/^flattened\//)).toEqual([])
    expect(await archive.file('document.sedml').async('string')).toContain('source="model.cellml"')
    for (const location of ['model.cellml', 'decay.cellml']) {
      const text = await archive.file(location).async('string')
      expect(text).toMatch(/xlink:href="units\/ticks\.cellml"/)
      expect(text).not.toMatch(/<units name=/)
    }

    const file = new libOpenCOR.File('/modular-omex/model.omex')
    file.setContents(bytes)
    const document = new libOpenCOR.SedDocument(file)
    const instance = document.instantiate()
    const issues = [...issuesOf(file), ...issuesOf(document), ...issuesOf(instance)]
    instance.run()
    issues.push(...issuesOf(instance))
    const task = instance.task(0)
    const states = new Map(Array.from({ length: task.stateCount }, (_, i) => [task.stateName(i), Array.from(task.state(i))]))
    task.delete()
    instance.delete()
    document.delete()
    libOpenCOR.FileManager.instance().unmanage(file)
    file.delete()

    expect(issues).toEqual([])
    for (const name of ['decay_1/x', 'decay_2/x']) {
      expect(states.get(name)).toHaveLength(11)
      expect(states.get(name).at(-1)).toBeCloseTo(2 * Math.exp(-0.5), 4)
    }
  })
})
