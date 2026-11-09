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
const { buildInstance } = await import('../../../../src/services/import/buildWorkflow.js')

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
 * Reads the model parameters file of an exported zip.
 *
 * @param {Object} files - Each file's text, by name (see readZip).
 * @returns {Object} Its JSON: `global`, then instance, then variable.
 */
function parametersOf(files) {
  return JSON.parse(files['heart_parameters.json'])
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

  it("writes the module's default parameterisation, from the library when the node has none", async () => {
    library.availableModules.get(BG_MODULE_REF).defaultParameterisation = 'vp'
    const files = await readZip(await generateExportZip('heart', [nodeWith('vp', [])], [], library))
    const [entry] = JSON.parse(files['modules/heart_module_config.json'])
    expect(entry.default_parameterisation).toBe('vp')
  })

  it('names a non-default parameter set on the instance\'s module array row only', async () => {
    library.availableModules.get(BG_MODULE_REF).defaultParameterisation = 'vp'
    const nodes = [nodeWith('a', []), nodeWith('b', []), nodeWith('c', [])]
    nodes[0].data.parameterisation = 'vp'
    nodes[1].data.parameterisation = 'vp_calibrated'
    const files = await readZip(await generateExportZip('heart', nodes, [], library))
    const { data: rows } = Papa.parse(files['heart_module_array.csv'], { header: true, skipEmptyLines: true })
    expect(rows.map((row) => row.parameterisation)).toEqual(['', 'vp_calibrated', ''])
  })

  it('writes no parameterisation column when every instance uses its default', async () => {
    const files = await readZip(await generateExportZip('heart', [nodeWith('vp', [])], [], library))
    expect(files['heart_module_array.csv'].split('\n')[0]).not.toContain('parameterisation')
  })

  it('writes no default parameterisation when the module names none', async () => {
    const files = await readZip(await generateExportZip('heart', [nodeWith('vp', [])], [], library))
    const [entry] = JSON.parse(files['modules/heart_module_config.json'])
    expect(entry).not.toHaveProperty('default_parameterisation')
  })

  it('writes each parameter set an instance uses, default or chosen, as CA reads it', async () => {
    library.availableModules.get(BG_MODULE_REF).defaultParameterisation = 'vp'
    const param = (value, extra = {}) => ({ value, units: 'J_per_m3', data_reference: 'paper', extra })
    const sets = {
      vp: { ref: 'vp', globals: new Map([['rho', param('1e-07')]]), values: new Map([['E', param('30250.0', { sourced: 'no' })], ['C', param(null)]]) },
      vp_calibrated: { ref: 'vp_calibrated', globals: new Map(), values: new Map([['E', param('7')], ['note', param('n/a')]]) },
      unused: { ref: 'unused', globals: new Map(), values: new Map() },
    }
    const getParameterSet = vi.fn((mathRef, ref) => (mathRef === BG_MATH_REF ? (sets[ref] ?? null) : null))
    const nodes = [nodeWith('a', []), nodeWith('b', []), nodeWith('c', [])]
    nodes[1].data.parameterisation = 'vp_calibrated'
    nodes[2].data.parameterisation = 'gone'

    const files = await readZip(await generateExportZip('heart', nodes, [], library, null, { getParameterSet }))

    expect(Object.keys(files).filter((name) => name.startsWith('parameters/')).sort()).toEqual([
      'parameters/vp_calibrated_parameters.json',
      'parameters/vp_parameters.json',
    ])
    expect(files['parameters/vp_parameters.json']).toBe(
      [
        '{',
        ' "schema_version": 1,',
        ' "global": {',
        '  "rho": {"value": 1e-07, "units": "J_per_m3", "data_reference": "paper"}',
        ' },',
        ' "E": {"value": 30250.0, "units": "J_per_m3", "data_reference": "paper", "sourced": "no"},',
        ' "C": {"value": "EMPTY_MUST_BE_FILLED", "units": "J_per_m3", "data_reference": "paper"}',
        '}',
        '',
      ].join('\n')
    )
    const calibrated = JSON.parse(files['parameters/vp_calibrated_parameters.json'])
    expect(calibrated).toEqual({
      schema_version: 1,
      E: { value: 7, units: 'J_per_m3', data_reference: 'paper' },
      note: { value: 'n/a', units: 'J_per_m3', data_reference: 'paper' },
    })
    // The module array's ref names the file written.
    const { data: rows } = Papa.parse(files['heart_module_array.csv'], { header: true, skipEmptyLines: true })
    expect(files[`parameters/${rows[1].parameterisation}_parameters.json`]).toBeDefined()
  })

  it("writes a set an instance made from its current values, and names it on the instance's row", async () => {
    library.availableModules.get(BG_MODULE_REF).defaultParameterisation = 'vp'
    const stored = (value) => new Map([['E', { value, units: 'J_per_m3', data_reference: '', extra: {} }]])
    const sets = {
      vp: { ref: 'vp', source: { file: 'vp_parameters.json', importedAt: '' }, globals: new Map(), values: stored('1') },
      a: { ref: 'a', source: { file: '', importedAt: '', kind: 'instance', nodeId: 'a' }, globals: new Map(), values: stored('2') },
    }
    const getParameterSet = (mathRef, ref) => sets[ref] ?? null
    const rows = [
      { name: 'E', type: 'constant', value: '5', units: 'J_per_m3', data_reference: 'mine' },
      { name: 'C', type: 'constant', value: '', units: 'm3_per_J' },
      { name: 'q', type: 'variable', value: '', units: 'm3' },
    ]
    const nodes = [nodeWith('a', rows), nodeWith('b', [{ ...rows[0], value: '8' }])]
    nodes[0].data.parameterisation = 'a'
    nodes[1].data.parameterisation = 'vp'

    const files = await readZip(await generateExportZip('heart', nodes, [], library, null, { getParameterSet }))

    expect(JSON.parse(files['parameters/a_parameters.json'])).toEqual({
      schema_version: 1,
      E: { value: 5, units: 'J_per_m3', data_reference: 'mine' },
      C: { value: 'EMPTY_MUST_BE_FILLED', units: 'm3_per_J', data_reference: '' },
    })
    // An imported set is written as imported, whatever its instance holds.
    expect(JSON.parse(files['parameters/vp_parameters.json']).E.value).toBe(1)
    const { data: array } = Papa.parse(files['heart_module_array.csv'], { header: true, skipEmptyLines: true })
    expect(array.map((row) => row.parameterisation)).toEqual(['a', ''])
  })

  it("writes the set an instance made as its own config's default, naming it on the config, not the row", async () => {
    library.availableModules.get(BG_MODULE_REF).defaultParameterisation = 'a'
    const own = { ref: 'a', source: { file: '', importedAt: '', kind: 'instance', nodeId: 'a' }, globals: new Map(), values: new Map() }
    const node = nodeWith('a', [{ name: 'E', type: 'constant', value: '5', units: 'J_per_m3' }])
    node.data.parameterisation = 'a'

    const files = await readZip(await generateExportZip('heart', [node], [], library, null, { getParameterSet: (_, ref) => (ref === 'a' ? own : null) }))

    expect(JSON.parse(files['modules/heart_module_config.json'])[0].default_parameterisation).toBe('a')
    expect(files['heart_module_array.csv'].split('\n')[0]).not.toContain('parameterisation')
    expect(JSON.parse(files['parameters/a_parameters.json']).E.value).toBe(5)
  })

  it('writes no parameters folder without a parameter set lookup', async () => {
    library.availableModules.get(BG_MODULE_REF).defaultParameterisation = 'vp'
    const files = await readZip(await generateExportZip('heart', [nodeWith('vp', [])], [], library))
    expect(Object.keys(files).some((name) => name.startsWith('parameters/'))).toBe(false)
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

  it('refuses names the model parameters file reserves, for instances, parameters and global constants', async () => {
    const named = (name, variable) => nodeWith(name, [{ name: variable, type: 'constant', units: 'm3_per_J', value: '1' }])
    expect(findCaExportBlocker([named('global', 'C'), named('a', 'value'), named('b', 'C')], [], library)).toBe(
      'The CA parameters file reserves the names global, value, schema_version, so rename: global, a.value'
    )
    // A variable the file doesn't list may keep the name.
    expect(findCaExportBlocker([nodeWith('a', [{ name: 'value', type: 'variable', units: 'm3' }])], [], library)).toBeNull()
    library.assignGlobalConstant('schema_version', '1', 'dimensionless')
    await expect(generateExportZip('heart', [named('a', 'C')], [], library)).rejects.toThrow('rename: global.schema_version')
  })

  it('writes each boundary condition row, as CA needs one for every boundary condition', async () => {
    const node = nodeWith('out', [
      { name: 'u_out', type: 'boundary_condition', units: 'J_per_m3', value: '1000' },
      { name: 'q_out', type: 'boundary_condition', units: 'm3_per_s', value: 0 },
    ])
    const parameters = parametersOf(await readZip(await generateExportZip('heart', [node], [], library)))
    expect(parameters.out.u_out).toEqual({ value: 1000, units: 'J_per_m3', data_reference: 'phlynx' })
    expect(parameters.out.q_out.value).toBe(0)
    expect(notified.warning).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Missing Boundary Values' }))
  })

  it("marks a blank boundary condition for CA to ask for, and warns when nothing is connected to it", async () => {
    const node = nodeWith('out', [{ name: 'u_out', type: 'boundary_condition', units: 'J_per_m3', value: '' }])
    const parameters = parametersOf(await readZip(await generateExportZip('heart', [node], [], library)))
    expect(parameters.out.u_out.value).toBe('EMPTY_MUST_BE_FILLED')
    expect(notified.warning).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('out.u_out') }))
  })

  it('writes a constant or global constant of 0, which is not blank', async () => {
    library.assignGlobalConstant('g', 0, 'dimensionless')
    const node = nodeWith('out', [{ name: 'R', type: 'constant', units: 'Js_per_m6', value: 0 }])
    const parameters = parametersOf(await readZip(await generateExportZip('heart', [node], [], library)))
    expect(parameters.out.R.value).toBe(0)
    expect(parameters.global.g.value).toBe(0)
  })

  describe('the model parameters file', () => {
    const exportFiles = (nodes, options) => generateExportZip('heart', nodes, [], library, null, options).then(readZip)

    it('writes schema_version, the global constants, then each instance by variable, and no CSV', async () => {
      library.assignGlobalConstant('T', '1', 'second', 'Liang_2009_Table_2')
      library.assignGlobalConstant('g', '', 'dimensionless')
      const node = nodeWith('pvn', [
        { name: 'R', type: 'constant', units: 'Js_per_m6', value: '1333000', data_reference: 'Blanco_2013_Table_8' },
        { name: 'u_out', type: 'boundary_condition', units: 'J_per_m3', value: '5' },
        { name: 'q', type: 'state', units: 'm3', value: '1' },
        { name: 'v', type: 'variable', units: 'm3_per_s' },
      ])
      const files = await exportFiles([node])

      expect(files['heart_parameters.json']).toBe(
        [
          '{',
          ' "schema_version": 1,',
          ' "global": {',
          '  "T": {"value": 1, "units": "second", "data_reference": "Liang_2009_Table_2"},',
          '  "g": {"value": "EMPTY_MUST_BE_FILLED", "units": "dimensionless", "data_reference": "phlynx"}',
          ' },',
          ' "pvn": {',
          '  "R": {"value": 1333000, "units": "Js_per_m6", "data_reference": "Blanco_2013_Table_8"},',
          '  "u_out": {"value": 5, "units": "J_per_m3", "data_reference": "phlynx"}',
          ' }',
          '}',
          '',
        ].join('\n')
      )
      expect(Object.keys(files).filter((name) => name.endsWith('.csv'))).toEqual(['heart_module_array.csv'])
    })

    it('marks a blank constant or boundary condition to be filled', async () => {
      const node = nodeWith('a', [
        { name: 'C', type: 'constant', units: 'm3_per_J', value: '' },
        { name: 'E', type: 'constant', units: 'J_per_m3', value: '  ' },
        { name: 'u_out', type: 'boundary_condition', units: 'J_per_m3' },
      ])
      const { a } = parametersOf(await exportFiles([node]))
      expect(Object.values(a).map((param) => param.value)).toEqual(Array(3).fill('EMPTY_MUST_BE_FILLED'))
    })

    it('writes a number as its stored text, and any other text as a string', async () => {
      const node = nodeWith('a', [
        { name: 'C', type: 'constant', units: 'm3_per_J', value: '1e-07' },
        { name: 'E', type: 'constant', units: 'J_per_m3', value: '30250.0' },
        { name: 'k', type: 'constant', units: 'per_s', value: '-0.50' },
        { name: 'h', type: 'constant', units: 'per_s', value: '.5' },
        { name: 'n', type: 'constant', units: 'dimensionless', value: 'n/a' },
      ])
      const text = (await exportFiles([node]))['heart_parameters.json']
      expect(text).toContain('"C": {"value": 1e-07,')
      expect(text).toContain('"E": {"value": 30250.0,')
      expect(text).toContain('"k": {"value": -0.50,')
      // Not a JSON number, so written as libcuflynx writes it: as text.
      expect(text).toContain('"h": {"value": ".5",')
      expect(text).toContain('"n": {"value": "n/a",')
    })

    it('nests a sub-instance path under its instance', async () => {
      const nodes = [
        nodeWith('heart', [{ name: 'T', type: 'constant', units: 'second', value: '1' }]),
        nodeWith('heart/lv', [{ name: 'E_A', type: 'constant', units: 'J_per_m6', value: '366575000' }]),
        nodeWith('heart/rv', [{ name: 'E_A', type: 'constant', units: 'J_per_m6', value: '2' }]),
      ]
      const parameters = parametersOf(await exportFiles(nodes))
      expect(parameters.heart).toEqual({
        T: { value: 1, units: 'second', data_reference: 'phlynx' },
        lv: { E_A: { value: 366575000, units: 'J_per_m6', data_reference: 'phlynx' } },
        rv: { E_A: { value: 2, units: 'J_per_m6', data_reference: 'phlynx' } },
      })
    })

    it("keeps the extra keys of the set an instance uses while its value is still the set's", async () => {
      const param = (value, extra) => ({ value, units: 'J_per_m3', data_reference: 'paper', extra })
      const set = { ref: 'vp', globals: new Map(), values: new Map([['E', param('3', { sourced: 'no' })], ['C', param('4', { sourced: 'yes' })]]) }
      const node = nodeWith('a', [
        { name: 'E', type: 'constant', units: 'J_per_m3', value: '3', data_reference: 'paper' },
        { name: 'C', type: 'constant', units: 'J_per_m3', value: '5', data_reference: 'paper' },
      ])
      node.data.parameterisation = 'vp'
      const { a } = parametersOf(await exportFiles([node], { getParameterSet: () => set }))
      expect(a.E).toEqual({ value: 3, units: 'J_per_m3', data_reference: 'paper', sourced: 'no' })
      expect(a.C).toEqual({ value: 5, units: 'J_per_m3', data_reference: 'paper' })
    })
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
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['heart_module_array.csv', 'heart_parameters.json', 'heart_obs_data.json']))
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
    expect(parametersOf(files).b.u_out.value).toBe('EMPTY_MUST_BE_FILLED')
    expect(notified.warning).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Missing Boundary Values' }))
  })

  it('adds the module CA uses for the pulmonary circuit of a heart with one output, and warns', async () => {
    library.addModule({ moduleRef: 'heart:simple', mathRef: BG_MATH_REF, ports: [], variables: [] })
    const node = { id: 'h', data: { name: 'heart', moduleRef: 'heart:simple', mathRef: BG_MATH_REF, ports: [], variables: [] } }
    const files = await readZip(await generateExportZip('heart', [node], [], library))
    const entries = JSON.parse(files['modules/heart_module_config.json']).map((entry) => `${entry.module_type}:${entry.module_subtype}`)
    expect(entries).toEqual(['heart:simple', 'arterial_simple:vp'])
    expect(notified.warning).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('par, pvn') }))
  })

  describe('instances edited apart from their module', () => {
    const port = (label) => ({ label, portType: 'general_ports', variables: ['u'], multiportType: 'None' })
    const C = (units, type = 'constant') => ({ name: 'C', type, units, value: '1' })

    /**
     * Exports nodes, and reads back the config subtypes and each instance's module array subtype.
     *
     * @param {Array} nodes
     * @param {Array} [edges]
     * @returns {Promise<{files: Object, config: Array, subtypes: Object}>}
     */
    async function exportNodes(nodes, edges = []) {
      const files = await readZip(await generateExportZip('heart', nodes, edges, library))
      const config = JSON.parse(files['modules/heart_module_config.json'])
      const { data } = Papa.parse(files['heart_module_array.csv'], { header: true, skipEmptyLines: true })
      return { files, config, subtypes: Object.fromEntries(data.map((row) => [row.name, row.module_subtype])) }
    }

    it('gives an instance with its own ports a config of its own, named in its module array row, and warns', async () => {
      const b = nodeWith('B', [])
      b.data.ports = [port('p')]
      const { config, subtypes } = await exportNodes([nodeWith('A', []), b])
      expect(config.map((entry) => entry.module_subtype)).toEqual(['vp', 'vp_B'])
      expect(config[1].general_ports).toEqual([{ port_type: 'p', variables: ['u'] }])
      expect(config[0].general_ports).toEqual([])
      expect(subtypes).toEqual({ A: 'vp', B: 'vp_B' })
      expect(notified.warning).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining(': B (vp_B).') }))
    })

    it("keeps an instance's own units in its config, matching its parameter row", async () => {
      const { files, config, subtypes } = await exportNodes([nodeWith('A', [C('m3_per_J')]), nodeWith('B', [C('m3_per_s')])])
      expect(subtypes.B).toBe('vp_B')
      expect(config.find((entry) => entry.module_subtype === 'vp_B').variables_and_units).toEqual([['C', 'm3_per_s', null, 'constant']])
      expect(parametersOf(files).B.C.units).toBe('m3_per_s')
    })

    it("keeps an instance's own variable types in its config", async () => {
      const { files, config } = await exportNodes([nodeWith('A', [C('m3_per_J')]), nodeWith('B', [C('m3_per_J', 'global_constant')])])
      expect(config.map((entry) => entry.variables_and_units[0][3])).toEqual(['constant', 'global_constant'])
      expect(parametersOf(files).B).toBeUndefined()
    })

    it('gives an instance saved to other math a config naming that math', async () => {
      library.addMath('BG_modules.cellml:rate_type', RATE_MATH)
      const b = nodeWith('B', [])
      b.data.mathRef = 'BG_modules.cellml:rate_type'
      const { config } = await exportNodes([nodeWith('A', []), b])
      expect(config.map((entry) => [entry.module_subtype, entry.component_type])).toEqual([['vp', 'vp_simple_type'], ['vp_B', 'rate_type']])
    })

    it('shares one config among instances with the same edits', async () => {
      const edited = (name) => ({ ...nodeWith(name, []), data: { ...nodeWith(name, []).data, ports: [port('p')] } })
      const { config, subtypes } = await exportNodes([nodeWith('A', []), edited('B'), edited('C')])
      expect(config.map((entry) => entry.module_subtype)).toEqual(['vp', 'vp_B'])
      expect(subtypes).toEqual({ A: 'vp', B: 'vp_B', C: 'vp_B' })
      expect(notified.warning).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('gives them their own module configs: B (vp_B), C (vp_B).') })
      )
    })

    /**
     * Drops an instance of the library's module as the editor does, its rows filled out from its math.
     *
     * @param {string} name
     * @param {string} [moduleRef]
     * @returns {Object}
     */
    function dropped(name, moduleRef = BG_MODULE_REF) {
      const module = library.availableModules.get(moduleRef)
      const node = buildInstance(name, name, 'moduleNode', module, [], null, library.getMathAnalysis(module.mathRef), library.getMathDefaults(module.mathRef))
      return { ...node, data: { ...node.data, variables: [...node.data.variables].reverse() } }
    }

    it("keeps the module's subtype for untouched instances, whose rows their math fills out in any order", async () => {
      library.addModule({ moduleRef: BG_MODULE_REF, mathRef: BG_MATH_REF, ports: [], variables: [{ name: 'C', units: 'm3_per_J', access: null, type: 'constant' }] })
      library.addModule({ moduleRef: 'heart:simple', mathRef: BG_MATH_REF, ports: [], variables: [] })
      const heart = dropped('heart', 'heart:simple')
      const edges = [{ source: 'heart', target: 'A' }, { source: 'A', target: 'B' }, { source: 'B', target: 'heart' }]
      const { config, subtypes } = await exportNodes([heart, dropped('A'), dropped('B')], edges)
      expect(config.map((entry) => `${entry.module_type}:${entry.module_subtype}`)).toEqual(['heart:simple', 'arterial_simple:vp'])
      expect(subtypes).toEqual({ heart: 'simple', A: 'vp', B: 'vp' })
      expect(notified.warning).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Instances Exported Separately' }))
    })

    it('splits off an edited first instance, not the untouched one after it', async () => {
      const a = dropped('A')
      a.data.ports = [port('p')]
      const { config, subtypes } = await exportNodes([a, dropped('B')])
      expect(subtypes).toEqual({ A: 'vp_A', B: 'vp' })
      expect(config.find((entry) => entry.module_subtype === 'vp_A').general_ports).toEqual([{ port_type: 'p', variables: ['u'] }])
      expect(notified.warning).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining(': A (vp_A).') }))
    })

    it("keeps the module's subtype for the instances matching the library, wherever they come", async () => {
      const { subtypes } = await exportNodes([nodeWith('A', [C('m3_per_J')]), nodeWith('B', [])])
      expect(subtypes).toEqual({ A: 'vp_A', B: 'vp' })
    })

    it("keeps the module's subtype off a config no untouched instance would have, so an import keeps its edits", async () => {
      const { config, subtypes } = await exportNodes([nodeWith('A', [C('m3_per_J')]), nodeWith('B', [C('m3_per_J')])])
      expect(config.map((entry) => entry.module_subtype)).toEqual(['vp_A'])
      expect(subtypes).toEqual({ A: 'vp_A', B: 'vp_A' })
    })

    it("names a split config clear of the library's subtypes", async () => {
      library.addModule({ moduleRef: 'arterial_simple:vp_B', mathRef: BG_MATH_REF, ports: [], variables: [] })
      const { subtypes } = await exportNodes([nodeWith('A', []), nodeWith('B', [C('m3_per_J')])])
      expect(subtypes.B).toBe('vp_B_2')
    })

    describe("with the module's default parameter set", () => {
      const sets = { vp: { ref: 'vp', globals: new Map(), values: new Map() }, vp_fast: { ref: 'vp_fast', globals: new Map(), values: new Map() } }
      const getParameterSet = (mathRef, ref) => sets[ref] ?? null
      const rowsOf = (files) => Papa.parse(files['heart_module_array.csv'], { header: true, skipEmptyLines: true }).data

      beforeEach(() => {
        library.availableModules.get(BG_MODULE_REF).defaultParameterisation = 'vp'
      })

      it('gives a split config the default set too, naming only a set other than it on the rows', async () => {
        const b = nodeWith('B', [])
        b.data.ports = [port('p')]
        const c = { ...b, id: 'C', data: { ...b.data, name: 'C', parameterisation: 'vp_fast' } }
        const nodes = [nodeWith('A', []), { ...b, data: { ...b.data, parameterisation: 'vp' } }, c]
        const files = await readZip(await generateExportZip('heart', nodes, [], library, null, { getParameterSet }))
        const config = JSON.parse(files['modules/heart_module_config.json'])
        expect(config.map((entry) => [entry.module_subtype, entry.default_parameterisation])).toEqual([['vp', 'vp'], ['vp_B', 'vp']])
        expect(rowsOf(files).map((row) => [row.name, row.module_subtype, row.parameterisation])).toEqual([
          ['A', 'vp', ''],
          ['B', 'vp_B', ''],
          ['C', 'vp_B', 'vp_fast'],
        ])
        expect(Object.keys(files).filter((name) => name.startsWith('parameters/')).sort()).toEqual([
          'parameters/vp_fast_parameters.json',
          'parameters/vp_parameters.json',
        ])
      })

      it('still keeps the subtype for untouched instances', async () => {
        const module = library.availableModules.get(BG_MODULE_REF)
        const node = buildInstance('A', 'A', 'moduleNode', module, [], null, library.getMathAnalysis(BG_MATH_REF), library.getMathDefaults(BG_MATH_REF))
        const { config, subtypes } = await exportNodes([node])
        expect(subtypes).toEqual({ A: 'vp' })
        expect(config[0]).toMatchObject({ module_subtype: 'vp', default_parameterisation: 'vp' })
      })

      it('writes the default set of a config saved from the instance editor as new', async () => {
        library.addModule({ ...library.availableModules.get(BG_MODULE_REF), moduleRef: 'arterial_simple:vp_own', ports: [port('p')] })
        const b = nodeWith('B', [])
        Object.assign(b.data, { moduleRef: 'arterial_simple:vp_own', ports: [port('p')] })
        const files = await readZip(await generateExportZip('heart', [b], [], library, null, { getParameterSet }))
        const [entry] = JSON.parse(files['modules/heart_module_config.json'])
        expect(entry).toMatchObject({ module_subtype: 'vp_own', default_parameterisation: 'vp' })
        expect(files['parameters/vp_parameters.json']).toBeDefined()
      })
    })

    it("keeps the library's config for the pulmonary circuit, which CA builds from the module's subtype", async () => {
      library.addModule({ moduleRef: 'heart:simple', mathRef: BG_MATH_REF, ports: [], variables: [] })
      const heart = { id: 'h', data: { name: 'heart', moduleRef: 'heart:simple', mathRef: BG_MATH_REF, ports: [], variables: [] } }
      const { config, subtypes } = await exportNodes([heart, nodeWith('A', [C('m3_per_J')])])
      expect(config.map((entry) => `${entry.module_type}:${entry.module_subtype}`)).toEqual(['heart:simple', 'arterial_simple:vp_A', 'arterial_simple:vp'])
      expect(config[2].variables_and_units).toEqual([])
      expect(subtypes.A).toBe('vp_A')
    })
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
    expect(Object.keys(parametersOf(files))).toEqual(['schema_version', 'r0', 'r1'])
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
