import JSZip from 'jszip'
import { describe, expect, it } from 'vitest'
import { readProtocolInfo, validateProtocolInfo } from '@physiomelinks/protocol-kit'

import {
  BUNDLE_FILES,
  BUNDLE_REQUIREMENTS,
  buildBundleReadme,
  buildFeaturePlots,
  buildParameterNames,
  buildScriptHeader,
  buildSolverInfo,
  fillScriptTemplate,
  generateProtocolZip,
  isFeatureItem,
  nameItemGroup,
  readPredictionItems,
  validateFeaturePlots,
} from '../../../../src/services/export/protocolExport.js'
import template from '../../../../src/services/export/templates/run_protocol.py?raw'

// The SN neuron as PhLynx flattens it: g_M kept in instance_parameters, named after its instance.
const NODES = [{ id: 'n1', data: { name: 'soma_SN' } }]
const MAPPING = new Map([
  ['n1::g_M', 'instance_parameters/soma_SN_g_M'],
  ['n1::V', 'soma_SN/V'],
])
const VARIABLES = new Set(['soma_SN/V', 'soma_SN/g_M', 'instance_parameters/soma_SN_g_M', 'instance_parameters/I_in', 'parameters/g_Na'])

// An I–V protocol: a holding step, then a clamp at -40 or 0 mV, recording the current's peak and the clamp's voltage.
const IV = {
  protocol_info: {
    pre_times: [0, 0],
    sim_times: [
      [1, 1],
      [1, 1, 1],
    ],
    params_to_change: {
      'membrane/V_clamp': [
        [-80, -40],
        [-80, 0, 'ramp'],
      ],
      'membrane/g': [
        [1, 1],
        [1, 2, 2],
      ],
    },
    protocol_shapes: { ramp: { type: 'ramp', from: 0, to: 1 } },
  },
  prediction_items: [
    { data_item_name: 'V', operands: ['membrane/V'], unit: 'mV', experiment_idx: 0 },
    { data_item_name: 'I_peak_e0', operands: ['i_Na/i_Na'], unit: 'uA', item_name_for_plotting: 'I_peak', operation: 'min', experiment_idx: 0, subexperiment_idx: 1 },
    { data_item_name: 'I_peak_e1', operands: ['i_Na/i_Na'], unit: 'uA', item_name_for_plotting: 'I_peak', operation: 'min', experiment_idx: 1, subexperiment_idx: 1 },
    { data_item_name: 'V_step_e1', operands: ['membrane/V'], unit: 'mV', item_name_for_plotting: 'V_step', operation: 'mean', experiment_idx: 1 },
    { data_item_name: 'none', operands: ['membrane/V'], unit: 'mV', operation: 'None', experiment_idx: 1 },
  ],
}
const VIEW = readProtocolInfo(validateProtocolInfo(IV.protocol_info).protocolInfo)

describe('readPredictionItems', () => {
  it("groups the features by name, with the experiments they're recorded in, and says when they need CA #536", () => {
    const { items, featureGroups, needsFeatureRelease } = readPredictionItems(IV)
    expect(items).toHaveLength(5)
    expect(featureGroups).toEqual([
      { name: 'I_peak', experiments: [0, 1] },
      { name: 'V_step', experiments: [1] },
    ])
    expect(needsFeatureRelease).toBe(true)
    expect(isFeatureItem({ operation: ' none' })).toBe(false)
  })

  it('reads a file without prediction items, or a trace of one sub-experiment, as CA does', () => {
    expect(readPredictionItems({ protocol_info: IV.protocol_info })).toEqual({ items: [], featureGroups: [], needsFeatureRelease: false })
    expect(readPredictionItems(undefined).items).toEqual([])
    expect(readPredictionItems([{ data_item_name: 'old' }]).items).toEqual([])
    const traced = readPredictionItems({ prediction_items: [{ data_item_name: 'V', operands: ['membrane/V'], subexperiment_idx: 0 }] })
    expect(traced.needsFeatureRelease).toBe(true)
    // Named as CA defaults it: by trace_name_for_plotting, else the first operand.
    expect(readPredictionItems({ prediction_items: [{ data_item_name: 'p', operands: ['a/b'], operation: 'max' }] }).featureGroups).toEqual([
      { name: 'a/b', experiments: [0] },
    ])
  })

  it('names the groups of items with legacy keys as CA does', () => {
    expect(nameItemGroup({ variable: 'membrane/V', unit: 'mV', operation: 'max' })).toBe('membrane/V')
    expect(nameItemGroup({ data_item_name: 'V_pk', name_for_plotting: 'Vpk', operands: ['membrane/V'], operation: 'max' })).toBe('Vpk')
    expect(nameItemGroup({ data_item_name: 'V_pk', operands: [], operation: 'max' })).toBe('V_pk')
    expect(nameItemGroup({ data_item_name: 'V_pk', operands: [''], operation: 'max' })).toBe('V_pk')
  })
})

describe('buildParameterNames', () => {
  it("names each parameter PhLynx finds under another name than CA would, and lists those it can't find", () => {
    const { names, unresolved } = buildParameterNames({
      parameters: ['soma_SN/g_M', 'soma_SN/V', 'soma_SN/I_in', 'soma_SN/g_Na', 'engine/pace'],
      nodes: NODES,
      mapping: MAPPING,
      variables: VARIABLES,
    })
    // g_M: CA finds the instance's own copy, which Myokit merges away. I_in: CA doesn't know instance_parameters.
    // V and g_Na: CA finds them where PhLynx does.
    expect(names).toEqual({ 'soma_SN/g_M': 'instance_parameters/soma_SN_g_M', 'soma_SN/I_in': 'instance_parameters/I_in' })
    expect(unresolved).toEqual(['engine/pace'])
  })
})

describe('buildSolverInfo', () => {
  it("gives CVODE's largest step and tolerances, as libcuflynx names them", () => {
    expect(buildSolverInfo({ solver: 'CVODE', tolerance: 1e-8, timeStep: 0.01, maxSteps: 500 })).toEqual({ MaximumStep: 0.01, rtol: 1e-8, atol: 1e-8 })
    expect(buildSolverInfo({ timeStep: 0 })).toEqual({ rtol: 1e-7, atol: 1e-7 })
    expect(buildSolverInfo({ solver: 'Euler', timeStep: 0.001 })).toEqual({ MaximumStep: 0.001 })
  })
})

describe('buildFeaturePlots', () => {
  it("writes the dialog's plots as the script reads them", () => {
    expect(
      buildFeaturePlots([
        { title: ' I–V ', y: 'I_peak', x: { kind: 'input', input: 'membrane/V_clamp', subexperiment: 1 }, series: { input: 'membrane/g', subexperiment: 1 } },
        { title: '', y: 'I_peak', x: { kind: 'feature', feature: 'V_step' }, series: null },
        { title: '', y: 'V_step', x: { kind: 'experiment' }, series: null },
      ])
    ).toEqual([
      { title: 'I–V', x: { input: 'membrane/V_clamp', subexperiment_idx: 1 }, y: 'I_peak', series: { input: 'membrane/g', subexperiment_idx: 1 } },
      { title: null, x: 'V_step', y: 'I_peak', series: null },
      { title: null, x: 'experiment', y: 'V_step', series: null },
    ])
  })
})

describe('validateFeaturePlots', () => {
  const { featureGroups } = readPredictionItems(IV)
  /** Checks some plots against the I–V protocol. */
  const validate = (featurePlots) => validateFeaturePlots({ view: VIEW, featureGroups, featurePlots })

  it('accepts features against features, inputs that are numbers where they are recorded, and the experiment', () => {
    expect(
      validate([
        { title: '', y: 'I_peak', x: { kind: 'input', input: 'membrane/V_clamp', subexperiment: 1 }, series: { input: 'membrane/g', subexperiment: 1 } },
        { title: '', y: 'I_peak', x: { kind: 'feature', feature: 'V_step' }, series: null },
        // Only experiment 2 records V_step, and its third sub-experiment ramps V_clamp in no other.
        { title: '', y: 'V_step', x: { kind: 'experiment' }, series: { input: 'membrane/g', subexperiment: 2 } },
      ])
    ).toEqual([])
  })

  it('says what is wrong with each, by its path', () => {
    expect(
      validate([
        { title: '', y: 'nope', x: { kind: 'feature', feature: null }, series: null },
        { title: '', y: 'I_peak', x: { kind: 'input', input: 'membrane/V_clamp', subexperiment: 2 }, series: { input: 'b/k', subexperiment: 0 } },
        { title: '', y: 'V_step', x: { kind: 'input', input: 'membrane/V_clamp', subexperiment: 2 }, series: { input: null, subexperiment: 0 } },
        { title: '', y: null, x: { kind: 'sideways' }, series: null },
      ])
    ).toEqual([
      { path: 'featurePlots[0].y', message: 'The protocol records no feature called nope.' },
      { path: 'featurePlots[0].x.feature', message: 'Choose a feature to plot against.' },
      { path: 'featurePlots[1].x.subexperiment', message: 'Experiment 1 has no sub-experiment 3.' },
      { path: 'featurePlots[1].series.input', message: "b/k isn't an input of the protocol." },
      { path: 'featurePlots[2].x', message: "membrane/V_clamp isn't one number in experiment 2, sub-experiment 3." },
      { path: 'featurePlots[2].series.input', message: 'Choose an input of the protocol.' },
      { path: 'featurePlots[3].y', message: 'Choose a feature to plot.' },
      { path: 'featurePlots[3].x.kind', message: 'Plot against a feature, an input or the experiment.' },
    ])
  })
})

describe('buildScriptHeader', () => {
  it('writes the settings, the renamed and unresolved parameters, and the feature plots', () => {
    const header = buildScriptHeader({
      obsData: "cell's_obs_data.json",
      dt: 0.05,
      timeUnit: 'ms',
      solverInfo: { MaximumStep: 0.01, rtol: 1e-7, atol: 1e-7 },
      parameterNames: { 'soma_SN/g_M': 'instance_parameters/soma_SN_g_M' },
      unresolved: ['engine/pace'],
      featurePlots: buildFeaturePlots([
        { title: 'I–V', y: 'I_peak', x: { kind: 'input', input: 'membrane/V_clamp', subexperiment: 1 }, series: null },
        { title: '', y: 'I_peak', x: { kind: 'experiment' }, series: { input: 'membrane/g', subexperiment: 0 } },
      ]),
    })
    expect(header).toBe(`MODEL = 'model.cellml'
OBS_DATA = "cell's_obs_data.json"
DT = 0.05  # the time between recorded points
TIME_UNIT = 'ms'  # the unit of time, as the model has it
SOLVER_INFO = {  # CVODE's settings, as libcuflynx names them
    'MaximumStep': 0.01,
    'rtol': 1e-07,
    'atol': 1e-07,
}
PARAMETER_NAMES = {  # protocol parameters libcuflynx can't find in MODEL -> the model's names for them, in outputs too
    'soma_SN/g_M': 'instance_parameters/soma_SN_g_M',
    # 'engine/pace': 'component/variable',  # PhLynx found no variable for it in MODEL
}
FEATURE_PLOTS = [  # features against another feature, a protocol input or the experiment
    {'title': 'I–V', 'x': {'input': 'membrane/V_clamp', 'subexperiment_idx': 1}, 'y': 'I_peak', 'series': None},
    {'title': None, 'x': 'experiment', 'y': 'I_peak', 'series': {'input': 'membrane/g', 'subexperiment_idx': 0}},
]
OPERATION_FUNCS_PATH = None  # a file of your own operation functions, for features that use them`)
  })

  it('writes what is empty on one line, as the template has it', () => {
    const header = buildScriptHeader({ obsData: 'obs_data.json', dt: 0.1, solverInfo: {}, parameterNames: {} })
    expect(header).toBe(`MODEL = 'model.cellml'
OBS_DATA = 'obs_data.json'
DT = 0.1  # the time between recorded points
TIME_UNIT = ''  # the unit of time, as the model has it
SOLVER_INFO = {}  # CVODE's settings, as libcuflynx names them
PARAMETER_NAMES = {}  # protocol parameters libcuflynx can't find in MODEL -> the model's names for them, in outputs too
FEATURE_PLOTS = []  # features against another feature, a protocol input or the experiment
OPERATION_FUNCS_PATH = None  # a file of your own operation functions, for features that use them`)
    // The template's own header, so it runs as it is.
    expect(template).toContain(header)
  })
})

describe('fillScriptTemplate', () => {
  it("writes the header between the template's markers, leaving the rest as it is", () => {
    const header = "MODEL = 'model.cellml'\nOBS_DATA = 'x.json'"
    const script = fillScriptTemplate(template, header)
    const [before, after] = template.split(/# ---- Written by PhLynx's export[^\n]*\n[\s\S]*?(?=# ---- End of what PhLynx wrote)/)
    expect(script.startsWith(before)).toBe(true)
    expect(script.endsWith(after)).toBe(true)
    expect(script).toContain(`# ---- Written by PhLynx's export`)
    expect(script).toContain(`\n${header}\n# ---- End of what PhLynx wrote`)
    expect(script).toContain('def your_plots(')
    expect(() => fillScriptTemplate('print(1)', header)).toThrow('run_protocol.py has lost')
  })
})

describe('buildBundleReadme', () => {
  it('says what the bundle holds, how to install and run it, what it writes, and its warnings', () => {
    const written = buildBundleReadme({ stem: 'heart', obsData: 'heart_obs_data.json', warnings: ['Experiment 1: a warning.'] })
    const readme = written.replaceAll(/\s+/g, ' ')
    expect(written.startsWith('# heart')).toBe(true)
    for (const text of Object.values(BUNDLE_FILES).filter((name) => name !== BUNDLE_FILES.readme)) expect(readme).toContain(text)
    for (const text of ['heart_obs_data.json', 'brew install sundials', 'conda-forge', 'C compiler', 'python run_protocol.py', '#536', '0.7.3']) {
      expect(readme).toContain(text)
    }
    for (const text of ['--out', '--format', '--show', 'traces.csv', 'features.csv', 'feature_plot_N', 'your_plots', 'PARAMETER_NAMES', 'FEATURE_PLOTS']) {
      expect(readme).toContain(text)
    }
    expect(readme).toContain('- Experiment 1: a warning.')
    expect(readme).toContain('Python 3.10 to 3.13')
    expect(readme).toContain("PhLynx's protocol editor, under Outputs")
    expect(readme).not.toContain('by hand or in CUFLynx')
  })

  it('says why the SED-ML is left out, when it is', () => {
    const readme = buildBundleReadme({ stem: 'heart', obsData: 'obs_data.json', sedmlProblem: 'The plan has 2001 segments.' })
    expect(readme).toContain('- None.')
    expect(readme).toContain("`protocol.sedml`, PhLynx's own run, is left out: The plan has 2001 segments.")
    expect(readme).not.toContain('protocol_model.cellml')
  })
})

describe('generateProtocolZip', () => {
  const obsData = { name: 'heart_obs_data.json', payload: new TextEncoder().encode('{"protocol_info": {"pre_times": [0]}}  \n').buffer }
  const parts = { script: 'print("run")\n', cellml: '<model/>', readme: '# heart\n', obsData }
  /** Reads a zip. */
  const open = async (blob) => JSZip.loadAsync(await blob.arrayBuffer())
  /** Reads a manifest's contents as `{location: [format, master]}`. */
  const readManifest = async (zip) =>
    Object.fromEntries(
      [...(await zip.file('manifest.xml').async('string')).matchAll(/<content location="([^"]+)" format="([^"]+)"( master="true")?/g)].map(([, location, format, master]) => [
        location,
        [format, !!master],
      ])
    )

  it('bundles the script, the plain model, the obs_data byte for byte under its own name, and the SED-ML with its model', async () => {
    const zip = await open(await generateProtocolZip({ ...parts, sedml: { sedml: '<sedML/>', cellml: '<model clocked/>' } }))
    expect(Object.keys(zip.files).sort()).toEqual(
      ['run_protocol.py', 'model.cellml', 'heart_obs_data.json', 'requirements.txt', 'README.md', 'manifest.xml', 'protocol.sedml', 'protocol_model.cellml'].sort()
    )
    expect(new Uint8Array(await zip.file('heart_obs_data.json').async('uint8array'))).toEqual(new Uint8Array(obsData.payload))
    expect(await zip.file('model.cellml').async('string')).toBe('<model/>')
    expect(await zip.file('protocol_model.cellml').async('string')).toBe('<model clocked/>')
    expect(await zip.file('requirements.txt').async('string')).toBe(BUNDLE_REQUIREMENTS)
    expect(await readManifest(zip)).toEqual({
      '.': ['http://identifiers.org/combine.specifications/omex', false],
      'run_protocol.py': ['text/x-python', false],
      'model.cellml': ['http://identifiers.org/combine.specifications/cellml', false],
      'heart_obs_data.json': ['application/json', false],
      'requirements.txt': ['text/plain', false],
      'README.md': ['text/markdown', false],
      'protocol.sedml': ['http://identifiers.org/combine.specifications/sed-ml', true],
      'protocol_model.cellml': ['http://identifiers.org/combine.specifications/cellml', false],
    })
  })

  it('leaves the SED-ML out when there is none, the model then the master', async () => {
    const zip = await open(await generateProtocolZip(parts))
    expect(Object.keys(zip.files)).not.toContain('protocol.sedml')
    expect(Object.keys(zip.files)).not.toContain('protocol_model.cellml')
    expect((await readManifest(zip))['model.cellml']).toEqual(['http://identifiers.org/combine.specifications/cellml', true])
  })

  it('pins libcuflynx to the commit of CA #536 the script was checked with', () => {
    expect(BUNDLE_REQUIREMENTS.split('\n').filter((line) => line && !line.startsWith('#'))).toEqual([
      'libcuflynx @ git+https://github.com/physiomelinks/circulatory_autogen@7e9fdb5518861d56a359d9f4328ff8d759c17af2',
      'matplotlib>=3.8',
      'seaborn>=0.13',
    ])
  })
})
