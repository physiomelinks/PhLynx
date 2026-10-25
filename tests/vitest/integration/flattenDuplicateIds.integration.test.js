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
    // The component's id is the instance's name whichever way the others go.
    expect(ids).toEqual(expect.arrayContaining(['decay_1', 'decay_1-main-x', 'decay_1-x']))
    expect(ids).not.toContain('decay_1-main')
  })
})

// The same math with no ids at all, and a sidecar annotating x and k.
const PLAIN_XML = XML.replace(/\s+id="[^"]*"/g, '')
// Its mathRef names the component, so the sidecar's subjects resolve.
const ANNOTATED_REF = 'file:main'
const SIDECAR = `@prefix bqbiol: <http://biomodels.net/biology-qualifiers/> .
@prefix opb: <http://identifiers.org/opb/OPB_> .
@prefix m: <./file#> .
m:main bqbiol:is <http://purl.obolibrary.org/obo/SBO_0000290> .
m:main.x bqbiol:isVersionOf opb:00340 ; bqbiol:isPropertyOf m:main .
m:main.k bqbiol:isVersionOf opb:00592 ; bqbiol:isPropertyOf m:main .
`

describe('generateFlattenedModel ids for annotations', () => {
  beforeAll(async () => {
    await ensureLibCellmlReady()
  }, 120000)

  async function flatten(xml, names, { sidecar = null } = {}) {
    setActivePinia(createPinia())
    const store = useLibraryStore()
    store.addUnitsFile({ componentFile: 'units.cellml', model: UNITS })
    store.addMath(ANNOTATED_REF, xml)
    if (sidecar) {
      store.setModuleAnnotations(ANNOTATED_REF, sidecar)
      await store.ensureModuleAnnotations(ANNOTATED_REF)
    }
    const rows = reconcileRows(analyzeMathXml(store.availableMath.get(ANNOTATED_REF)), [], {
      defaults: store.getMathDefaults(ANNOTATED_REF),
    })
    const nodes = names.map((name, i) => ({
      id: `n${i + 1}`,
      type: 'instanceNode',
      data: { name, mathRef: ANNOTATED_REF, variables: rows.map((row) => ({ ...row })), ports: [] },
    }))
    const exportedIds = new Map()
    const text = await (await generateFlattenedModel(nodes, [], store, [], { exportedIds })).text()
    return { text, exportedIds, doc: new DOMParser().parseFromString(text, 'application/xml') }
  }

  const idOf = (doc, componentName, variableName) => {
    const component = [...doc.getElementsByTagName('component')].find((c) => c.getAttribute('name') === componentName)
    if (!variableName) return component?.getAttribute('id') ?? null
    const variable = [...component.getElementsByTagName('variable')].find((v) => v.getAttribute('name') === variableName)
    return variable?.getAttribute('id') ?? null
  }

  it('gives each instance component its name as id, even when the math has no ids', async () => {
    const { doc, exportedIds } = await flatten(PLAIN_XML, ['decay_1', 'decay_2'])
    expect(idOf(doc, 'decay_1')).toBe('decay_1')
    expect(idOf(doc, 'decay_2')).toBe('decay_2')
    expect(idOf(doc, 'decay_1', 'x')).toBeNull()
    expect(exportedIds.get('n1')).toEqual({ componentId: 'decay_1', variableIds: new Map() })
  })

  it('gives annotated variables without an id <instance>-<variable>', async () => {
    const { doc, text, exportedIds } = await flatten(PLAIN_XML, ['decay_1', 'decay_2'], { sidecar: SIDECAR })
    for (const name of ['decay_1', 'decay_2']) {
      expect(idOf(doc, name, 'x')).toBe(`${name}-x`)
      expect(idOf(doc, name, 'k')).toBe(`${name}-k`)
      expect(idOf(doc, name, 't')).toBeNull()
    }
    expect(exportedIds.get('n2').variableIds).toEqual(new Map([['x', 'decay_2-x'], ['k', 'decay_2-k']]))
    const ids = [...text.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1])
    expect(ids.length).toBe(new Set(ids).size)
    // Every id is an XML NCName, as CellML requires.
    for (const id of ids) expect(id).toMatch(/^[A-Za-z_][A-Za-z0-9_.-]*$/)
  })

  it('keeps an id the math gives and steers clear of one already taken', async () => {
    // k has its own id, and t's id would be what x is given.
    const xml = PLAIN_XML.replace('name="k"', 'name="k" id="rate"').replace('name="t"', 'name="t" id="main-x"')
    const { doc, text, exportedIds } = await flatten(xml, ['decay_1'], { sidecar: SIDECAR })
    expect(idOf(doc, 'decay_1', 'k')).toBe('decay_1-rate')
    expect(idOf(doc, 'decay_1', 't')).toBe('decay_1-x')
    expect(idOf(doc, 'decay_1', 'x')).toBe('decay_1-x_2')
    expect(exportedIds.get('n1').variableIds.get('x')).toBe('decay_1-x_2')
    const ids = [...text.matchAll(/\bid="([^"]*)"/g)].map((m) => m[1])
    expect(ids.length).toBe(new Set(ids).size)
  })
})
