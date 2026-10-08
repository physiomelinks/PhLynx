/**
 * Writes a protocol SED-ML bundle for each parity case (tests/resources/protocols/parity/cases.json), with PhLynx's
 * own builder, for tests/python/test_protocol_sedml.py to run with run_sedml.py and compare against CA's references.
 * Each bundle is a directory named as its case is: model.cellml (the case's model, with its drivers and the
 * protocol's clock), protocol.sedml, README.md, run_sedml.py when it exists, and expected.json naming its case
 * (`{"case": name}`, the form the Python test reads). Run with plain Node from the repository's root:
 *
 *     node scripts/protocol-export/write_parity_bundles.mjs OUTPUT_DIR
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { registerHooks } from 'node:module'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const PARITY = path.join(ROOT, 'tests', 'resources', 'protocols', 'parity')
const SCRIPT = path.join(ROOT, 'src', 'services', 'export', 'templates', 'run_sedml.py')

// PhLynx's sources import each other without extensions, as Vite resolves them: try `.js`, then `/index.js`. A
// `?raw` import is the file's text, as Vite gives it.
registerHooks({
  load(url, context, nextLoad) {
    if (!url.endsWith('?raw')) return nextLoad(url, context)
    const text = readFileSync(fileURLToPath(url.slice(0, -'?raw'.length)), 'utf8')
    return { format: 'module', source: `export default ${JSON.stringify(text)}`, shortCircuit: true }
  },
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context)
    } catch (error) {
      if (!specifier.startsWith('.') || !['ERR_MODULE_NOT_FOUND', 'ERR_UNSUPPORTED_DIR_IMPORT'].includes(error.code)) throw error
      for (const suffix of ['.js', '/index.js']) {
        try {
          return nextResolve(`${specifier}${suffix}`, context)
        } catch {
          // Try the next.
        }
      }
      throw error
    }
  },
})

/** Imports a module of PhLynx's sources. */
const load = (relative) => import(pathToFileURL(path.join(ROOT, 'src', relative)).href)

const { default: createLibCellML } = await import('libcellml.js')
const { buildBundleReadme, buildProtocolSedml, BUNDLE_FILES } = await load('services/export/protocolSedml.js')
const { planDrivers } = await load('services/protocol/libopencorEngine/protocolDrivers.js')
const { nameExperiment, readProtocolInfo } = await load('services/protocol/protocolModel.js')
const { validateProtocolInfo } = await load('services/protocol/protocolValidation.js')
const { addProtocolClock, addProtocolDrivers } = await load('services/simulation/protocolDriverModel.js')
const { prepareProtocolRun } = await load('services/simulation/protocolRun.js')

// libOpenCOR's kinds of variable, from the libcellml Analyser's.
const KINDS = { state: 'state', constant: 'constant', variable_of_integration: 'voi' }

/**
 * Lists a model's variables as libOpenCOR reports them, each `component/variable` with its kind and units.
 *
 * @param {Object} libcellml
 * @param {string} cellml
 * @returns {Map<string, {kind: string, unit: string}>}
 */
function describeVariables(libcellml, cellml) {
  const parser = new libcellml.Parser(false)
  const model = parser.parseModel(cellml)
  const analyser = new libcellml.Analyser()
  analyser.analyseModel(model)
  const handles = [parser, model, analyser]
  /** Keeps a handle to free, and gives it back. */
  const keep = (handle) => (handles.push(handle), handle)
  try {
    // Units warnings don't stop a model running.
    if (analyser.errorCount() > 0) {
      const issues = Array.from({ length: analyser.errorCount() }, (_, i) => keep(analyser.error(i)).description())
      throw new Error(`The model doesn't analyse: ${issues.join(' ')}`)
    }
    const analysed = keep(analyser.analyserModel())
    const variables = new Map()
    for (let c = 0; c < model.componentCount(); c++) {
      const component = keep(model.componentByIndex(c))
      for (let v = 0; v < component.variableCount(); v++) {
        const variable = keep(component.variableByIndex(v))
        const type = libcellml.AnalyserVariable.typeAsString(keep(analysed.analyserVariable(variable)).type())
        variables.set(`${component.name()}/${variable.name()}`, { kind: KINDS[type] ?? 'computed', unit: keep(variable.units()).name() })
      }
    }
    return variables
  } finally {
    handles.reverse().forEach((handle) => handle?.delete?.())
  }
}

/**
 * Writes one case's bundle.
 *
 * @param {Object} libcellml
 * @param {Object} parity - cases.json.
 * @param {Object} testCase - One of its cases.
 * @param {string} directory
 */
function writeBundle(libcellml, parity, testCase, directory) {
  const validated = validateProtocolInfo(testCase.protocol_info)
  if (validated.errors.length) throw new Error(validated.errors.join(' '))
  const view = readProtocolInfo(validated.protocolInfo)
  const drivers = planDrivers(view)
  let cellml = readFileSync(path.join(PARITY, testCase.model), 'utf8')
  if (drivers.length) {
    const driven = addProtocolDrivers({ libcellml, cellml, drivers })
    if (driven.errors.length) throw new Error(driven.errors.join(' '))
    cellml = driven.cellml
  }
  const clocked = addProtocolClock({ libcellml, cellml })
  if (clocked.errors.length) throw new Error(clocked.errors.join(' '))
  cellml = clocked.cellml

  const variables = describeVariables(libcellml, cellml)
  const settings = { solver: 'CVODE', tolerance: parity.solver.tolerance, maxSteps: 50000, timeStep: testCase.maximumStep, pointInterval: testCase.pointInterval }
  // No nodes: each parameter is named as the model reports it.
  const run = prepareProtocolRun({ view, drivers, nodes: [], mapping: new Map(), variables, settings })
  if (run.errors.length) throw new Error(run.errors.join(' '))

  const group = { id: 'traces', name: 'Traces' }
  const sedml = buildProtocolSedml({
    plan: run.plan,
    targets: run.targets,
    variables,
    settings: run.settings,
    experiments: view.experiments.map(({ label, colour }, e) => ({ label: label ?? nameExperiment(e), colour })),
    time: { unit: variables.get('environment/time')?.unit ?? '' },
    groups: [group],
    traces: testCase.variables.map((name) => ({ name, label: name, unit: variables.get(name)?.unit ?? '', groupId: group.id })),
    inputs: null,
    overlay: true,
    drivers,
  })

  mkdirSync(directory, { recursive: true })
  writeFileSync(path.join(directory, BUNDLE_FILES.model), cellml)
  writeFileSync(path.join(directory, BUNDLE_FILES.sedml), sedml)
  writeFileSync(path.join(directory, BUNDLE_FILES.readme), buildBundleReadme({ stem: testCase.name, warnings: run.warnings, hasDrivers: drivers.length > 0 }))
  writeFileSync(path.join(directory, 'expected.json'), `${JSON.stringify({ case: testCase.name }, null, 2)}\n`)
  if (existsSync(SCRIPT)) copyFileSync(SCRIPT, path.join(directory, BUNDLE_FILES.script))
}

const output = process.argv[2]
if (!output) {
  console.error('Usage: node scripts/protocol-export/write_parity_bundles.mjs OUTPUT_DIR')
  process.exit(2)
}
const wasm = path.join(ROOT, 'node_modules', 'libcellml.js', 'libcellml.wasm')
const libcellml = await createLibCellML({ locateFile: (file, prefix) => (file.endsWith('.wasm') ? wasm : `${prefix}${file}`) })
const parity = JSON.parse(readFileSync(path.join(PARITY, 'cases.json'), 'utf8'))
for (const testCase of parity.cases) writeBundle(libcellml, parity, testCase, path.join(output, testCase.name))
console.log(`Wrote ${parity.cases.length} bundles to ${output}.`)
