// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, describe, expect, it } from 'vitest'

import { analyzeMathXml } from '../../../src/services/math/analyzeMath.js'
import { reconcileRows } from '../../../src/services/math/reconcileRows.js'
import { useLibraryStore } from '../../../src/stores/libraryStore.js'
import { generateFlattenedModel } from '../../../src/utils/cellml.js'
import { ensureLibCellmlReady } from '../helpers/libcellml-bootstrap.js'

const MATH_REF = 'file:decay'
// Ids as bg2cellml writes them: the component's is "main", each variable's "main-<name>".
const XML = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="decay" id="model">
  <component name="main" id="main">
    <variable name="t" units="second" interface="public" id="main-t"/>
    <variable name="x" units="dimensionless" initial_value="1" interface="public" id="main-x"/>
    <variable name="k" units="per_second" initial_value="0.5" id="main-k"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply id="main-eq"><eq/>
        <apply><diff/><bvar><ci>t</ci></bvar><ci>x</ci></apply>
        <apply><minus/><apply><times/><ci>k</ci><ci>x</ci></apply></apply>
      </apply>
    </math>
  </component>
</model>`
const UNITS = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="units">
  <units name="per_second"><unit units="second" exponent="-1"/></units>
</model>`

describe('generateFlattenedModel with two instances of math that has ids', () => {
  beforeAll(async () => {
    await ensureLibCellmlReady()
  }, 120000)

  it('validates without duplicate ids', async () => {
    setActivePinia(createPinia())
    const store = useLibraryStore()
    store.addUnitsFile({ componentFile: 'units.cellml', model: UNITS })
    store.addMath(MATH_REF, XML)

    const rows = reconcileRows(analyzeMathXml(store.availableMath.get(MATH_REF)), [], {
      defaults: store.getMathDefaults(MATH_REF),
    })
    const nodes = ['decay_1', 'decay_2'].map((name, i) => ({
      id: `n${i + 1}`,
      type: 'instanceNode',
      data: { name, mathRef: MATH_REF, variables: rows.map((row) => ({ ...row })), ports: [] },
    }))

    const text = await (await generateFlattenedModel(nodes, [], store)).text()
    const ids = [...text.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1])
    expect(ids.length).toBe(new Set(ids).size)
    // Each instance keeps its ids, named after it, so annotations can still point at them.
    for (const name of ['decay_1', 'decay_2']) {
      expect(ids).toEqual(expect.arrayContaining([name, `${name}-t`, `${name}-x`, `${name}-k`, `${name}-eq`]))
    }
  })

  it('prefixes every id when renaming would merge two', async () => {
    setActivePinia(createPinia())
    const store = useLibraryStore()
    store.addUnitsFile({ componentFile: 'units.cellml', model: UNITS })
    // "x" and "main-x" would both become "decay_1-x" if only the component's name were replaced.
    store.addMath(MATH_REF, XML.replace('id="main-k"', 'id="x"'))

    const rows = reconcileRows(analyzeMathXml(store.availableMath.get(MATH_REF)), [], {
      defaults: store.getMathDefaults(MATH_REF),
    })
    const nodes = [{ id: 'n1', type: 'instanceNode', data: { name: 'decay_1', mathRef: MATH_REF, variables: rows, ports: [] } }]

    const text = await (await generateFlattenedModel(nodes, [], store)).text()
    const ids = [...text.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1])
    expect(ids.length).toBe(new Set(ids).size)
    expect(ids).toEqual(expect.arrayContaining(['decay_1-main', 'decay_1-main-x', 'decay_1-x']))
  })
})
