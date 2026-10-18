// @vitest-environment happy-dom
import JSZip from 'jszip'
import Papa from 'papaparse'
import { createPinia, setActivePinia } from 'pinia'
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { ensureLibCellmlReady } from '../../helpers/libcellml-bootstrap.js'

const notified = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn(), warning: vi.fn() }))
vi.mock('../../../../src/utils/notify', () => ({ notify: notified }))
// While on, every 8-character variant name is the same, as two configs' hashes rarely are.
const collide = vi.hoisted(() => ({ on: false }))
vi.mock('../../../../src/services/caVariants', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    variantSubtype: (base, signature, length) =>
      collide.on && length === undefined ? `${base}__aaaaaaaa` : actual.variantSubtype(base, signature, length),
  }
})

const { CA_ARRAY_FORMATS, caExportProblems, dumpModuleRecords, generateExportZip } = await import('../../../../src/services/export/ca.js')
const { createExportReport, ExportBlockedError } = await import('../../../../src/services/export/diagnostics.js')
const { caModuleFileName } = await import('../../../../src/services/export/caCellml.js')
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

/**
 * Reads the exported module array's records, their inp/out lists joined by spaces as in the legacy CSV.
 *
 * @param {Object} files - Each file's text, by name (see readZip).
 * @returns {Array<Object>}
 */
function moduleArrayOf(files) {
  return JSON.parse(files['heart_module_array.json']).map((record) => ({
    ...record,
    inp_instances: record.inp_instances.join(' '),
    out_instances: record.out_instances.join(' '),
  }))
}

describe('caModuleFileName', () => {
  it('names a file so it ends in modules.cellml, as CA finds module files', () => {
    expect(caModuleFileName('BG_modules.cellml')).toBe('BG_modules.cellml')
    expect(caModuleFileName('User_Modules.cellml')).toBe('User_modules.cellml')
    expect(caModuleFileName('my_math.cellml')).toBe('my_math_modules.cellml')
    expect(caModuleFileName('template_modules.CellML')).toBe('template_modules.cellml')
  })
})

describe('dumpModuleRecords', () => {
  it("writes a record per line as CA's dump_vessel_records, with Python's separators and escapes", () => {
    const records = [
      { name: 'a', module_type: 'vessel', module_subtype: 'vp', inp_instances: [], out_instances: ['b', 'c'] },
      { name: 'b', module_type: 'vessel', module_subtype: 'vp', inp_instances: ['a'], out_instances: [], note: 'µ "q"' },
    ]
    expect(dumpModuleRecords(records)).toBe(
      '[\n' +
        ' {"name": "a", "module_type": "vessel", "module_subtype": "vp", "inp_instances": [], "out_instances": ["b", "c"]},\n' +
        ' {"name": "b", "module_type": "vessel", "module_subtype": "vp", "inp_instances": ["a"], "out_instances": [], "note": "\\u00b5 \\"q\\""}\n' +
        ']\n'
    )
    expect(dumpModuleRecords([])).toBe('[]\n')
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
    collide.on = false
    setActivePinia(createPinia())
    library = makeLibrary()
  })

  it('writes <prefix>_module_array.json by default, and only the legacy CSV when asked', async () => {
    const nodes = [nodeWith('a', []), nodeWith('b', [])]
    const edges = [{ id: 'e', source: 'a', target: 'b', data: {} }]
    const json = await readZip(await generateExportZip('heart', nodes, edges, library))
    const csv = await readZip(await generateExportZip('heart', nodes, edges, library, null, { arrayFormat: CA_ARRAY_FORMATS.CSV }))
    expect(json['heart_module_array.csv']).toBeUndefined()
    expect(csv['heart_module_array.json']).toBeUndefined()
    expect(JSON.parse(json['heart_module_array.json']).map((record) => Object.keys(record))).toEqual([
      ['name', 'module_type', 'module_subtype', 'inp_instances', 'out_instances'],
      ['name', 'module_type', 'module_subtype', 'inp_instances', 'out_instances'],
    ])
    expect(moduleArrayOf(json)).toEqual(Papa.parse(csv['heart_module_array.csv'], { header: true, skipEmptyLines: true }).data)
  })

  it("writes back the keys a library module's config had that PhLynx doesn't read, as they were", async () => {
    const extras = { description: 'A vessel', licence: 'CC0-1.0', creator: ['F. Argus'], required_citations: [{ doi: '10/x' }], phlynx_note: { a: 1 }, default_parameterisation: 'default' }
    library.availableModules.get(BG_MODULE_REF).configExtras = extras
    const [entry] = JSON.parse((await readZip(await generateExportZip('heart', [nodeWith('vp', [])], [], library)))['modules/heart_module_config.json'])
    expect(entry).toMatchObject({ module_type: 'arterial_simple', module_subtype: 'vp', ...extras })
  })

  it('makes public a constant its component sets inside, as CA sets it from the parameters file', async () => {
    library.addMath(BG_MATH_REF, VP_MATH.replace('<variable name="C" units="m3_per_J" interface="public"/>', '<variable name="C" units="m3_per_J"/>'))
    const node = nodeWith('vp', [{ name: 'C', units: 'm3_per_J', access: 'no_access', type: 'constant', value: '2' }])
    const files = await readZip(await generateExportZip('heart', [node], [], library))
    expect(files['modules/BG_modules.cellml']).toMatch(/<variable name="C" units="m3_per_J" interface="public"\/>/)
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
    expect(notified.warning).toHaveBeenCalledWith(expect.objectContaining({ items: [expect.stringContaining('out.u_out')] }))
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
    expect(notified.warning).toHaveBeenCalledWith(expect.objectContaining({ items: [expect.stringContaining('mystery')] }))
  })

  /**
   * Makes a heart fed by venous_svc, the least CA accepts.
   *
   * @returns {{ nodes: Array, edges: Array }}
   */
  function heartWithSvc() {
    library.addModule({ moduleRef: 'heart:simple', mathRef: BG_MATH_REF, ports: [], variables: [] })
    const heart = { id: 'h', data: { name: 'heart', moduleRef: 'heart:simple', mathRef: BG_MATH_REF, ports: [], variables: [] } }
    return { nodes: [heart, nodeWith('venous_svc', [])], edges: [{ id: 'svc', source: 'venous_svc', target: 'h', data: { couplings: [] } }] }
  }

  it('adds the zero_flow component CA uses with a heart', async () => {
    const { nodes, edges } = heartWithSvc()
    const files = await readZip(await generateExportZip('heart', nodes, edges, library))
    expect(files['modules/BG_modules.cellml']).toContain('<component name="zero_flow">')
  })

  it("keeps obs_data out of the modules folder, as CA reads every JSON file there as a module config", async () => {
    const obsData = '{"protocol_info": {}}'
    const files = await readZip(await generateExportZip('heart', [nodeWith('vp', [])], [], library, obsData))
    expect(Object.keys(files).filter((name) => name.startsWith('modules/') && name.endsWith('.json'))).toEqual([
      'modules/heart_module_config.json',
    ])
    expect(Object.keys(files)).toEqual(expect.arrayContaining(['heart_module_array.json', 'heart_parameters.csv', 'heart_obs_data.json']))
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
    const { nodes, edges } = heartWithSvc()
    const files = await readZip(await generateExportZip('heart', nodes, edges, library))
    const entries = JSON.parse(files['modules/heart_module_config.json']).map((entry) => `${entry.module_type}:${entry.module_subtype}`)
    expect(entries).toEqual(['heart:simple', 'arterial_simple:vp'])
    expect(notified.warning).toHaveBeenCalledWith(expect.objectContaining({ items: [expect.stringContaining('par, pvn')] }))
  })

  describe('multi_port', () => {
    const nodeWithPort = (port) => {
      const node = nodeWith('vp', [])
      node.data.ports = [{ portType: 'exit_ports', ...port }]
      return node
    }
    const exportedPort = async (port) =>
      JSON.parse((await readZip(await generateExportZip('heart', [nodeWithPort(port)], [], library)))['modules/heart_module_config.json'])[0]
        .exit_ports[0]

    it('writes a whole-port Sum on several variables per variable, as CA reads it', async () => {
      const port = await exportedPort({ label: 'vessel_port', variables: ['v_in', 'u'], multiportType: 'Sum' })
      expect(port.multi_port).toEqual(['sum', 'sum'])
    })

    it.each([
      ['a list', ['multiply', 'True']],
      ['a whole-port value', 'Multiply'],
    ])('fails on a Multiply on several variables, as %s, which CA cannot read', async (_, multiportType) => {
      const node = nodeWithPort({ label: 'vessel_port', variables: ['q_C', 'u'], multiportType })
      await expect(generateExportZip('heart', [node], [], library)).rejects.toThrow(
        `CA can't read a port. Module "arterial_simple:vp": port "vessel_port" multiplies variables ["q_C","u"]; CA multiplies only a port with one variable.`
      )
    })

    it("warns that CA sums a volume_port's whole-port Sum over its inp_vessels only", async () => {
      const port = await exportedPort({ label: 'volume_port', variables: ['q_C'], multiportType: 'Sum' })
      expect(port.multi_port).toBe('Sum')
      expect(notified.warning).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Volume Port Sum', items: [expect.stringContaining('arterial_simple:vp')] })
      )
    })

    it("writes a Multiply's factor as CA's multiply_factor", async () => {
      const port = await exportedPort({ label: 'flow_port', variables: ['v'], multiportType: 'Multiply', multiplyFactor: 2 })
      expect(port).toMatchObject({ multi_port: 'Multiply', multiply_factor: 2 })
    })

    it("doesn't warn about a volume_port's list sum, CA's sum over every connection", async () => {
      const port = await exportedPort({ label: 'volume_port', variables: ['q_C'], multiportType: ['sum'] })
      expect(port.multi_port).toEqual(['sum'])
      expect(notified.warning).not.toHaveBeenCalledWith(expect.objectContaining({ title: 'Volume Port Sum' }))
    })
  })

  describe('port slots', () => {
    const vesselPort = (portType, variable) => ({ label: 'vessel_port', portType, variables: [variable], multiportType: 'None' })
    const nodeWithPorts = (name, ports) => ({ ...nodeWith(name, []), data: { ...nodeWith(name, []).data, ports } })
    const conduit = (source, target, sourceSlot, targetSlot) => ({
      id: `${source.id}--${target.id}`,
      source: source.id,
      target: target.id,
      data: {
        couplings: [
          {
            sourcePort: source.data.ports.filter((p) => p.portType !== 'entrance_ports')[sourceSlot],
            targetPort: target.data.ports.filter((p) => p.portType === 'entrance_ports')[targetSlot],
            sourceSlot,
            targetSlot,
          },
        ],
      },
    })
    const rowsOf = async (nodes, edges) =>
      Object.fromEntries(
        moduleArrayOf(await readZip(await generateExportZip('heart', nodes, edges, library))).map((row) => [
          row.name,
          `${row.inp_instances} | ${row.out_instances}`,
        ])
      )
    const pairedDifferently = expect.objectContaining({ title: 'Connections Paired Differently' })

    const split = nodeWithPorts('s', [vesselPort('exit_ports', 'v_in'), vesselPort('exit_ports', 'u')])
    const vessel = (name) => nodeWithPorts(name, [vesselPort('entrance_ports', 'v_in')])
    const join = nodeWithPorts('j', [vesselPort('entrance_ports', 'v_in'), vesselPort('entrance_ports', 'u')])
    const feeder = (name) => nodeWithPorts(name, [vesselPort('exit_ports', 'v_in')])

    it("orders out_instances so CA's first free slot gives each connection its slot", async () => {
      const [b, c] = [vessel('b'), vessel('c')]
      const rows = await rowsOf([split, b, c], [conduit(split, b, 1, 0), conduit(split, c, 0, 0)])
      expect(rows.s).toBe(' | c b')
      expect(notified.warning).not.toHaveBeenCalledWith(pairedDifferently)
    })

    it("orders the rows so CA, connecting them in order, gives each connection its target's slot", async () => {
      const [x, y] = [feeder('x'), feeder('y')]
      const files = await readZip(await generateExportZip('heart', [join, x, y], [conduit(x, join, 0, 1), conduit(y, join, 0, 0)], library))
      expect(moduleArrayOf(files).map((row) => row.name)).toEqual(['j', 'y', 'x'])
      expect(moduleArrayOf(files)[0].inp_instances).toBe('y x')
      expect(notified.warning).not.toHaveBeenCalledWith(pairedDifferently)
    })

    it('keeps the workspace order where slots ask for none', async () => {
      const [b, c] = [vessel('b'), vessel('c')]
      const rows = await rowsOf([split, b, c], [conduit(split, b, 0, 0), conduit(split, c, 1, 0)])
      expect(rows).toEqual({ s: ' | b c', b: 's | ', c: 's | ' })
      expect(notified.warning).not.toHaveBeenCalledWith(pairedDifferently)
    })

    it('gives the slot a deleted connection freed a label of its own, in a variant of that instance, where no order skips it', async () => {
      const a = vessel('a')
      const files = await readZip(await generateExportZip('heart', [split, a], [conduit(split, a, 1, 0)], library))
      const rows = Object.fromEntries(moduleArrayOf(files).map((row) => [row.name, row.module_subtype]))
      const entry = JSON.parse(files['modules/heart_module_config.json']).find((config) => config.module_subtype === rows.s)
      expect(rows.s).toMatch(/^vp__[0-9a-z]{8}$/)
      expect(entry.phlynx_base_subtype).toBe('vp')
      expect(entry.exit_ports).toEqual([
        { port_type: 'vessel_port__1', variables: ['v_in'], phlynx_label: 'vessel_port' },
        { port_type: 'vessel_port', variables: ['u'] },
      ])
      expect(notified.warning).not.toHaveBeenCalledWith(pairedDifferently)
    })

    it('fails where CA would stop, naming the connection', async () => {
      const hub = nodeWithPorts('h', [{ label: 'link', portType: 'exit_ports', variables: ['a', 'b'], multiportType: 'True' }])
      const short = nodeWithPorts('y', [{ label: 'link', portType: 'entrance_ports', variables: ['c'], multiportType: 'None' }])
      const long = nodeWithPorts('z', [{ label: 'link', portType: 'entrance_ports', variables: ['d', 'e'], multiportType: 'None' }])
      const edge = (target) => ({
        id: `h--${target.id}`,
        source: 'h',
        target: target.id,
        data: { couplings: [{ sourcePort: hub.data.ports[0], targetPort: target.data.ports[0], sourceSlot: 0, targetSlot: 0 }] },
      })
      await expect(generateExportZip('heart', [hub, short, long], [edge(short), edge(long)], library)).rejects.toThrow(
        `CA would stop on a connection. "h"'s "link" port has more variables than "y"'s, which CA reads by the source's.`
      )
    })

    it('warns about couplings made before their ports changed, and leaves out edges coupling nothing CA would couple', async () => {
      const [a, b, c] = [vessel('a'), vessel('b'), vessel('c')]
      const stale = conduit(split, a, 0, 0)
      stale.data.couplings[0].sourcePort = { ...stale.data.couplings[0].sourcePort, multiportType: 'True' }
      const empty = { id: 's--b', source: 's', target: 'b', data: { couplings: [] } }
      const rows = await rowsOf([split, a, b, c], [stale, empty, conduit(split, c, 1, 0)])
      expect(rows.s).toBe(' | a c')
      expect(notified.warning).toHaveBeenCalledWith(expect.objectContaining({ title: 'Stale Connections', items: [expect.stringContaining('s → a')] }))
      expect(notified.info).toHaveBeenCalledWith(expect.objectContaining({ title: 'Connections Left Out', items: [expect.stringContaining('s → b')] }))
    })

    it("names CA's rule for each connection it pairs differently", async () => {
      const link = (portType, variable, multiportType = 'None') => ({ label: 'link', portType, variables: [variable], multiportType })
      const x = nodeWithPorts('x', [link('exit_ports', 'a')])
      const [y, z] = [nodeWithPorts('y', [link('general_ports', 'b')]), nodeWithPorts('z', [link('entrance_ports', 'c', 'True')])]
      const edge = (target) => ({
        id: `x--${target.id}`,
        source: 'x',
        target: target.id,
        data: { couplings: [{ sourcePort: x.data.ports[0], targetPort: target.data.ports[0], sourceSlot: 0, targetSlot: 0 }] },
      })
      await generateExportZip('heart', [x, y, z], [edge(y), edge(z)], library)
      expect(notified.warning).toHaveBeenCalledWith({
        title: 'Connections Paired Differently',
        items: ['CA will pair a connection differently from here. x → z (link): CA pairs every slot that shares a label across a connection.'],
      })
    })

    it('reads the slots of couplings saved before slots were recorded from their ports', async () => {
      const [b, c] = [vessel('b'), vessel('c')]
      const edges = [conduit(split, b, 1, 0), conduit(split, c, 0, 0)].map((edge) => ({
        ...edge,
        data: { couplings: edge.data.couplings.map(({ sourcePort, targetPort }) => ({ sourcePort: { ...sourcePort }, targetPort })) },
      }))
      expect((await rowsOf([split, b, c], edges)).s).toBe(' | c b')
      expect(notified.warning).not.toHaveBeenCalledWith(pairedDifferently)
    })
  })

  describe('heart', () => {
    const vesselPort = (portType, variables) => ({ label: 'vessel_port', portType, variables, multiportType: 'None' })
    const HEART_PORTS = [
      vesselPort('entrance_ports', ['v_ivc', 'u_ra']),
      vesselPort('entrance_ports', ['v_svc', 'u_ra']),
      vesselPort('entrance_ports', ['v_pvn', 'u_la']),
      vesselPort('exit_ports', ['v_aov', 'u_root']),
      vesselPort('exit_ports', ['v_puv', 'u_par']),
    ]
    const OUT_PORT = vesselPort('exit_ports', ['v', 'u_out'])
    const IN_PORT = vesselPort('entrance_ports', ['v_in', 'u'])
    const pairedDifferently = expect.objectContaining({ title: 'Connections Paired Differently' })

    /**
     * Makes a heart and the vessels around it, each input on the heart slot given, with the two outputs CA needs to
     * add no pulmonary circuit.
     *
     * @param {Object<string, number>} inputs - Each input's name to its heart slot, in workspace order.
     * @param {string} [name] - The heart's name.
     * @returns {{ nodes: Array, edges: Array }}
     */
    function heartWith(inputs, name = 'heart') {
      library.addModule({ moduleRef: 'heart:vp', mathRef: BG_MATH_REF, ports: HEART_PORTS, variables: [] })
      const heart = { id: name, data: { name, moduleRef: 'heart:vp', mathRef: BG_MATH_REF, ports: HEART_PORTS, variables: [] } }
      const vessel = (vesselName, ports) => ({ ...nodeWith(vesselName, []), data: { ...nodeWith(vesselName, []).data, ports } })
      const nodes = [heart]
      const edges = []
      for (const [input, slot] of Object.entries(inputs)) {
        nodes.push(vessel(input, [OUT_PORT]))
        edges.push({
          id: `${input}--${name}`,
          source: input,
          target: name,
          data: { couplings: [{ sourcePort: OUT_PORT, targetPort: HEART_PORTS[slot], sourceSlot: 0, targetSlot: slot }] },
        })
      }
      ;['aorta', 'par'].forEach((output, slot) => {
        nodes.push(vessel(output, [IN_PORT]))
        edges.push({
          id: `${name}--${output}`,
          source: name,
          target: output,
          data: { couplings: [{ sourcePort: HEART_PORTS[3 + slot], targetPort: IN_PORT, sourceSlot: slot, targetSlot: 0 }] },
        })
      })
      return { nodes, edges }
    }
    const heartRow = async ({ nodes, edges }) =>
      moduleArrayOf(await readZip(await generateExportZip('heart', nodes, edges, library))).find((row) => row.name === 'heart')

    it('orders the inputs ivc, svc, pulmonary by their slots, as CA reads them', async () => {
      const row = await heartRow(heartWith({ pvn: 2, venous_svc: 1, venous_ivc: 0 }))
      expect(row.inp_instances).toBe('venous_ivc venous_svc pvn')
      expect(notified.warning).not.toHaveBeenCalledWith(pairedDifferently)
    })

    it('writes two inputs on the svc and pulmonary slots as CA expects them, svc first', async () => {
      const row = await heartRow(heartWith({ pvn: 2, venous_svc: 1 }))
      expect(row.inp_instances).toBe('venous_svc pvn')
      expect(notified.warning).not.toHaveBeenCalledWith(pairedDifferently)
    })

    it('warns about two inputs CA would put on other slots', async () => {
      await heartRow(heartWith({ venous_ivc: 0, pvn: 2 }))
      expect(notified.warning).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Connections Paired Differently', items: [expect.stringContaining("a heart's inputs")] })
      )
    })

    it('fails on more than one heart, as CA does', async () => {
      const first = heartWith({ venous_ivc: 0 })
      const second = heartWith({}, 'heart2')
      const nodes = [...first.nodes, ...second.nodes.filter((node) => !first.nodes.some((other) => other.id === node.id))]
      await expect(generateExportZip('heart', nodes, [...first.edges, ...second.edges], library)).rejects.toThrow(
        'CA allows one heart module, but heart, heart2 are hearts.'
      )
      // The caller shows the failure: the service shows nothing, not even the notes gathered before it stopped.
      expect(notified.error).not.toHaveBeenCalled()
      expect(notified.warning).not.toHaveBeenCalled()
      expect(notified.info).not.toHaveBeenCalled()
    })

    it('fails on a heart with no venous_ivc or venous_svc input, as CA does', async () => {
      const { nodes, edges } = heartWith({ vena_cava: 0, pvn: 2 })
      await expect(generateExportZip('heart', nodes, edges, library)).rejects.toThrow(
        'CA needs venous_ivc, venous_svc or both, by those names, as inputs to the heart "heart".'
      )
    })
  })

  it('warns that Min_/Nout_ junction types are deprecated', async () => {
    library.addModule({ moduleRef: 'Min_junction:vp', mathRef: BG_MATH_REF, ports: [], variables: [] })
    const junction = { id: 'j', data: { name: 'j', moduleRef: 'Min_junction:vp', mathRef: BG_MATH_REF, ports: [], variables: [] } }
    await generateExportZip('heart', [junction, nodeWith('vp', [])], [], library)
    expect(notified.warning).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Deprecated Junction Types', items: [expect.stringMatching(/^Min_junction is .*multiport Sum/)] })
    )
  })

  describe('parameter names', () => {
    const constant = (name, value) => ({ name, units: 'm3_per_J', access: 'no_access', type: 'constant', value })

    it('fails where two modules give one CA name different values, naming both', async () => {
      const nodes = [nodeWith('lv', [constant('E_a', '1')]), nodeWith('a_lv', [constant('E', '2')])]
      const error = await generateExportZip('heart', nodes, [], library).catch((thrown) => thrown)
      expect(error).toBeInstanceOf(ExportBlockedError)
      expect(error.errors).toEqual([expect.stringContaining('"E_a_lv" ("lv", "a_lv")')])
      expect(caExportProblems(nodes, [], library)).toEqual(error.errors)
    })

    it('writes a name two modules give the same value once', async () => {
      const nodes = [nodeWith('lv', [constant('E_a', '1')]), nodeWith('a_lv', [constant('E', '1')])]
      const files = await readZip(await generateExportZip('heart', nodes, [], library))
      expect(Papa.parse(files['heart_parameters.csv'], { header: true, skipEmptyLines: true }).data.filter((row) => row.variable_name === 'E_a_lv')).toHaveLength(1)
    })
  })

  describe('diagnostics', () => {
    it('stops on a problem before gathering any note', async () => {
      library.addModule({ moduleRef: 'Min_junction:vp', mathRef: BG_MATH_REF, ports: [], variables: [] })
      const junction = { id: 'j', data: { name: 'j', moduleRef: 'Min_junction:vp', mathRef: BG_MATH_REF, ports: [], variables: [] } }
      const nodes = [junction, nodeWith('lv', [{ name: 'E_a', units: 'm3_per_J', type: 'constant', value: '1' }]), nodeWith('a_lv', [{ name: 'E', units: 'm3_per_J', type: 'constant', value: '2' }])]
      const report = createExportReport()
      await expect(generateExportZip('heart', nodes, [], library, null, { report })).rejects.toBeInstanceOf(ExportBlockedError)
      expect(report.errors).toHaveLength(1)
      expect(report.warnings).toEqual([])
      expect(notified.warning).not.toHaveBeenCalled()
    })

    it('gathers the notes in the report given rather than showing them', async () => {
      library.addModule({ moduleRef: 'Min_junction:vp', mathRef: BG_MATH_REF, ports: [], variables: [] })
      const junction = { id: 'j', data: { name: 'j', moduleRef: 'Min_junction:vp', mathRef: BG_MATH_REF, ports: [], variables: [] } }
      const report = createExportReport()
      await generateExportZip('heart', [junction, nodeWith('vp', [])], [], library, null, { report })
      expect(report.warnings.map((note) => note.title)).toContain('Deprecated Junction Types')
      expect(notified.warning).not.toHaveBeenCalled()
    })
  })

  it('fails when a component has no math in the library', async () => {
    library.addModule({ moduleRef: 'stub:default', mathRef: 'gone.cellml:stub_type', ports: [], variables: [] })
    const node = { id: 's', data: { name: 's', moduleRef: 'stub:default', mathRef: 'gone.cellml:stub_type', ports: [], variables: [] } }
    await expect(generateExportZip('heart', [node], [], library)).rejects.toThrow('gone.cellml:stub_type')
  })

  it('fails when two files hold components of one name, as CA finds components by name', async () => {
    library.addMath('other_modules.cellml:vp_simple_type', VP_MATH)
    library.addModule({ moduleRef: 'other:vp', mathRef: 'other_modules.cellml:vp_simple_type', ports: [], variables: [] })
    const other = { id: 'o', data: { name: 'o', moduleRef: 'other:vp', mathRef: 'other_modules.cellml:vp_simple_type', ports: [], variables: [] } }
    await expect(generateExportZip('heart', [nodeWith('vp', []), other], [], library)).rejects.toThrow(
      'CA finds components by name, but "vp_simple_type" is in BG_modules.cellml (vp) and other_modules.cellml (o).'
    )
  })

  it("names the instances whose own math shares a component's name with another file's", async () => {
    library.addMath('other_modules.cellml:vp_simple_type', VP_MATH)
    const moved = { ...nodeWith('b', []), data: { ...nodeWith('b', []).data, mathRef: 'other_modules.cellml:vp_simple_type' } }
    await expect(generateExportZip('heart', [nodeWith('a', []), moved], [], library)).rejects.toThrow(
      '"vp_simple_type" is in BG_modules.cellml (a) and other_modules.cellml (b)'
    )
  })

  it('gives a variant whose name another config already has the longer hash', async () => {
    collide.on = true
    const row = (units) => ({ name: 'C', type: 'constant', units, value: '1' })
    const files = await readZip(await generateExportZip('heart', [nodeWith('a', [row('m3_per_J')]), nodeWith('b', [row('J_per_m3')])], [], library))
    const subtypes = Object.fromEntries(moduleArrayOf(files).map((r) => [r.name, r.module_subtype]))
    expect(subtypes.a).toBe('vp__aaaaaaaa')
    expect(subtypes.b).toMatch(/^vp__[0-9a-z]{11}$/)
    const refs = JSON.parse(files['modules/heart_module_config.json']).map((entry) => entry.module_subtype)
    expect(refs).toEqual(expect.arrayContaining([subtypes.a, subtypes.b]))
  })

  it("writes the library's own entry for a module only variants use, which no row names", async () => {
    const row = { name: 'C', type: 'constant', units: 'm3_per_J', value: '1' }
    const files = await readZip(await generateExportZip('heart', [nodeWith('a', [row])], [], library))
    const entries = JSON.parse(files['modules/heart_module_config.json'])
    expect(entries.map((entry) => entry.module_subtype)).toEqual([moduleArrayOf(files)[0].module_subtype, 'vp'])
    expect(entries[1]).toMatchObject({ module_type: 'arterial_simple', variables_and_units: [] })
    expect(entries[1].phlynx_base_subtype).toBeUndefined()
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
