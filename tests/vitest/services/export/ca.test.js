// @vitest-environment happy-dom
import JSZip from 'jszip'
import Papa from 'papaparse'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ensureLibCellmlReady } from '../../helpers/libcellml-bootstrap.js'

const notified = vi.hoisted(() => ({ error: vi.fn(), warning: vi.fn() }))
vi.mock('../../../../src/utils/notify', () => ({ notify: notified }))

const { findCaExportBlocker, generateExportZip } = await import('../../../../src/services/export/ca.js')
const { caModuleFileName, groupingTag, renameClashingComponents } = await import('../../../../src/services/export/caCellml.js')
const { combineComponentModels, processCellMLData } = await import('../../../../src/utils/cellml.js')
const { useLibraryStore } = await import('../../../../src/stores/libraryStore.js')

const BG_MATH_REF = 'BG_modules.cellml:vp_simple_type'
const BG_MODULE_REF = 'arterial_simple:vp'

/**
 * A one-component CellML model, as the library stores math.
 *
 * @param {string} name - The component's name.
 * @param {string} body - Its variables and math.
 * @returns {string}
 */
function componentModel(name, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" name="PhLynxComponent">
  <component name="${name}">
${body}
  </component>
</model>
`
}

const VP_MATH = componentModel(
  'vp_simple_type',
  `    <variable name="t" units="second" interface="public"/>
    <variable name="q_C" units="m3" initial_value="0.001" interface="public"/>
    <variable name="v_in" units="m3_per_s" interface="public"/>
    <variable name="C" units="m3_per_J" interface="public"/>
    <variable name="u" units="J_per_m3" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML" xmlns:cellml="http://www.cellml.org/cellml/2.0#">
      <apply><eq/><apply><diff/><bvar><ci>t</ci></bvar><ci>q_C</ci></apply><ci>v_in</ci></apply>
      <apply><eq/><ci>u</ci><apply><divide/><ci>q_C</ci><ci>C</ci></apply></apply>
    </math>`
)

const UNUSED_MATH = componentModel(
  'unused_type',
  `    <variable name="x" units="dimensionless" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML">
      <apply><eq/><ci>x</ci><cn cellml:units="dimensionless" xmlns:cellml="http://www.cellml.org/cellml/2.0#">1</cn></apply>
    </math>`
)

const RATE_MATH = componentModel(
  'rate_type',
  `    <variable name="r" units="per_min" interface="public"/>
    <math xmlns="http://www.w3.org/1998/Math/MathML" xmlns:cellml="http://www.cellml.org/cellml/2.0#">
      <apply><eq/><ci>r</ci><cn cellml:units="per_min">2</cn></apply>
    </math>`
)

const UNITS_MODEL = `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" name="units">
  <units name="m3"><unit units="metre" exponent="3"/></units>
  <units name="m3_per_s"><unit units="m3"/><unit units="second" exponent="-1"/></units>
  <units name="m3_per_J"><unit units="m3"/><unit units="joule" exponent="-1"/></units>
  <units name="J_per_m3"><unit units="joule"/><unit units="m3" exponent="-1"/></units>
  <units name="unused_units"><unit units="metre" exponent="7"/></units>
</model>
`

/**
 * Fills a fresh library with BG_modules.cellml (vp_simple_type, unused_type, zero_flow) and its units.
 *
 * @returns {Object} The library store.
 */
function makeLibrary() {
  const library = useLibraryStore()
  library.addUnitsFile({ componentFile: 'units.cellml', model: UNITS_MODEL })
  library.addMath(BG_MATH_REF, VP_MATH)
  library.addMath('BG_modules.cellml:unused_type', UNUSED_MATH)
  library.addMath('BG_modules.cellml:zero_flow', UNUSED_MATH.replace('unused_type', 'zero_flow'))
  library.addModule({ moduleRef: BG_MODULE_REF, mathRef: BG_MATH_REF, ports: [], variables: [] })
  return library
}

/**
 * Lists the files of an exported zip.
 *
 * @param {Blob} blob
 * @returns {Promise<Object>} Each file's text, by name.
 */
async function readZip(blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const names = Object.keys(zip.files).filter((name) => !zip.files[name].dir)
  return Object.fromEntries(await Promise.all(names.map(async (name) => [name, await zip.file(name).async('string')])))
}

/**
 * Makes a node on one library module.
 *
 * @param {string} name - The instance name, also used as its id.
 * @param {Array} variables - Its parameter rows.
 * @returns {Object}
 */
function nodeWith(name, variables) {
  return { id: name, data: { name, moduleRef: BG_MODULE_REF, mathRef: BG_MATH_REF, ports: [], variables } }
}

/**
 * Assembles a model from exported files as CA does: the units blocks of every `*units.cellml`, then the lines of every
 * `*modules.cellml` from the first holding "component" up to the last, under CA's CellML 1.1 root.
 *
 * @param {Object} files - Each file's text, by name (see readZip).
 * @returns {string}
 */
function assembleAsCa(files) {
  const units = Object.entries(files)
    .filter(([name]) => name.endsWith('units.cellml'))
    .flatMap(([, text]) => text.match(/<units\b[^>]*?\bname="([^"]+)"[^>]*?(?:\/>|>[\s\S]*?<\/units>)/g) ?? [])
  const modules = Object.entries(files)
    .filter(([name]) => name.endsWith('modules.cellml'))
    .flatMap(([, text]) => {
      const lines = text.match(/[^\n]*\n|[^\n]+$/g)
      return lines.slice(lines.findIndex((line) => line.includes('component')), -1)
    })
  return [
    "<?xml version='1.0' encoding='UTF-8'?>\n",
    '<model name="modules" xmlns="http://www.cellml.org/cellml/1.1#" xmlns:cellml="http://www.cellml.org/cellml/1.1#">\n',
    ...units.map((block) => `${block}\n`),
    ...modules,
    '</model>\n',
  ].join('')
}

/**
 * Reads the parameters CSV of an exported zip.
 *
 * @param {Object} files - Each file's text, by name (see readZip).
 * @returns {Object} Each row, by variable name.
 */
function parametersOf(files) {
  const { data } = Papa.parse(files['heart_parameters.csv'], { header: true, skipEmptyLines: true })
  return Object.fromEntries(data.map((row) => [row.variable_name, row]))
}

describe('caModuleFileName', () => {
  it('names a file so it ends in modules.cellml, as CA finds module files', () => {
    expect(caModuleFileName('BG_modules.cellml')).toBe('BG_modules.cellml')
    expect(caModuleFileName('User_Modules.cellml')).toBe('User_modules.cellml')
    expect(caModuleFileName('my_math.cellml')).toBe('my_math_modules.cellml')
    expect(caModuleFileName('template_modules.CellML')).toBe('template_modules.cellml')
  })

  it("names a CellDL grouping as CellML, apart from the CellML grouping of its stem", () => {
    expect(caModuleFileName('User_Modules.celldl')).toBe('User_CellDL_modules.cellml')
    expect(caModuleFileName('User_Modules.cellml')).not.toBe(caModuleFileName('User_Modules.celldl'))
  })
})

describe('renameClashingComponents', () => {
  it('keeps the name for a CellML grouping, then the first by name, and tags the rest', () => {
    const typesByFile = new Map([
      ['User_Modules.celldl', new Set(['decay', 'grow'])],
      ['b_modules.cellml', new Set(['decay'])],
      ['a.cellml', new Set(['decay'])],
    ])
    expect(renameClashingComponents(typesByFile)).toEqual([
      { file: 'b_modules.cellml', from: 'decay', to: 'decay_b' },
      { file: 'User_Modules.celldl', from: 'decay', to: 'decay_celldl' },
    ])
  })

  it('numbers past names any grouping holds', () => {
    const typesByFile = new Map([
      ['User_Modules.cellml', new Set(['decay', 'decay_celldl'])],
      ['User_Modules.celldl', new Set(['decay'])],
    ])
    expect(renameClashingComponents(typesByFile)).toEqual([{ file: 'User_Modules.celldl', from: 'decay', to: 'decay_celldl_2' }])
  })

  it('renames nothing when names differ', () => {
    expect(renameClashingComponents(new Map([['a.cellml', new Set(['x'])], ['b.celldl', new Set(['y'])]]))).toEqual([])
  })

  it('tags groupings as CellML identifiers', () => {
    expect(groupingTag('User_Modules.celldl')).toBe('celldl')
    expect(groupingTag('BG_modules.cellml')).toBe('bg')
    expect(groupingTag('my-math v2.cellml')).toBe('my_math_v2')
    expect(groupingTag('modules.cellml')).toBe('file')
  })
})

describe('generateExportZip', () => {
  let library
  let libcellml

  beforeAll(async () => {
    libcellml = (await ensureLibCellmlReady()).instance
  }, 120000)

  beforeEach(() => {
    vi.clearAllMocks()
    setActivePinia(createPinia())
    library = makeLibrary()
  })

  it("writes the workspace's obs_data beside the module array, as CA names it", async () => {
    const obsData = new TextEncoder().encode('{"protocol_info": {"pre_times": [0], "sim_times": [[1]]}}\n').buffer
    const files = await readZip(await generateExportZip('heart', [], [], library, obsData))
    expect(Object.keys(files)).toContain('heart_obs_data.json')
    expect(files['heart_obs_data.json']).toBe('{"protocol_info": {"pre_times": [0], "sim_times": [[1]]}}\n')
  })

  it("names each config entry's CellML component, as CA's PhLynx schema needs", async () => {
    const files = await readZip(await generateExportZip('heart', [nodeWith('vp', [])], [], library))
    const [entry] = JSON.parse(files['modules/heart_module_config.json'])
    expect(entry).toMatchObject({
      module_type: 'arterial_simple',
      module_subtype: 'vp',
      component_file: 'BG_modules.cellml',
      component_type: 'vp_simple_type',
    })
  })

  it('writes a module generated from another format as CellML, the math CA gets', async () => {
    library.setMathSource(BG_MATH_REF, { format: 'celldl', document: null, documentUri: 'https://example.org/vp.celldl' })
    const files = await readZip(await generateExportZip('heart', [nodeWith('vp', [])], [], library))
    const [entry] = JSON.parse(files['modules/heart_module_config.json'])
    expect(entry.module_format).toBe('cellml')
    expect(files['modules/BG_modules.cellml']).toContain('<component name="vp_simple_type">')
  })

  it('refuses a CellDL store a connection drives, as CA would run its own equation', async () => {
    library.setMathSource(BG_MATH_REF, { format: 'celldl', document: null, documentUri: 'https://example.org/vp.celldl' })
    const store = nodeWith('s', [{ name: 'q', type: 'variable', stateRole: 'state', units: 'm3' }])
    const source = nodeWith('src', [{ name: 'X', type: 'variable', units: 'm3' }])
    source.data.mathRef = 'other.cellml:x'
    const coupling = { sourcePort: { label: 'p', variables: ['X'] }, targetPort: { label: 'p', variables: ['q'] }, drivesState: true }
    const edge = { id: 'e', source: 'src', target: 's', data: { couplings: [coupling] } }

    const message = "Driving a CellDL store from a connection isn't supported in the CA export yet: s.q"
    expect(findCaExportBlocker([source, store], [edge], library)).toBe(message)
    await expect(generateExportZip('heart', [source, store], [edge], library)).rejects.toThrow(message)
    // The caller reports it, so it shows once.
    expect(notified.error).not.toHaveBeenCalled()
    expect(findCaExportBlocker([source, store], [], library)).toBeNull()
  })

  it('writes each boundary condition row, as CA needs one for every boundary condition', async () => {
    const node = nodeWith('out', [
      { name: 'u_out', type: 'boundary_condition', units: 'J_per_m3', value: '1000' },
      { name: 'q_out', type: 'boundary_condition', units: 'm3_per_s', value: 0 },
    ])
    const parameters = parametersOf(await readZip(await generateExportZip('heart', [node], [], library)))
    expect(parameters.u_out_out).toMatchObject({ units: 'J_per_m3', value: '1000', data_reference: 'phlynx' })
    expect(parameters.q_out_out.value).toBe('0')
    expect(notified.warning).not.toHaveBeenCalled()
  })

  it("marks a blank boundary condition for CA to ask for, and warns when nothing is connected to it", async () => {
    const node = nodeWith('out', [{ name: 'u_out', type: 'boundary_condition', units: 'J_per_m3', value: '' }])
    const parameters = parametersOf(await readZip(await generateExportZip('heart', [node], [], library)))
    expect(parameters.u_out_out.value).toBe('EMPTY_MUST_BE_FILLED')
    expect(notified.warning).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('out.u_out') }))
  })

  it('writes a constant or global constant of 0, which is not blank', async () => {
    library.assignGlobalConstant('g', 0, 'dimensionless')
    const node = nodeWith('out', [{ name: 'R', type: 'constant', units: 'Js_per_m6', value: 0 }])
    const parameters = parametersOf(await readZip(await generateExportZip('heart', [node], [], library)))
    expect(parameters.R_out.value).toBe('0')
    expect(parameters.g.value).toBe('0')
  })

  it('writes each component file the config names, holding only the components it uses', async () => {
    const files = await readZip(await generateExportZip('heart', [nodeWith('vp', [])], [], library))
    const [entry] = JSON.parse(files['modules/heart_module_config.json'])
    expect(Object.keys(files)).toContain(`modules/${entry.component_file}`)
    const modules = files['modules/BG_modules.cellml']
    expect(modules).toContain('<component name="vp_simple_type">')
    expect(modules).not.toContain('unused_type')
    expect(modules).not.toContain('zero_flow')
  })

  it('writes the math as edited in PhLynx', async () => {
    library.addMath(BG_MATH_REF, VP_MATH.replace('<ci>q_C</ci><ci>C</ci>', '<ci>q_C</ci><ci>C_edited</ci>').replace(
      '<variable name="u"', '<variable name="C_edited" units="m3_per_J" interface="public"/>\n    <variable name="u"'))
    const files = await readZip(await generateExportZip('heart', [nodeWith('vp', [])], [], library))
    expect(files['modules/BG_modules.cellml']).toContain('C_edited')
  })

  it("lays each module file out as CA's line-based copy needs", async () => {
    const files = await readZip(await generateExportZip('heart', [nodeWith('vp', [])], [], library))
    const lines = files['modules/BG_modules.cellml'].trimEnd().split('\n')
    const first = lines.findIndex((line) => line.includes('component'))
    expect(lines[first]).toMatch(/^\s*<component name="vp_simple_type">$/)
    expect(lines.at(-1)).toBe('</model>')
  })

  it('renames a component file CA would not find, and points the config at it', async () => {
    library.addMath('my_math.cellml:rate_type', RATE_MATH)
    library.addGeneratedUnits({ name: 'per_min', parts: [{ units: 'second', prefix: 0, exponent: -1, multiplier: 60 }] })
    library.addModule({ moduleRef: 'rate:default', mathRef: 'my_math.cellml:rate_type', ports: [], variables: [] })
    const node = { id: 'r', data: { name: 'r', moduleRef: 'rate:default', mathRef: 'my_math.cellml:rate_type', ports: [], variables: [] } }
    const files = await readZip(await generateExportZip('heart', [node], [], library))
    const [entry] = JSON.parse(files['modules/heart_module_config.json'])
    expect(entry.component_file).toBe('my_math_modules.cellml')
    expect(files['modules/my_math_modules.cellml']).toContain('<component name="rate_type">')
    expect(Object.keys(files)).not.toContain('modules/my_math.cellml')
  })

  it('writes the units the components use, and the units those are made of, with generated units', async () => {
    library.addMath('my_math.cellml:rate_type', RATE_MATH)
    library.addGeneratedUnits({ name: 'per_min', parts: [{ units: 'second', prefix: 0, exponent: -1, multiplier: 60 }] })
    library.addModule({ moduleRef: 'rate:default', mathRef: 'my_math.cellml:rate_type', ports: [], variables: [] })
    const nodes = [nodeWith('vp', []), { id: 'r', data: { name: 'r', moduleRef: 'rate:default', mathRef: 'my_math.cellml:rate_type', ports: [], variables: [] } }]
    const files = await readZip(await generateExportZip('heart', nodes, [], library))
    const names = [...files['modules/heart_units.cellml'].matchAll(/<units name="([^"]+)"/g)].map(([, name]) => name).sort()
    expect(names).toEqual(['J_per_m3', 'm3', 'm3_per_J', 'm3_per_s', 'per_min'])
    expect(notified.warning).not.toHaveBeenCalled()
  })

  it('writes a unit only a number uses', async () => {
    library.addMath('my_math.cellml:rate_type', RATE_MATH.replace('name="r" units="per_min"', 'name="r" units="dimensionless"'))
    library.addGeneratedUnits({ name: 'per_min', parts: [{ units: 'second', prefix: 0, exponent: -1, multiplier: 60 }] })
    library.addModule({ moduleRef: 'rate:default', mathRef: 'my_math.cellml:rate_type', ports: [], variables: [] })
    const node = { id: 'r', data: { name: 'r', moduleRef: 'rate:default', mathRef: 'my_math.cellml:rate_type', ports: [], variables: [] } }
    const files = await readZip(await generateExportZip('heart', [node], [], library))
    expect(files['modules/heart_units.cellml']).toContain('<units name="per_min">')
  })

  it('warns about units no library units file defines', async () => {
    library.addMath(BG_MATH_REF, VP_MATH.replace('units="J_per_m3"', 'units="mystery"'))
    const files = await readZip(await generateExportZip('heart', [nodeWith('vp', [])], [], library))
    expect(files['modules/heart_units.cellml']).not.toContain('mystery')
    expect(notified.warning).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('mystery') }))
  })

  it('adds the zero_flow component CA uses with a heart', async () => {
    library.addModule({ moduleRef: 'heart:simple', mathRef: BG_MATH_REF, ports: [], variables: [] })
    const node = { id: 'h', data: { name: 'heart', moduleRef: 'heart:simple', mathRef: BG_MATH_REF, ports: [], variables: [] } }
    const files = await readZip(await generateExportZip('heart', [node], [], library))
    expect(files['modules/BG_modules.cellml']).toContain('<component name="zero_flow">')
  })

  it("keeps obs_data out of the modules folder, as CA reads every JSON file there as a module config", async () => {
    const obsData = '{"protocol_info": {}}'
    const files = await readZip(await generateExportZip('heart', [nodeWith('vp', [])], [], library, obsData))
    expect(Object.keys(files).filter((name) => name.startsWith('modules/') && name.endsWith('.json'))).toEqual([
      'modules/heart_module_config.json',
    ])
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['heart_module_array.csv', 'heart_parameters.csv', 'heart_obs_data.json']))
  })

  it('writes units that only other units are made of', async () => {
    library.addGeneratedUnits({ name: 'per_min', parts: [{ units: 'second', prefix: 0, exponent: -1, multiplier: 60 }] })
    library.addGeneratedUnits({ name: 'per_min_per_mM', parts: [{ units: 'per_min' }, { units: 'mM', exponent: -1 }] })
    library.addGeneratedUnits({ name: 'mM', parts: [{ units: 'mole', prefix: -3 }, { units: 'litre', exponent: -1 }] })
    library.addMath('my_math.cellml:rate_type', RATE_MATH.replaceAll('per_min', 'per_min_per_mM'))
    library.addModule({ moduleRef: 'rate:default', mathRef: 'my_math.cellml:rate_type', ports: [], variables: [] })
    const node = { id: 'r', data: { name: 'r', moduleRef: 'rate:default', mathRef: 'my_math.cellml:rate_type', ports: [], variables: [] } }
    const files = await readZip(await generateExportZip('heart', [node], [], library))
    const units = files['modules/heart_units.cellml']
    expect(units).toContain('<units name="per_min">')
    expect(units).toContain('<units name="mM">')
    expect(units).not.toContain('<units name="litre">')
  })

  it("writes the flow and volume units CA's generated components use", async () => {
    library.addMath('my_math.cellml:rate_type', RATE_MATH)
    library.addGeneratedUnits({ name: 'per_min', parts: [{ units: 'second', prefix: 0, exponent: -1, multiplier: 60 }] })
    library.addModule({ moduleRef: 'rate:default', mathRef: 'my_math.cellml:rate_type', ports: [], variables: [] })
    const node = { id: 'r', data: { name: 'r', moduleRef: 'rate:default', mathRef: 'my_math.cellml:rate_type', ports: [], variables: [] } }
    const files = await readZip(await generateExportZip('heart', [node], [], library))
    expect(files['modules/heart_units.cellml']).toContain('<units name="m3_per_s">')
  })

  it("doesn't warn about a blank boundary condition something is connected to", async () => {
    const port = (label, variable) => ({ label, portType: 'general_ports', variables: [variable], multiportType: 'None' })
    const source = { id: 'a', data: { ...nodeWith('a', [{ name: 'u', type: 'variable', units: 'J_per_m3' }]).data, ports: [port('p', 'u')] } }
    const target = { id: 'b', data: { ...nodeWith('b', [{ name: 'u_out', type: 'boundary_condition', units: 'J_per_m3', value: '' }]).data, ports: [port('p', 'u_out')] } }
    const edge = { source: 'a', target: 'b', data: { couplings: [{ sourcePort: source.data.ports[0], targetPort: target.data.ports[0] }] } }
    const files = await readZip(await generateExportZip('heart', [source, target], [edge], library))
    expect(parametersOf(files).u_out_b.value).toBe('EMPTY_MUST_BE_FILLED')
    expect(notified.warning).not.toHaveBeenCalled()
  })

  it('adds the module CA uses for the pulmonary circuit of a heart with one output, and warns', async () => {
    library.addModule({ moduleRef: 'heart:simple', mathRef: BG_MATH_REF, ports: [], variables: [] })
    const node = { id: 'h', data: { name: 'heart', moduleRef: 'heart:simple', mathRef: BG_MATH_REF, ports: [], variables: [] } }
    const files = await readZip(await generateExportZip('heart', [node], [], library))
    const entries = JSON.parse(files['modules/heart_module_config.json']).map((entry) => `${entry.module_type}:${entry.module_subtype}`)
    expect(entries).toEqual(['heart:simple', 'arterial_simple:vp'])
    expect(notified.warning).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('par, pvn') }))
  })

  it('fails when a component has no math in the library', async () => {
    library.addModule({ moduleRef: 'stub:default', mathRef: 'gone.cellml:stub_type', ports: [], variables: [] })
    const node = { id: 's', data: { name: 's', moduleRef: 'stub:default', mathRef: 'gone.cellml:stub_type', ports: [], variables: [] } }
    await expect(generateExportZip('heart', [node], [], library)).rejects.toThrow('gone.cellml:stub_type')
  })

  it('renames a component another file holds by name, in the config and its file, and warns', async () => {
    library.addMath('other_modules.cellml:vp_simple_type', VP_MATH)
    library.addModule({ moduleRef: 'other:vp', mathRef: 'other_modules.cellml:vp_simple_type', ports: [], variables: [] })
    const other = { id: 'o', data: { name: 'o', moduleRef: 'other:vp', mathRef: 'other_modules.cellml:vp_simple_type', ports: [], variables: [] } }
    const files = await readZip(await generateExportZip('heart', [nodeWith('vp', []), other], [], library))
    const entries = JSON.parse(files['modules/heart_module_config.json'])
    expect(entries.map((entry) => [entry.module_type, entry.component_file, entry.component_type])).toEqual([
      ['arterial_simple', 'BG_modules.cellml', 'vp_simple_type'],
      ['other', 'other_modules.cellml', 'vp_simple_type_other'],
    ])
    expect(files['modules/other_modules.cellml']).toContain('<component name="vp_simple_type_other">')
    expect(files['modules/BG_modules.cellml']).toContain('<component name="vp_simple_type">')
    expect(library.availableMath.has('other_modules.cellml:vp_simple_type')).toBe(true)
  })

  it('writes the CellDL user modules grouping as a .cellml file, beside the CellML one', async () => {
    library.addGeneratedUnits({ name: 'per_min', parts: [{ units: 'second', prefix: 0, exponent: -1, multiplier: 60 }] })
    const groupings = { cellml: 'User_Modules.cellml:rate_type', celldl: 'User_Modules.celldl:diagram_type' }
    library.addMath(groupings.cellml, RATE_MATH)
    library.addMath(groupings.celldl, RATE_MATH.replace('rate_type', 'diagram_type'))
    library.setMathSource(groupings.celldl, { format: 'celldl', document: null, documentUri: 'https://example.org/d.celldl' })
    const nodes = Object.entries(groupings).map(([id, mathRef]) => {
      library.addModule({ moduleRef: `${id}:default`, mathRef, ports: [], variables: [] })
      return { id, data: { name: id, moduleRef: `${id}:default`, mathRef, ports: [], variables: [] } }
    })
    const files = await readZip(await generateExportZip('heart', nodes, [], library))
    const entries = JSON.parse(files['modules/heart_module_config.json'])
    expect(entries.map((entry) => entry.component_file).sort()).toEqual(['User_CellDL_modules.cellml', 'User_modules.cellml'])
    expect(files['modules/User_CellDL_modules.cellml']).toContain('<component name="diagram_type">')
    expect(files['modules/User_modules.cellml']).toContain('<component name="rate_type">')
    expect(Object.keys(files).some((name) => name.includes('.celldl'))).toBe(false)
  })

  /**
   * Adds a rate_type module, and a node on it, in each grouping.
   *
   * @param {string[]} groupings
   * @returns {Array} The nodes.
   */
  function rateNodesIn(groupings) {
    library.addGeneratedUnits({ name: 'per_min', parts: [{ units: 'second', prefix: 0, exponent: -1, multiplier: 60 }] })
    return groupings.map((grouping, i) => {
      const mathRef = `${grouping}:rate_type`
      library.addMath(mathRef, RATE_MATH)
      library.addModule({ moduleRef: `rate${i}:default`, mathRef, ports: [], variables: [{ name: 'r', type: 'constant', units: 'per_min', value: i }] })
      return { id: `r${i}`, data: { name: `r${i}`, moduleRef: `rate${i}:default`, mathRef, ports: [], variables: [{ name: 'r', type: 'constant', units: 'per_min', value: i }] } }
    })
  }

  it('renames the CellDL user module of a CellML user module\'s name everywhere it is named, and warns', async () => {
    const nodes = rateNodesIn(['User_Modules.celldl', 'User_Modules.cellml'])
    const files = await readZip(await generateExportZip('heart', nodes, [], library))
    const entries = JSON.parse(files['modules/heart_module_config.json'])
    expect(entries.map((entry) => [entry.module_type, entry.component_file, entry.component_type])).toEqual([
      ['rate0', 'User_CellDL_modules.cellml', 'rate_type_celldl'],
      ['rate1', 'User_modules.cellml', 'rate_type'],
    ])
    expect(files['modules/User_CellDL_modules.cellml']).toContain('<component name="rate_type_celldl">')
    expect(files['modules/User_CellDL_modules.cellml']).not.toContain('"rate_type"')
    expect(files['modules/User_modules.cellml']).toContain('<component name="rate_type">')
    // The module array and parameters name instances and module types, which the rename leaves alone.
    const { data: rows } = Papa.parse(files['heart_module_array.csv'], { header: true, skipEmptyLines: true })
    expect(rows.map((row) => `${row.module_type}:${row.module_subtype}`)).toEqual(['rate0:default', 'rate1:default'])
    expect(Object.keys(parametersOf(files))).toEqual(['r_r0', 'r_r1'])
    expect(notified.warning).toHaveBeenCalledWith({
      title: 'Components Renamed',
      message: 'CA finds components by name, so the export renames "rate_type" in User_Modules.celldl to "rate_type_celldl". The library keeps the original names.',
    })
    expect(library.availableMath.has('User_Modules.celldl:rate_type')).toBe(true)
  })

  it('numbers a renamed component while its name is taken, listing each rename', async () => {
    const nodes = rateNodesIn(['User_Modules.celldl', 'Lab_Modules.celldl', 'User_Modules.cellml'])
    const files = await readZip(await generateExportZip('heart', nodes, [], library))
    const entries = JSON.parse(files['modules/heart_module_config.json'])
    expect(entries.map((entry) => entry.component_type)).toEqual(['rate_type_celldl_2', 'rate_type_celldl', 'rate_type'])
    expect(files['modules/User_CellDL_modules.cellml']).toContain('<component name="rate_type_celldl_2">')
    expect(files['modules/Lab_CellDL_modules.cellml']).toContain('<component name="rate_type_celldl">')
    const { message } = notified.warning.mock.calls.find(([warning]) => warning.title === 'Components Renamed')[0]
    expect(message).toContain('"rate_type" in Lab_Modules.celldl to "rate_type_celldl"')
    expect(message).toContain('"rate_type" in User_Modules.celldl to "rate_type_celldl_2"')
  })

  it('writes a CA model libCellML parses when components are renamed', async () => {
    const files = await readZip(await generateExportZip('heart', rateNodesIn(['User_Modules.celldl', 'User_Modules.cellml']), [], library))
    const parser = new libcellml.Parser(false)
    const model = parser.parseModel(assembleAsCa(files))
    expect(Array.from({ length: parser.errorCount() }, (_, i) => parser.error(i).description())).toEqual([])
    expect(model.componentCount()).toBe(2)
    model.delete()
    parser.delete()
  })

  it('imports the export as CellML modules under the names it was written with', async () => {
    const files = await readZip(await generateExportZip('heart', rateNodesIn(['User_Modules.celldl', 'User_Modules.cellml']), [], library))
    setActivePinia(createPinia())
    const imported = useLibraryStore()
    for (const [path, text] of Object.entries(files)) {
      const name = path.replace(/^modules\//, '')
      if (name.endsWith('modules.cellml')) imported.addMathFile(name, processCellMLData(text).components)
    }
    imported.addConfigFile('heart_module_config.json', JSON.parse(files['modules/heart_module_config.json']))
    expect(imported.availableModules.get('rate0:default').mathRef).toBe('User_CellDL_modules.cellml:rate_type_celldl')
    expect(imported.availableModules.get('rate1:default').mathRef).toBe('User_modules.cellml:rate_type')
    expect(imported.availableModules.get('rate0:default').isStub).toBeUndefined()
  })

  it('writes the same files as before when no components clash', async () => {
    const nodes = rateNodesIn(['User_Modules.celldl'])
    const files = await readZip(await generateExportZip('heart', [nodeWith('vp', []), ...nodes], [], library))
    expect(files['modules/User_CellDL_modules.cellml']).toBe(combineComponentModels('modules', [library.availableMath.get('User_Modules.celldl:rate_type')]))
    expect(files['modules/BG_modules.cellml']).toBe(combineComponentModels('modules', [library.availableMath.get(BG_MATH_REF)]))
    expect(JSON.parse(files['modules/heart_module_config.json']).map((entry) => entry.component_type)).toEqual(['vp_simple_type', 'rate_type'])
    expect(notified.warning).not.toHaveBeenCalled()
  })

  it('gives files CA assembles into a model libCellML parses', async () => {
    const files = await readZip(await generateExportZip('heart', [nodeWith('vp', [])], [], library))
    const parser = new libcellml.Parser(false)
    const model = parser.parseModel(assembleAsCa(files))
    const errors = Array.from({ length: parser.errorCount() }, (_, i) => parser.error(i).description())
    expect(errors).toEqual([])
    expect(model.componentCount()).toBe(1)
    expect(model.unitsCount()).toBe(4)
    model.delete()
    parser.delete()
  })

  it('writes no obs_data for a workspace without one', async () => {
    expect(Object.keys(await readZip(await generateExportZip('heart', [], [], library)))).not.toContain('heart_obs_data.json')
  })
})
