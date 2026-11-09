// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { parseSidecar } from '../../../../src/services/annotations/sidecar.js'
import { buildModularModel } from '../../../../src/services/export/modularCellml.js'
import { analyzeMathXml } from '../../../../src/services/math/analyzeMath.js'
import { stripIds } from '../../../../src/services/math/variableIds.js'
import { reconcileRows } from '../../../../src/services/math/reconcileRows.js'
import { useLibraryStore } from '../../../../src/stores/libraryStore.js'
import { generateFlattenedModel, getLibCellML, loadParametersFromCellML } from '../../../../src/utils/cellml.js'
import { resolvePortCouplings } from '../../../../src/utils/edges.js'
import { ensureLibCellmlReady } from '../../helpers/libcellml-bootstrap.js'

const cellml = (name, body) => `<model xmlns="http://www.cellml.org/cellml/2.0#" name="${name}">
  <component name="${name}" id="b4da55">
${body}
  </component>
</model>`
const MATHML = 'xmlns="http://www.w3.org/1998/Math/MathML" xmlns:cellml="http://www.cellml.org/cellml/2.0#"'

// dq/dt = v - k q, with Annotator-style ids that repeat across the module files.
const TANK = cellml(
  'tank',
  `    <variable name="t" units="second" interface="public"/>
    <variable id="b4da56" name="q" units="mM" interface="public"/>
    <variable id="b4da57" name="v" units="mM_per_s" interface="public"/>
    <variable name="k" units="per_second" interface="public"/>
    <math ${MATHML}>
      <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>q</ci></apply>
        <apply><minus/><ci>v</ci><apply><times/><ci>k</ci><ci>q</ci></apply></apply></apply>
    </math>`
)
// v = k_v (1 + t / 1 s), a flow that changes over time.
const SOURCE = cellml(
  'source',
  `    <variable name="t" units="second" interface="public"/>
    <variable id="b4da56" name="v" units="mM_per_s" interface="public"/>
    <variable name="k_v" units="mM_per_s" interface="public"/>
    <math ${MATHML}>
      <apply><eq/><ci>v</ci><apply><times/><ci>k_v</ci>
        <apply><plus/><cn cellml:units="dimensionless">1</cn><apply><divide/><ci>t</ci><cn cellml:units="second">1</cn></apply></apply>
      </apply></apply>
    </math>`
)
// q follows v: q = v * 1 s.
const FOLLOWER = cellml(
  'follower',
  `    <variable name="v" units="mM_per_s" interface="public"/>
    <variable id="b4da56" name="q" units="mM" interface="public"/>
    <math ${MATHML}>
      <apply><eq/><ci>q</ci><apply><times/><ci>v</ci><cn cellml:units="second">1</cn></apply></apply>
    </math>`
)
const UNITS = `<model xmlns="http://www.cellml.org/cellml/2.0#" name="units">
  <units name="mM"><unit prefix="milli" units="mole"/><unit units="litre" exponent="-1"/></units>
  <units name="mM_per_s"><unit units="mM"/><unit units="second" exponent="-1"/></units>
  <units name="per_second"><unit units="second" exponent="-1"/></units>
</model>`
const TANK_TTL = `@prefix bqbiol: <http://biomodels.net/biology-qualifiers/> .
@prefix opb: <https://identifiers.org/opb/OPB_> .
@prefix sbo: <https://identifiers.org/sbo/SBO:> .
@prefix m: <./tank.cellml#> .
@prefix local: <./tank.ttl#> .

m:tank bqbiol:is sbo:0000290 .
local:entity_self bqbiol:is sbo:0000290 .
m:b4da56 bqbiol:isVersionOf opb:00425 ;
    bqbiol:isPropertyOf local:entity_self .
`

let libcellml

beforeAll(async () => {
  libcellml = await ensureLibCellmlReady().then(() => getLibCellML())
}, 120000)

/**
 * Flattens the modular export with libCellML's Importer, its module files given by location.
 *
 * @returns {string} The flattened model.
 */
function flattenModular({ main, files }) {
  const parser = new libcellml.Parser(false)
  const importer = new libcellml.Importer(true)
  const printer = new libcellml.Printer()
  const modules = files.map(({ location, text }) => {
    const model = parser.parseModel(text)
    importer.addModel(model, location)
    return model
  })
  const model = parser.parseModel(main)
  try {
    importer.resolveImports(model, '')
    expect(importer.errorCount()).toBe(0)
    const flat = importer.flattenModel(model)
    expect(importer.errorCount()).toBe(0)
    const text = printer.printModel(flat, false)
    flat.delete()
    return text
  } finally {
    ;[model, ...modules, importer, parser, printer].forEach((object) => object.delete())
  }
}

/**
 * What the analyser makes of a model, without names or ids: its type, how many of each kind of variable and equation
 * it has, and the states' and constants' initial values.
 */
function analysis(text) {
  const parser = new libcellml.Parser(false)
  const analyser = new libcellml.Analyser()
  const model = parser.parseModel(text)
  try {
    analyser.analyseModel(model)
    const issues = Array.from({ length: analyser.errorCount() }, (_, i) => analyser.error(i).description())
    const analysed = analyser.analyserModel()
    const values = (count, get) =>
      Array.from({ length: analysed[count]() }, (_, i) => {
        const variable = analysed[get](i).variable()
        const value = variable.initialValue()
        variable.delete()
        return value
      }).sort()
    return {
      issues,
      type: libcellml.AnalyserModel.typeAsString(analysed.type()),
      counts: ['stateCount', 'constantCount', 'computedConstantCount', 'algebraicVariableCount', 'analyserEquationCount'].map((count) =>
        analysed[count]()
      ),
      states: values('stateCount', 'state'),
      constants: values('constantCount', 'constant'),
    }
  } finally {
    ;[model, analyser, parser].forEach((object) => object.delete())
  }
}

describe('buildModularModel', () => {
  let store

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useLibraryStore()
    store.addUnitsFile({ componentFile: 'units.cellml', model: UNITS })
    store.addMathFile('tank.cellml', [{ name: 'tank', math: TANK }])
    store.addMathFile('source.cellml', [{ name: 'source', math: SOURCE }])
    store.addMathFile('follower.cellml', [{ name: 'follower', math: FOLLOWER }])
    store.setModuleAnnotations('tank.cellml:tank', TANK_TTL)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => vi.restoreAllMocks())

  /** A node on stored math, its values set and its listed variables typed as boundary conditions. */
  function buildNode(id, mathRef, { values = {}, ports = [], boundaries = [] } = {}) {
    const rows = reconcileRows(analyzeMathXml(store.availableMath.get(mathRef)), [], {
      defaults: store.getMathDefaults(mathRef),
    }).map((row) => ({
      ...row,
      ...(boundaries.includes(row.name) && { type: 'boundary_condition' }),
      ...(row.name in values && { value: values[row.name] }),
    }))
    return { id, type: 'instanceNode', data: { name: id, mathRef, variables: rows, ports } }
  }

  const port = (label, variable, multiportType = 'None') => ({ portType: 'general_ports', label, variables: [variable], multiportType })

  function connect(source, target, extra = {}) {
    const couplings = resolvePortCouplings(source.data.ports, target.data.ports).map((coupling) => ({ ...coupling, ...extra }))
    return { id: `${source.id}_${target.id}`, source: source.id, target: target.id, data: { couplings } }
  }

  /** Builds both forms and checks the modular one flattens to the same model. */
  async function expectEquivalent(nodes, edges) {
    const modular = await buildModularModel(nodes, edges, store)
    const flat = await (await generateFlattenedModel(nodes, edges, store)).text()
    const expected = analysis(flat)
    expect(expected.issues).toEqual([])
    // Flattening repeats an imported file's ids once per instance, which the analyser rejects.
    expect(analysis(stripIds(flattenModular(modular)))).toEqual(expected)
    return modular
  }

  it('imports two instances of one module from one file, ids intact', async () => {
    const nodes = ['tank_a', 'tank_b'].map((id, i) => buildNode(id, 'tank.cellml:tank', { values: { q_init: `${i + 1}`, v: '0.1', k: '0.5' } }))
    const modular = await expectEquivalent(nodes, [])

    expect(modular.files.map(({ location }) => location)).toEqual(['tank.cellml'])
    expect(modular.main).toMatch(/<import [^>]*xlink:href="tank\.cellml"/)
    expect(modular.main).toMatch(/<component component_ref="tank" name="tank_a"\/>/)
    expect(modular.main).toMatch(/<component component_ref="tank" name="tank_b"\/>/)
    expect(modular.main).not.toMatch(/<diff\/>/)
    const [{ text }] = modular.files
    expect(text).toMatch(/id="b4da56"/)
    expect(text).toMatch(/<units name="mM_per_s">/)
  })

  it('keeps the parameter values an OMEX import reads back', async () => {
    const nodes = ['tank_a', 'tank_b'].map((id, i) => buildNode(id, 'tank.cellml:tank', { values: { q_init: `${i + 1}`, v: '0.1', k: '0.5' } }))
    const { main, flat } = await buildModularModel(nodes, [], store)
    expect(loadParametersFromCellML(main)).toEqual(loadParametersFromCellML(flat))
  })

  it('copies the sidecar as stored, and it resolves against the module file', async () => {
    const nodes = [buildNode('tank_a', 'tank.cellml:tank', { values: { q_init: '1', v: '0.1', k: '0.5' } })]
    const { files, sidecars, warnings } = await buildModularModel(nodes, [], store)
    expect(warnings).toEqual([])
    expect(sidecars).toEqual([{ location: 'annotations/tank.cellml/tank.ttl', format: 'text/turtle', text: TANK_TTL }])
    const parsed = await parseSidecar(sidecars[0].text, { mathRef: 'tank.cellml:tank', cellml: files[0].text })
    expect(parsed.unresolved).toEqual([])
    expect(parsed.variables.map(({ variable }) => variable)).toEqual(['q'])
  })

  it('keeps a Sum coupling in the main model', async () => {
    const tank = buildNode('tank_1', 'tank.cellml:tank', { values: { q_init: '1', k: '0.5' }, ports: [port('flow', 'v', 'Sum')], boundaries: ['v'] })
    const sources = ['source_1', 'source_2'].map((id, i) =>
      buildNode(id, 'source.cellml:source', { values: { k_v: `${i + 1}` }, ports: [port('flow', 'v')] })
    )
    const modular = await expectEquivalent([tank, ...sources], sources.map((source) => connect(source, tank)))
    expect(modular.main).toMatch(/<component name="generated_summations">/)
    expect(modular.files.map(({ location }) => location)).toEqual(['tank.cellml', 'source.cellml'])
  })

  it('writes an instance whose driven state the build drops to its own file, with its sidecar re-pointed', async () => {
    store.setMathSource('tank.cellml:tank', { format: 'celldl', document: '<svg/>', documentUri: 'urn:test' })
    const driven = buildNode('tank_1', 'tank.cellml:tank', { values: { q_init: '1', v: '0.1', k: '0.5' }, ports: [port('amount', 'q')] })
    const free = buildNode('tank_2', 'tank.cellml:tank', { values: { q_init: '2', v: '0.1', k: '0.5' } })
    const source = buildNode('source_1', 'source.cellml:source', { values: { k_v: '1' } })
    const follower = buildNode('follower_1', 'follower.cellml:follower', { ports: [port('amount', 'q')], boundaries: ['v'] })
    follower.data.ports.push(port('flow', 'v'))
    source.data.ports = [port('flow', 'v')]
    const edges = [connect(source, follower), connect(follower, driven, { drivesState: true })]
    const modular = await expectEquivalent([driven, free, source, follower], edges)

    const locations = modular.files.map(({ location }) => location)
    expect(locations).toContain('tank.cellml')
    expect(locations).toContain('tank_tank_1.cellml')
    expect(modular.main).toMatch(/xlink:href="tank_tank_1\.cellml">\s*<component component_ref="tank" name="tank_1"\/>/)
    const own = modular.files.find(({ location }) => location === 'tank_tank_1.cellml').text
    expect(own).not.toMatch(/<diff\/>/)
    expect(own).toMatch(/id="b4da56"/)

    const sidecar = modular.sidecars.find(({ location }) => location === 'annotations/tank_tank_1.cellml/tank.ttl')
    expect(sidecar.text).toMatch(/tank_tank_1\.cellml#/)
    const parsed = await parseSidecar(sidecar.text, { mathRef: 'tank_tank_1.cellml:tank', cellml: own })
    expect(parsed.unresolved).toEqual([])
    expect(parsed.warnings).toEqual([])
  })
  it('renames the ids two modules of one file share, and their sidecars follow', async () => {
    store.addMathFile('pair.cellml', [
      { name: 'tank', math: TANK },
      { name: 'source', math: SOURCE },
    ])
    store.setModuleAnnotations('pair.cellml:source', TANK_TTL.replaceAll('tank', 'source').replace('./source.cellml', './pair.cellml'))
    store.setModuleAnnotations('pair.cellml:tank', TANK_TTL.replaceAll('./tank.cellml', './pair.cellml'))
    const tank = buildNode('tank_1', 'pair.cellml:tank', { values: { q_init: '1', k: '0.5' }, ports: [port('flow', 'v')], boundaries: ['v'] })
    const source = buildNode('source_1', 'pair.cellml:source', { values: { k_v: '1' }, ports: [port('flow', 'v')] })
    const modular = await expectEquivalent([tank, source], [connect(source, tank)])

    expect(modular.files.map(({ location }) => location)).toEqual(['pair.cellml'])
    const [{ text }] = modular.files
    expect(text).toMatch(/<component [^>]*name="tank"/)
    expect(text).toMatch(/<component [^>]*name="source"/)
    const ids = [...text.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const name of ['tank', 'source']) {
      const sidecar = modular.sidecars.find(({ location }) => location === `annotations/pair.cellml/${name}.ttl`)
      const parsed = await parseSidecar(sidecar.text, { mathRef: `pair.cellml:${name}`, cellml: text })
      expect(parsed.unresolved).toEqual([])
    }
  })

  it('names a module component as its mathRef does, so component_ref finds it', async () => {
    store.addMathFile('copy.cellml', [{ name: 'tank_copy', math: TANK }])
    const nodes = [buildNode('tank_a', 'copy.cellml:tank_copy', { values: { q_init: '1', v: '0.1', k: '0.5' } })]
    const modular = await expectEquivalent(nodes, [])
    expect(modular.main).toMatch(/<component component_ref="tank_copy" name="tank_a"\/>/)
    expect(modular.files[0].text).toMatch(/<component [^>]*name="tank_copy"/)
  })

  it('puts the module files beside a main model in a folder', async () => {
    const nodes = [buildNode('tank_a', 'tank.cellml:tank', { values: { q_init: '1', v: '0.1', k: '0.5' } })]
    const modular = await buildModularModel(nodes, [], store, [], { mainFileName: 'models/main.cellml' })
    expect(modular.files.map(({ location }) => location)).toEqual(['models/tank.cellml'])
    expect(modular.main).toMatch(/xlink:href="tank\.cellml"/)
  })

  it('leaves out the units ids, which could repeat a component one', async () => {
    store.addUnitsFile({ componentFile: 'units.cellml', model: UNITS.replace('<units name="mM">', '<units name="mM" id="b4da56">') })
    const nodes = [buildNode('tank_a', 'tank.cellml:tank', { values: { q_init: '1', v: '0.1', k: '0.5' } })]
    const { files } = await buildModularModel(nodes, [], store)
    expect(files[0].text).toMatch(/<units name="mM">/)
    expect(files[0].text.match(/id="b4da56"/g)).toHaveLength(1)
  })
})
