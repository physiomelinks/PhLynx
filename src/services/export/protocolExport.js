/**
 * Bundles a protocol to run outside PhLynx: run_protocol.py, which runs the workspace's obs_data with libcuflynx
 * (circulatory_autogen) and plots its prediction items, with the model it runs on, and the SED-ML of PhLynx's own run
 * when PhLynx can plan it. Only the script's header is written per export; its body is templates/run_protocol.py.
 */
import JSZip from 'jszip'
import { formatPythonRepr, readObsDataParts, resolveParameterName } from '@physiomelinks/protocol-kit'

import { buildManifestXml } from './omex'
import { SEDML_MODEL } from './protocolSedml'
import requirements from './templates/requirements.txt?raw'
import { findProtocolTarget } from '../simulation/protocolTargets'
import { resolveSolverSettings, SOLVERS } from '../simulation/sedParameters'

/** The files of a bundle, but the obs_data, which keeps the workspace's name for it. */
export const BUNDLE_FILES = {
  script: 'run_protocol.py',
  model: 'model.cellml',
  requirements: 'requirements.txt',
  readme: 'README.md',
  manifest: 'manifest.xml',
  sedml: 'protocol.sedml',
  sedmlModel: SEDML_MODEL,
}

/** What the script needs, as pip reads it (templates/requirements.txt). */
export const BUNDLE_REQUIREMENTS = requirements

/** The circulatory_autogen pull request whose libcuflynx computes prediction items' features. */
export const CA_FEATURES_PR = 536

// The lines run_protocol.py's header is written between.
const HEADER_START = "# ---- Written by PhLynx's export"
const HEADER_END = '# ---- End of what PhLynx wrote'

// How circulatory autogen spells a prediction item without an operation (PrimitiveParsers._NO_OPERATION_SPELLINGS).
const NO_OPERATION = new Set(['', 'None', 'none', 'Null', 'null', 'nan'])

/**
 * Whether a prediction item is a feature: an operation over its operands, rather than their trace.
 *
 * @param {Object} item - A prediction item, as obs_data has it.
 * @returns {boolean}
 */
export const isFeatureItem = (item) => item?.operation != null && !NO_OPERATION.has(String(item.operation).trim())

/**
 * Names the group a prediction item is plotted in, as circulatory autogen defaults it, its legacy keys read as their
 * replacements (`variable` as data_item_name, `name_for_plotting` as trace_name_for_plotting): its
 * item_name_for_plotting, else its trace_name_for_plotting, else its first operand, else its data_item_name.
 *
 * @param {Object} item
 * @returns {string}
 */
export function nameItemGroup(item) {
  const name = item.data_item_name ?? item.variable
  // CA records an item without operands as its own name.
  const operand = Array.isArray(item.operands) && item.operands.length ? item.operands[0] : name
  return String(item.item_name_for_plotting ?? item.trace_name_for_plotting ?? item.name_for_plotting ?? (String(operand ?? '') || String(name ?? '')))
}

/**
 * Reads an obs_data document's prediction items, and what the export needs to know of them.
 *
 * @param {Object|Array|undefined} document - The obs_data, as parsed.
 * @returns {{items: Array<Object>, featureGroups: Array<{name: string, experiments: number[]}>, needsFeatureRelease: boolean}}
 *   `featureGroups` each feature's name with the experiments it's recorded in, in order; `needsFeatureRelease`
 *   whether any item has an operation or a sub-experiment, which only libcuflynx from CA_FEATURES_PR reads.
 */
export function readPredictionItems(document) {
  const items = document === undefined ? [] : readObsDataParts(document).predictionItems.filter((item) => item && typeof item === 'object')
  const groups = new Map()
  for (const item of items.filter(isFeatureItem)) {
    const name = nameItemGroup(item)
    if (!groups.has(name)) groups.set(name, new Set())
    groups.get(name).add(Number(item.experiment_idx ?? 0))
  }
  return {
    items,
    featureGroups: [...groups].map(([name, experiments]) => ({ name, experiments: [...experiments].sort((a, b) => a - b) })),
    needsFeatureRelease: items.some((item) => isFeatureItem(item) || item.subexperiment_idx != null),
  }
}

/**
 * Works out the names the script gives libcuflynx for a protocol's parameters: each one PhLynx finds in the model
 * under a name other than the one circulatory autogen would find (resolveParameterName without PhLynx's components),
 * which it can't find or would find elsewhere.
 *
 * @param {Object} options
 * @param {string[]} options.parameters - The protocol's parameters, as params_to_change names them.
 * @param {Array<Object>} options.nodes - The scope's nodes.
 * @param {Map<string, string>} options.mapping - `nodeId::name` to the name libOpenCOR reports.
 * @param {Map<string, Object>|Set<string>} options.variables - The plain model's variables, by reported name.
 * @returns {{names: Object<string, string>, unresolved: string[]}} `names` maps a parameter to the model's name for
 *   it; `unresolved` lists those PhLynx finds no variable for.
 */
export function buildParameterNames({ parameters, nodes, mapping, variables }) {
  const isKnown = (name) => variables.has(name)
  const names = {}
  const unresolved = []
  for (const parameter of parameters) {
    const target = findProtocolTarget(parameter, { nodes, mapping, variables })
    if (!target) unresolved.push(parameter)
    else if (resolveParameterName(parameter, isKnown, { withPhlynxComponents: false }) !== target) names[parameter] = target
  }
  return { names, unresolved }
}

/**
 * Gives a run's solver settings as libcuflynx names them. libcuflynx runs CVODE: a fixed-step solver's step becomes
 * its largest step, and CVODE's tolerance both its tolerances.
 *
 * @param {Object} settings - The run's simulation settings, with CVODE's step clamped for its drivers.
 * @returns {{MaximumStep?: number, rtol?: number, atol?: number}}
 */
export function buildSolverInfo(settings) {
  const { solver, timeStep, tolerance } = resolveSolverSettings(settings)
  const step = timeStep > 0 ? { MaximumStep: timeStep } : {}
  return SOLVERS[solver]?.isFixedStep ? step : { ...step, rtol: tolerance, atol: tolerance }
}

/**
 * Turns the export dialog's feature plots into the script's FEATURE_PLOTS.
 *
 * @param {Array<Object>} featurePlots - `{title, y, x, series}`: `y` a feature's name; `x` as `{kind: 'feature',
 *   feature}`, `{kind: 'input', input, subexperiment}` or `{kind: 'experiment'}`; `series` null or `{input,
 *   subexperiment}`. Sub-experiments from 0.
 * @returns {Array<Object>} `{title, x, y, series}`: `x` a feature's name, `{input, subexperiment_idx}` or
 *   'experiment'; `series` null or `{input, subexperiment_idx}`.
 */
export function buildFeaturePlots(featurePlots) {
  const input = (axis) => ({ input: axis.input, subexperiment_idx: axis.subexperiment })
  return featurePlots.map(({ title, y, x, series }) => ({
    title: title?.trim() || null,
    x: x.kind === 'feature' ? x.feature : x.kind === 'input' ? input(x) : 'experiment',
    y,
    series: series ? input(series) : null,
  }))
}

/**
 * Checks the export dialog's feature plots: each of features the obs_data records, against an input that is one
 * number in that sub-experiment of every experiment the plot's feature is recorded in.
 *
 * @param {Object} options
 * @param {Object} options.view - The protocol, from readProtocolInfo.
 * @param {Array<{name: string, experiments: number[]}>} options.featureGroups - From readPredictionItems.
 * @param {Array<Object>} options.featurePlots - As buildFeaturePlots takes them.
 * @returns {Array<{path: string, message: string}>} `path` as `featurePlots[0].x`.
 */
export function validateFeaturePlots({ view, featureGroups, featurePlots }) {
  const errors = []
  /** Records a problem. */
  const add = (path, message) => errors.push({ path, message })
  const groups = new Map(featureGroups.map(({ name, experiments }) => [name, experiments]))
  /** Checks a feature is recorded. */
  const checkFeature = (path, name, missing) => !groups.has(name) && add(path, name ? `The protocol records no feature called ${name}.` : missing)
  /** Checks an input is one number in a sub-experiment of each experiment. */
  const checkInput = (path, { input, subexperiment }, experiments) => {
    const control = view.controls.find((candidate) => candidate.parameter === input)
    if (!control) return add(`${path}.input`, input ? `${input} isn't an input of the protocol.` : 'Choose an input of the protocol.')
    for (const e of experiments) {
      const cell = control.cells[e]?.[subexperiment]
      if (!cell) return add(`${path}.subexperiment`, `Experiment ${e + 1} has no sub-experiment ${subexperiment + 1}.`)
      if (cell.kind !== 'constant') return add(path, `${input} isn't one number in experiment ${e + 1}, sub-experiment ${subexperiment + 1}.`)
    }
  }

  featurePlots.forEach(({ y, x, series }, p) => {
    const path = `featurePlots[${p}]`
    checkFeature(`${path}.y`, y, 'Choose a feature to plot.')
    const experiments = groups.get(y) ?? []
    if (x?.kind === 'feature') checkFeature(`${path}.x.feature`, x.feature, 'Choose a feature to plot against.')
    else if (x?.kind === 'input') checkInput(`${path}.x`, x, experiments)
    else if (x?.kind !== 'experiment') add(`${path}.x.kind`, 'Plot against a feature, an input or the experiment.')
    if (series) checkInput(`${path}.series`, series, experiments)
  })
  return errors
}

/**
 * Writes a Python assignment, its comment after it, its dict or list a line an entry when it has any.
 *
 * @param {string} name
 * @param {Object|Array|*} value
 * @param {string} comment
 * @param {string[]} [extraLines] - Comment lines inside the dict or list, after its entries.
 * @returns {string[]}
 */
function writeAssignment(name, value, comment, extraLines = []) {
  const entries = Array.isArray(value)
    ? value.map((entry) => formatPythonRepr(entry))
    : value && typeof value === 'object'
      ? Object.entries(value).map(([key, entry]) => `${formatPythonRepr(key)}: ${formatPythonRepr(entry)}`)
      : null
  if (!entries || (!entries.length && !extraLines.length)) return [`${name} = ${formatPythonRepr(value)}  # ${comment}`]
  const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}']
  return [`${name} = ${open}  # ${comment}`, ...entries.map((entry) => `    ${entry},`), ...extraLines.map((line) => `    ${line}`), close]
}

/**
 * Writes run_protocol.py's header: what it runs, and how.
 *
 * @param {Object} options
 * @param {string} options.obsData - The obs_data file's name.
 * @param {number} options.dt - The time between recorded points.
 * @param {string} [options.timeUnit] - The model's unit of time.
 * @param {Object} options.solverInfo - From buildSolverInfo.
 * @param {Object<string, string>} options.parameterNames - From buildParameterNames.
 * @param {string[]} [options.unresolved] - From buildParameterNames.
 * @param {Array<Object>} [options.featurePlots] - From buildFeaturePlots.
 * @returns {string} The lines between the header's markers.
 */
export function buildScriptHeader({ obsData, dt, timeUnit = '', solverInfo, parameterNames, unresolved = [], featurePlots = [] }) {
  return [
    `MODEL = ${formatPythonRepr(BUNDLE_FILES.model)}`,
    `OBS_DATA = ${formatPythonRepr(obsData)}`,
    `DT = ${formatPythonRepr(dt)}  # the time between recorded points`,
    `TIME_UNIT = ${formatPythonRepr(timeUnit)}  # the unit of time, as the model has it`,
    ...writeAssignment('SOLVER_INFO', solverInfo, "CVODE's settings, as libcuflynx names them"),
    ...writeAssignment(
      'PARAMETER_NAMES',
      parameterNames,
      "protocol parameters libcuflynx can't find in MODEL -> the model's names for them, in outputs too",
      unresolved.map((parameter) => `# ${formatPythonRepr(parameter)}: 'component/variable',  # PhLynx found no variable for it in MODEL`)
    ),
    ...writeAssignment('FEATURE_PLOTS', featurePlots, 'features against another feature, a protocol input or the experiment'),
    'OPERATION_FUNCS_PATH = None  # a file of your own operation functions, for features that use them',
  ].join('\n')
}

/**
 * Writes a header into run_protocol.py, between its markers.
 *
 * @param {string} template - templates/run_protocol.py.
 * @param {string} header - From buildScriptHeader.
 * @returns {string}
 */
export function fillScriptTemplate(template, header) {
  const lines = template.split('\n')
  const start = lines.findIndex((line) => line.startsWith(HEADER_START))
  const end = lines.findIndex((line) => line.startsWith(HEADER_END))
  if (start < 0 || end < start) throw new Error("run_protocol.py has lost the lines PhLynx's export writes between.")
  return [...lines.slice(0, start + 1), header, ...lines.slice(end)].join('\n')
}

/**
 * Writes the bundle's README: what it holds, how to install and run it, and what to know.
 *
 * @param {Object} options
 * @param {string} options.stem - The bundle's name.
 * @param {string} options.obsData - The obs_data file's name.
 * @param {string[]} [options.warnings] - What the export warned of.
 * @param {string|null} [options.sedmlProblem] - Why the SED-ML is left out, or null when it's in.
 * @returns {string} Markdown.
 */
export function buildBundleReadme({ stem, obsData, warnings = [], sedmlProblem = null }) {
  const warningLines = warnings.length ? warnings.map((warning) => `- ${warning}`).join('\n') : '- None.'
  const sedmlRows = sedmlProblem
    ? ''
    : `| \`${BUNDLE_FILES.sedml}\` | PhLynx's own run of the protocol, in SED-ML (Level 1 Version 4), with its trace plots. |
| \`${BUNDLE_FILES.sedmlModel}\` | The model \`${BUNDLE_FILES.sedml}\` runs: \`${BUNDLE_FILES.model}\` with the protocol's ramps and traces, and its clock, written in. |
`
  const sedmlNote = sedmlProblem
    ? `- \`${BUNDLE_FILES.sedml}\`, PhLynx's own run, is left out: ${sedmlProblem} The script doesn't need it.`
    : `- \`${BUNDLE_FILES.sedml}\` is a record of PhLynx's run. SED-ML tools don't yet run its nested repeated tasks faithfully.`
  return `# ${stem}: a protocol to run outside PhLynx

Exported by PhLynx. \`${BUNDLE_FILES.script}\` runs the protocol in \`${obsData}\` on \`${BUNDLE_FILES.model}\` with libcuflynx
(circulatory_autogen), records the outputs its \`prediction_items\` ask for, and plots them.

## What's here

| File | What it is |
| --- | --- |
| \`${BUNDLE_FILES.script}\` | Runs the protocol, writes the outputs, and draws the plots. Edit it freely. |
| \`${obsData}\` | The protocol (\`protocol_info\`) and its outputs (\`prediction_items\`), as the workspace has it. CUFLynx reads it too. |
| \`${BUNDLE_FILES.model}\` | The flattened model. |
| \`${BUNDLE_FILES.requirements}\` | The Python packages the script needs. |
${sedmlRows}| \`${BUNDLE_FILES.manifest}\` | The COMBINE archive manifest: rename the zip to \`.omex\` to open it as one. |

## Install

Python 3.10 to 3.13: libcuflynx needs libcellml older than 0.7, which has no wheels for Python 3.14. libcuflynx runs the
model with Myokit, which compiles it, so it needs a C compiler and SUNDIALS, and \`pip\` needs git to install it:

- macOS: \`xcode-select --install\`, then \`brew install sundials\`.
- Linux: your compiler (\`gcc\`) and SUNDIALS (\`libsundials-dev\` on Debian or Ubuntu).
- Or, anywhere: \`conda install -c conda-forge sundials\`.

Then, ideally in a virtual environment:

\`\`\`sh
python -m venv .venv
source .venv/bin/activate
pip install -r ${BUNDLE_FILES.requirements}
\`\`\`

Features (prediction items with an \`operation\`) and outputs of one sub-experiment (\`subexperiment_idx\`) need
libcuflynx from circulatory_autogen #${CA_FEATURES_PR}, which \`${BUNDLE_FILES.requirements}\` installs from git until it's
released. Released libcuflynx 0.7.3, and CUFLynx until it updates, refuse an obs_data with them.

## Run

\`\`\`sh
python ${BUNDLE_FILES.script}
\`\`\`

- \`--out DIR\`: where to write the results (\`results/\`, beside the script, by default).
- \`--format png,svg,pdf\`: the figure formats to write.
- \`--show\`: open the figures as well.

## Outputs

In \`results/\`, beside the script:

- \`traces.png\`: a plot per \`trace_name_for_plotting\` of the prediction items without an operation, each
  experiment in its colour (\`experiment_colors\`, \`experiment_labels\`).
- \`features.png\`: a plot per feature (\`item_name_for_plotting\`), a point per experiment.
- \`feature_plot_N.png\`: each of \`FEATURE_PLOTS\`, such as a current's peak against the voltage it was clamped at. One
  whose feature wasn't computed, or has more than one item in an experiment, is skipped with a warning.
- \`traces.csv\` and \`features.csv\`: every value plotted, a row per point.

libcuflynx computes each feature with its own operation functions, over the sub-experiment's points, the first
included, so the numbers are those circulatory_autogen and CUFLynx compute.

## Changing what it runs and plots

- **Outputs:** add or change them under Outputs in PhLynx's protocol editor (Edit the protocol), and export again; or
  edit \`prediction_items\` in \`${obsData}\`.
- **Settings:** the top of \`${BUNDLE_FILES.script}\`, between the lines PhLynx wrote: \`DT\`, \`TIME_UNIT\`, \`SOLVER_INFO\`, \`FEATURE_PLOTS\`,
  and \`PARAMETER_NAMES\`, which gives libcuflynx the model's name for a protocol parameter it can't find, wherever the
  protocol or its outputs name it.
- **Plots:** each figure has its own function; add your own in \`your_plots\`, which gets the same tables as the CSVs.
- A pulse shorter than \`SOLVER_INFO['MaximumStep']\` may be stepped over: lower it if one is.

## Warnings from the export

${warningLines}

## Known limits

${sedmlNote}
`
}

/**
 * Bundles run_protocol.py with the model, the workspace's obs_data, byte for byte under its own name, and the SED-ML
 * of PhLynx's run when there is one.
 *
 * @param {Object} options
 * @param {string} options.script - run_protocol.py, its header written.
 * @param {string} options.cellml - The plain flattened model.
 * @param {{name: string, payload: ArrayBuffer|string}} options.obsData - The workspace's obs_data file.
 * @param {string} options.readme - From buildBundleReadme.
 * @param {{sedml: string, cellml: string}|null} [options.sedml] - From buildProtocolSedml, and the model it runs.
 * @returns {Promise<Blob>}
 */
export async function generateProtocolZip({ script, cellml, obsData, readme, sedml = null }) {
  const zip = new JSZip()
  const cellmlFormat = 'http://identifiers.org/combine.specifications/cellml'
  const entries = [
    { location: BUNDLE_FILES.script, format: 'text/x-python', content: script },
    { location: BUNDLE_FILES.model, format: cellmlFormat, master: !sedml, content: cellml },
    { location: obsData.name, format: 'application/json', content: obsData.payload },
    { location: BUNDLE_FILES.requirements, format: 'text/plain', content: BUNDLE_REQUIREMENTS },
    { location: BUNDLE_FILES.readme, format: 'text/markdown', content: readme },
    sedml && { location: BUNDLE_FILES.sedml, format: 'http://identifiers.org/combine.specifications/sed-ml', master: true, content: sedml.sedml },
    sedml && { location: BUNDLE_FILES.sedmlModel, format: cellmlFormat, content: sedml.cellml },
  ].filter(Boolean)
  entries.forEach(({ location, content }) => zip.file(location, content))
  zip.file(BUNDLE_FILES.manifest, buildManifestXml(entries))
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } })
}
