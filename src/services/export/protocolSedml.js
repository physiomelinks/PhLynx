/**
 * Writes a protocol's run as SED-ML (Level 1 Version 4), with the plots and features to make of it, and bundles it
 * with the model and a Python script that runs it. The SED-ML follows PhLynx's own plan (compileProtocolPlan), so the
 * script, which runs it with Myokit, reproduces PhLynx's run: each experiment is a repeated task of its warm-up and
 * its sub-experiments, and each segment of those a sub-task that sets its values first.
 */
import JSZip from 'jszip'
import { nameExperiment, resolveExperimentColour } from '@physiomelinks/protocol-kit'

import { buildManifestXml } from './omex'
import requirements from './templates/requirements.txt?raw'
import { CLOCK_COMPONENT, CLOCK_OFFSET, CLOCK_TIME, DRIVER_COMPONENT, nameDriverVariables } from '../simulation/protocolDriverModel'
import { buildAlgorithm, formatSedNumber } from '../simulation/sedParameters'
import { SERIES_COLOURS } from '../simulation/seriesSlots'

/** The operations a feature reduces a variable over a sub-experiment with. */
export const FEATURE_OPERATIONS = ['mean', 'min', 'max', 'max_minus_min']

/** The files of a bundle. */
export const BUNDLE_FILES = {
  sedml: 'protocol.sedml',
  model: 'model.cellml',
  script: 'run_sedml.py',
  requirements: 'requirements.txt',
  readme: 'README.md',
  obsData: 'obs_data.json',
  manifest: 'manifest.xml',
}

/** What the bundle's script needs, as pip reads it (templates/requirements.txt, which its tests read too). */
export const BUNDLE_REQUIREMENTS = requirements

const SEDML_NAMESPACE = 'http://sed-ml.org/sed-ml/level1/version4'
const CELLML_NAMESPACE = 'http://www.cellml.org/cellml/2.0#'
const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML'
const MODEL_ID = 'model'

// The KiSAO ids of the reductions over a task's points.
const REDUCTIONS = { mean: 'KISAO:0000841', max: 'KISAO:0000830', min: 'KISAO:0000840' }

// How the traces sharing a plot are told apart when they share an experiment's colour.
const LINE_TYPES = ['solid', 'dash', 'dot']
const LINE_THICKNESS = '1.5'
const MARKER_SIZE = '6'
// The line joining a feature plot's points when they aren't in series.
const FEATURE_LINE_COLOUR = '7F7F7F'

/**
 * Makes an XML element.
 *
 * @param {string} name
 * @param {Object} [attributes] - Values written as text; null and undefined ones are left out.
 * @param {Array<Object|null|false>|string} [children] - Elements (falsy ones left out), or the element's text.
 * @returns {{name: string, attributes: Object, children: Array|string}}
 */
const element = (name, attributes = {}, children = []) => ({ name, attributes, children })

/**
 * Escapes text for XML, between tags or in a double-quoted attribute (so XPaths keep their single quotes).
 *
 * @param {*} text
 * @returns {string}
 */
const escapeXml = (text) =>
  String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/**
 * Writes an element and its children, indented two spaces a level.
 *
 * @param {Object} node - From element.
 * @param {number} [depth]
 * @returns {string}
 */
function writeElement({ name, attributes, children }, depth = 0) {
  const indent = '  '.repeat(depth)
  const written = Object.entries(attributes)
    .filter(([, value]) => value != null)
    .map(([key, value]) => ` ${key}="${escapeXml(value)}"`)
    .join('')
  if (typeof children === 'string') return `${indent}<${name}${written}>${escapeXml(children)}</${name}>`
  const kept = children.filter(Boolean)
  if (!kept.length) return `${indent}<${name}${written}/>`
  return [`${indent}<${name}${written}>`, ...kept.map((child) => writeElement(child, depth + 1)), `${indent}</${name}>`].join('\n')
}

/**
 * Wraps MathML content in its `<math>` element.
 *
 * @param {Object} content
 * @returns {Object}
 */
const math = (content) => element('math', { xmlns: MATHML_NAMESPACE }, [content])

/**
 * Makes MathML naming a variable.
 *
 * @param {string} id
 * @returns {Object}
 */
const ci = (id) => element('ci', {}, id)

/**
 * Makes MathML for a number, written as the rest of the SED-ML writes them.
 *
 * @param {number} value
 * @returns {Object}
 */
const cn = (value) => element('cn', {}, formatSedNumber(value))

/**
 * Writes the XPath of a model variable named `component/variable`, as libOpenCOR reports it.
 *
 * @param {string} name
 * @returns {string}
 */
export function writeTarget(name) {
  const separator = name.indexOf('/')
  return `/cellml:model/cellml:component[@name='${name.slice(0, separator)}']/cellml:variable[@name='${name.slice(separator + 1)}']`
}

/**
 * Writes a '#' hex colour as SED-ML has them: RRGGBB, or RRGGBBAA with its alpha, without '#'.
 *
 * @param {string} colour - '#rgb', '#rgba', '#rrggbb' or '#rrggbbaa', as resolveExperimentColour gives them.
 * @returns {string}
 */
function writeColour(colour) {
  const digits = colour.slice(1)
  return (digits.length <= 4 ? [...digits].map((digit) => digit + digit).join('') : digits).toUpperCase()
}

/**
 * Adds a unit to a name, as the axes show them.
 *
 * @param {string} text
 * @param {string|null|undefined} unit
 * @returns {string}
 */
const withUnit = (text, unit) => (unit ? `${text} (${unit})` : text)

/**
 * Gives a segment's time course as the joined results keep it. A segment whose first point repeats the last one
 * before it starts its output a point later. One that has only that point and its last keeps its last alone: its
 * output starts and ends there, which run_sedml.py reads as a single point.
 *
 * @param {Object} segment - From compileProtocolPlan.
 * @returns {{timeCourse: {initialTime: number, outputStartTime: number, outputEndTime: number, numberOfSteps: number},
 *   isSingle: boolean}}
 */
export function readLoggedTimeCourse({ timeCourse, dropsFirstPoint }) {
  if (!dropsFirstPoint) return { timeCourse, isSingle: false }
  const { outputStartTime, outputEndTime, numberOfSteps } = timeCourse
  if (numberOfSteps === 1) return { timeCourse: { ...timeCourse, outputStartTime: outputEndTime, numberOfSteps: 1 }, isSingle: true }
  const step = (outputEndTime - outputStartTime) / numberOfSteps
  return { timeCourse: { ...timeCourse, outputStartTime: outputStartTime + step, numberOfSteps: numberOfSteps - 1 }, isSingle: false }
}

/**
 * Makes a one-iteration repeated task: its range has the one value given, and its outputs are its sub-tasks' joined.
 *
 * @param {string} id
 * @param {{resetModel?: boolean, value?: number, subTasks: Object[]}} options
 * @returns {Object}
 */
const repeatedTask = (id, { resetModel = false, value = 0, subTasks }) =>
  element('repeatedTask', { id, range: `${id}_range`, resetModel: String(resetModel), concatenate: 'true' }, [
    element('listOfRanges', {}, [element('vectorRange', { id: `${id}_range` }, [element('value', {}, String(value))])]),
    element('listOfSubTasks', {}, subTasks),
  ])

/**
 * Makes a sub-task, with the changes it makes before it runs.
 *
 * @param {string} id
 * @param {number} order - From 1.
 * @param {string} task
 * @param {Object[]} [changes]
 * @returns {Object}
 */
const subTask = (id, order, task, changes = []) =>
  element('subTask', { id, order: String(order), task }, [changes.length > 0 && element('listOfChanges', {}, changes)])

/**
 * Makes a change setting a model variable to a number.
 *
 * @param {string} name - `component/variable`.
 * @param {number} value
 * @returns {Object}
 */
const setValue = (name, value) => element('setValue', { modelReference: MODEL_ID, target: writeTarget(name) }, [math(cn(value))])

/**
 * Makes a data generator's variable.
 *
 * @param {string} id
 * @param {string} name - The model variable, `component/variable`.
 * @param {string} taskReference
 * @param {string} [dimensionTerm] - The KiSAO id of a reduction over the task's points.
 * @returns {Object}
 */
const variable = (id, name, taskReference, dimensionTerm) => element('variable', { id, target: writeTarget(name), taskReference, dimensionTerm })

/**
 * Makes a line style, and the marker it may have.
 *
 * @param {string} id
 * @param {{baseStyle?: string, line?: {type: string, color: string}, marker?: Object}} options - `marker` as its
 *   attributes.
 * @returns {Object}
 */
const style = (id, { baseStyle, line, marker }) =>
  element('style', { id, baseStyle }, [
    line && element('line', { type: line.type, color: line.color, thickness: LINE_THICKNESS }),
    marker && element('marker', marker),
  ])

/**
 * Builds the SED-ML of a protocol's run, with its trace plots, features and feature plots.
 *
 * @param {Object} options
 * @param {Object} options.plan - From prepareProtocolRun (compileProtocolPlan).
 * @param {Map<string, string>} options.targets - Each parameter the plan sets to its reported `component/variable`.
 * @param {Map<string, {kind: string, unit?: string}>} options.variables - The model's variables, by reported name.
 * @param {Object} options.settings - The run's simulation settings, from prepareProtocolRun.
 * @param {Array<{label: string, colour: string|null}>} options.experiments - One per experiment of the plan.
 * @param {{unit: string}} options.time - The model's time unit.
 * @param {Array<{id: string, name: string}>} options.groups - The trace plots, in order.
 * @param {Array<{name: string, label: string, unit: string, groupId: string}>} options.traces - Reported names.
 * @param {Array<{name: string, label: string, unit: string}>|null} [options.inputs] - The protocol's inputs to plot
 *   first, or null for none.
 * @param {Array<{name: string, operation: string, operand: string, subexperiment: number}>} [options.features] -
 *   `operand` a reported name, `subexperiment` from 0.
 * @param {Array<Object>} [options.featurePlots] - `{title, y, x, series}`: `y` a feature's name; `x` as
 *   `{kind: 'feature', feature}`, `{kind: 'input', parameter, subexperiment}` or `{kind: 'experiment'}`; `series`
 *   null or `{parameter, subexperiment}`, grouping experiments by that input's number.
 * @param {boolean} options.overlay - Whether every experiment shares each trace plot, or each has its own.
 * @param {Array<Object>} [options.drivers] - From planDrivers: a driven input's number is its driver's.
 * @returns {string} The SED-ML document.
 */
export function buildProtocolSedml({
  plan,
  targets,
  variables,
  settings,
  experiments,
  time,
  groups,
  traces,
  inputs = null,
  features = [],
  featurePlots = [],
  overlay,
  drivers = [],
}) {
  /** Gives the variable a plan parameter sets. */
  const reportedOf = (parameter) => {
    const reported = targets.get(parameter)
    if (!reported) throw new Error(`The protocol sets ${parameter}, which has no variable in the model.`)
    return reported
  }
  const kindOf = (parameter) => variables.get(reportedOf(parameter))?.kind
  const labelOf = (e) => experiments[e]?.label ?? nameExperiment(e)
  const colourOf = (e) => writeColour(resolveExperimentColour(experiments[e]?.colour, e, SERIES_COLOURS.light))

  // One simulation, and its task, for each distinct time course.
  const simulations = new Map()
  /** Gives the task that runs a time course, adding it the first time. */
  const taskFor = (timeCourse) => {
    const key = [timeCourse.initialTime, timeCourse.outputStartTime, timeCourse.outputEndTime, timeCourse.numberOfSteps].join('|')
    if (!simulations.has(key)) simulations.set(key, { n: simulations.size + 1, timeCourse })
    return `task${simulations.get(key).n}`
  }

  const repeatedTasks = plan.experiments.flatMap((experimentPlan, e) => {
    const { preTime, segments, subs } = experimentPlan
    // experiment_time is 0 at the end of the warm-up, and carries on across sub-experiments, whose clocks restart.
    const offsetOf = (s) => (s === 0 ? preTime : -subs.slice(0, s).reduce((total, { duration }) => total + duration, 0))
    // A state takes its number on the experiment's first segment only: later ones carry on from the one before.
    const changesOf = (segment, index) => [
      ...segment.values.filter(({ parameter }) => index === 0 || kindOf(parameter) !== 'state').map(({ parameter, value }) => setValue(reportedOf(parameter), value)),
      setValue(CLOCK_OFFSET, offsetOf(segment.sub)),
    ]
    const warmUp = []
    const logged = subs.map(() => [])
    segments.forEach((segment, index) => {
      if (!segment.isLogged) {
        warmUp.push(subTask(`exp${e}_w${warmUp.length}`, warmUp.length + 1, taskFor(segment.timeCourse), changesOf(segment, index)))
        return
      }
      const { timeCourse, isSingle } = readLoggedTimeCourse(segment)
      const own = logged[segment.sub]
      own.push(subTask(`exp${e}_s${segment.sub}_seg${own.length}${isSingle ? '_single' : ''}`, own.length + 1, taskFor(timeCourse), changesOf(segment, index)))
    })
    return [
      repeatedTask(`exp${e}`, {
        resetModel: true,
        value: e,
        subTasks: [warmUp.length > 0 && subTask(`exp${e}_warmup_st`, 1, `exp${e}_warmup`), subTask(`exp${e}_logged_st`, 2, `exp${e}_logged`)],
      }),
      warmUp.length > 0 && repeatedTask(`exp${e}_warmup`, { subTasks: warmUp }),
      repeatedTask(`exp${e}_logged`, { subTasks: subs.map((_, s) => subTask(`exp${e}_sub${s}_st`, s + 1, `exp${e}_sub${s}`)) }),
      ...logged.map((subTasks, s) => repeatedTask(`exp${e}_sub${s}`, { subTasks })),
    ]
  })

  const { solver, parameters } = buildAlgorithm(settings)
  const algorithm = element('algorithm', { kisaoID: solver.kisaoId }, [
    element(
      'listOfAlgorithmParameters',
      {},
      parameters.map(({ kisaoId, value }) => element('algorithmParameter', { kisaoID: kisaoId, value }))
    ),
  ])
  const simulationElements = [...simulations.values()].map(({ n, timeCourse }) =>
    element(
      'uniformTimeCourse',
      {
        id: `sim${n}`,
        initialTime: formatSedNumber(timeCourse.initialTime),
        outputStartTime: formatSedNumber(timeCourse.outputStartTime),
        outputEndTime: formatSedNumber(timeCourse.outputEndTime),
        numberOfSteps: String(timeCourse.numberOfSteps),
      },
      [algorithm]
    )
  )
  const taskElements = [...simulations.values()].map(({ n }) => element('task', { id: `task${n}`, modelReference: MODEL_ID, simulationReference: `sim${n}` }))

  /**
   * Gives the number an input takes over a sub-experiment of an experiment, as the plan sets it: its own, or its
   * driver's when it has one. The number must be the same throughout.
   */
  const numberOf = (parameter, s, e) => {
    const driver = drivers.find((candidate) => candidate.parameter === parameter)
    const names = driver && nameDriverVariables(driver)
    const planParameter = targets.has(parameter) || !driver ? parameter : `${DRIVER_COMPONENT}/${names.value}`
    const where = `experiment ${e + 1}, sub-experiment ${s + 1}`
    const sets = plan.experiments[e].segments.filter((segment) => segment.isLogged && segment.sub === s)
    const found = sets.map(({ values }) => values.find((entry) => entry.parameter === planParameter)?.value)
    const selectors = driver ? sets.map(({ values }) => values.find((entry) => entry.parameter === `${DRIVER_COMPONENT}/${names.selector}`)?.value) : []
    if (!found.length || found.some((value) => typeof value !== 'number' || value !== found[0]) || selectors.some((selector) => selector !== 0)) {
      throw new Error(`${parameter} isn't one number throughout ${where}.`)
    }
    return { value: found[0], name: reportedOf(planParameter) }
  }

  // Features are named as validateExportFeatures reads them: trimmed.
  const featureIndex = new Map(features.map((feature, i) => [feature.name.trim(), i]))
  /** Gives the index of a feature a plot names. */
  const findFeature = (name) => {
    if (!featureIndex.has(name?.trim())) throw new Error(`No feature is called ${name}.`)
    return featureIndex.get(name.trim())
  }

  // Data generators: each experiment's time, inputs, traces, features, and the feature plots' x values.
  const dataGenerators = []
  /** Adds a data generator. */
  const addDataGenerator = (id, name, content, variablesList = []) =>
    dataGenerators.push({
      id,
      name,
      element: element('dataGenerator', { id, name }, [math(content), variablesList.length > 0 && element('listOfVariables', {}, variablesList)]),
    })
  plan.experiments.forEach((_, e) => {
    const label = labelOf(e)
    const logged = `exp${e}_logged`
    addDataGenerator(`dg_e${e}_time`, `Time · ${label}`, ci('v'), [variable('v', CLOCK_TIME, logged)])
    ;(inputs ?? []).forEach((input, j) => addDataGenerator(`dg_e${e}_in${j}`, `${input.label} · ${label}`, ci('v'), [variable('v', input.name, logged)]))
    traces.forEach((trace, j) => addDataGenerator(`dg_e${e}_tr${j}`, `${trace.label} · ${label}`, ci('v'), [variable('v', trace.name, logged)]))
    features.forEach((feature, i) => {
      const task = `exp${e}_sub${feature.subexperiment}`
      const name = `${feature.name.trim()} · ${label}`
      if (feature.operation === 'max_minus_min') {
        const difference = element('apply', {}, [element('minus'), ci('vmax'), ci('vmin')])
        addDataGenerator(`dg_e${e}_f${i}`, name, difference, [
          variable('vmax', feature.operand, task, REDUCTIONS.max),
          variable('vmin', feature.operand, task, REDUCTIONS.min),
        ])
      } else if (REDUCTIONS[feature.operation]) {
        addDataGenerator(`dg_e${e}_f${i}`, name, ci('v'), [variable('v', feature.operand, task, REDUCTIONS[feature.operation])])
      } else {
        throw new Error(`${feature.operation} isn't an operation a feature can take.`)
      }
    })
    featurePlots.forEach((featurePlot, p) => {
      const { x } = featurePlot
      if (x.kind === 'experiment') addDataGenerator(`dg_e${e}_fp${p}_x`, `Experiment · ${label}`, cn(e + 1))
      // The number the protocol sets, not a reading of the model: a state it sets moves on from it.
      if (x.kind === 'input') addDataGenerator(`dg_e${e}_fp${p}_x`, `${x.parameter} · ${label}`, cn(numberOf(x.parameter, x.subexperiment, e).value))
    })
  })

  // Styles: a line in each experiment's colour, dashed and dotted for the second and third traces of a plot.
  const usedLineTypes = new Set()
  const traceStyleOf = (e, position) => {
    const type = position % LINE_TYPES.length
    if (type === 0) return `style_e${e}`
    usedLineTypes.add(`${e}:${type}`)
    return `style_e${e}_l${type}`
  }

  // Trace plots: the inputs first, then each group with a trace.
  const panels = [
    ...(inputs?.length ? [{ key: 'inputs', name: 'Inputs', items: inputs.map((input, j) => ({ ...input, ref: `in${j}` })) }] : []),
    ...groups.map((group, g) => ({
      key: `g${g}`,
      name: group.name,
      items: traces.flatMap((trace, j) => (trace.groupId === group.id ? [{ ...trace, ref: `tr${j}` }] : [])),
    })),
  ].filter(({ items }) => items.length > 0)
  /** Names a plot's y axis by what it shows. */
  const yAxisName = ({ name, items }) => {
    const units = [...new Set(items.map(({ unit }) => unit ?? ''))]
    if (items.length === 1) return withUnit(items[0].label, items[0].unit)
    return units.length === 1 ? withUnit(name, units[0]) : name
  }
  const timeAxis = element('xAxis', { type: 'linear', name: withUnit('Time', time?.unit) })
  /** Makes a trace plot of some experiments. */
  const tracePlot = (id, name, panel, experimentIndices) =>
    element('plot2D', { id, name, legend: 'true' }, [
      timeAxis,
      element('yAxis', { type: 'linear', name: yAxisName(panel) }),
      element(
        'listOfCurves',
        {},
        experimentIndices.flatMap((e) =>
          panel.items.map((item, position) =>
            element('curve', {
              id: `c_${panel.key}_e${e}_${item.ref}`,
              name: `${item.label} · ${labelOf(e)}`,
              style: traceStyleOf(e, position),
              xDataReference: `dg_e${e}_time`,
              yDataReference: `dg_e${e}_${item.ref}`,
            })
          )
        )
      ),
    ])
  const experimentIndices = plan.experiments.map((_, e) => e)
  const outputs = overlay
    ? panels.map((panel) => tracePlot(`plot_${panel.key}`, panel.name, panel, experimentIndices))
    : panels.flatMap((panel) => experimentIndices.map((e) => tracePlot(`plot_${panel.key}_e${e}`, `${panel.name} · ${labelOf(e)}`, panel, [e])))
  if (!overlay && panels.length) {
    outputs.push(
      element('figure', { id: 'figure_traces', numRows: String(panels.length), numCols: String(experimentIndices.length) }, [
        element(
          'listOfSubPlots',
          {},
          panels.flatMap((panel, row) =>
            experimentIndices.map((e) => element('subPlot', { plot: `plot_${panel.key}_e${e}`, row: String(row + 1), col: String(e + 1) }))
          )
        ),
      ])
    )
  }

  // Feature plots: a point per experiment, joined by a shared line, or by series, each with its own.
  const featureStyles = []
  featurePlots.forEach((featurePlot, p) => {
    const { x, series } = featurePlot
    const y = findFeature(featurePlot.y)
    const xFeature = x.kind === 'feature' ? findFeature(x.feature) : null
    const xReference = (e) => (xFeature != null ? `dg_e${e}_f${xFeature}` : `dg_e${e}_fp${p}_x`)
    let xName = 'Experiment'
    if (x.kind === 'feature') xName = x.feature.trim()
    if (x.kind === 'input') xName = withUnit(x.parameter, variables.get(numberOf(x.parameter, x.subexperiment, 0).name)?.unit)
    const seriesValues = series ? experimentIndices.map((e) => numberOf(series.parameter, series.subexperiment, e).value) : null
    const seriesKeys = seriesValues ? [...new Set(seriesValues)].sort((a, b) => a - b) : []
    if (series) {
      seriesKeys.forEach((_, k) => {
        const colour = writeColour(SERIES_COLOURS.light[k % SERIES_COLOURS.light.length])
        featureStyles.push(
          style(`style_fp${p}_series${k}`, { line: { type: 'solid', color: colour }, marker: { size: MARKER_SIZE, type: 'circle', fill: colour, lineColor: colour } })
        )
      })
    } else {
      featureStyles.push(
        style(`style_fp${p}`, {
          line: { type: 'solid', color: FEATURE_LINE_COLOUR },
          marker: { size: MARKER_SIZE, type: 'circle', fill: FEATURE_LINE_COLOUR, lineColor: FEATURE_LINE_COLOUR },
        }),
        ...experimentIndices.map((e) => style(`style_fp${p}_e${e}`, { baseStyle: `style_fp${p}`, marker: { fill: colourOf(e), lineColor: colourOf(e) } }))
      )
    }
    const curves = experimentIndices.map((e) => {
      const k = series ? seriesKeys.indexOf(seriesValues[e]) : null
      return element('curve', {
        id: `c_fp${p}_e${e}`,
        name: series ? `${series.parameter} = ${formatSedNumber(seriesValues[e])}` : labelOf(e),
        style: series ? `style_fp${p}_series${k}` : `style_fp${p}_e${e}`,
        xDataReference: xReference(e),
        yDataReference: `dg_e${e}_f${y}`,
      })
    })
    outputs.push(
      element('plot2D', { id: `plot_fp${p}`, name: featurePlot.title || featurePlot.y.trim(), legend: 'true' }, [
        element('xAxis', { type: 'linear', name: xName }),
        element('yAxis', { type: 'linear', name: featurePlot.y.trim() }),
        element('listOfCurves', {}, curves),
      ])
    )
  })

  outputs.push(
    element('report', { id: 'report' }, [
      element(
        'listOfDataSets',
        {},
        dataGenerators.map(({ id, name }) => element('dataSet', { id: `ds_${id}`, label: name, dataReference: id }))
      ),
    ])
  )

  const styles = [
    ...experimentIndices.map((e) => style(`style_e${e}`, { line: { type: 'solid', color: colourOf(e) } })),
    ...experimentIndices.flatMap((e) =>
      [1, 2]
        .filter((type) => usedLineTypes.has(`${e}:${type}`))
        .map((type) => style(`style_e${e}_l${type}`, { baseStyle: `style_e${e}`, line: { type: LINE_TYPES[type], color: colourOf(e) } }))
    ),
    ...featureStyles,
  ]

  const document = element('sedML', { xmlns: SEDML_NAMESPACE, 'xmlns:cellml': CELLML_NAMESPACE, level: '1', version: '4' }, [
    element('listOfModels', {}, [element('model', { id: MODEL_ID, language: 'urn:sedml:language:cellml.2_0', source: BUNDLE_FILES.model })]),
    element('listOfSimulations', {}, simulationElements),
    element('listOfTasks', {}, [...taskElements, ...repeatedTasks]),
    element('listOfDataGenerators', {}, dataGenerators.map(({ element: generator }) => generator)),
    element('listOfOutputs', {}, outputs),
    element('listOfStyles', {}, styles),
  ])
  return `<?xml version="1.0" encoding="UTF-8"?>\n${writeElement(document)}\n`
}

/**
 * Counts the sub-experiments every experiment of a protocol has, which a feature or an input's number can come from.
 *
 * @param {Object|null} view - The protocol, from readProtocolInfo.
 * @returns {number}
 */
export function countSharedSubexperiments(view) {
  const counts = (view?.experiments ?? []).map(({ subs }) => subs.length)
  return counts.length ? Math.min(...counts) : 0
}

/**
 * Checks the features and feature plots chosen for an export: each feature named once, with an operation, a variable
 * and a sub-experiment every experiment has; each plot of features that exist, against an input that is one number
 * in that sub-experiment of every experiment.
 *
 * @param {Object} options
 * @param {Object} options.view - The protocol, from readProtocolInfo.
 * @param {Array<Object>} options.features - As buildProtocolSedml takes them.
 * @param {Array<Object>} options.featurePlots - As buildProtocolSedml takes them.
 * @param {Iterable<string>} options.operandNames - The variables a feature can reduce, by reported name.
 * @returns {{errors: Array<{path: string, message: string}>}} `path` as `features[0].name`.
 */
export function validateExportFeatures({ view, features, featurePlots, operandNames }) {
  const errors = []
  /** Records a problem. */
  const add = (path, message) => errors.push({ path, message })
  const subCount = countSharedSubexperiments(view)
  const operands = new Set(operandNames)
  /** Whether every experiment has a sub-experiment, recording when not. */
  const checkSub = (path, s) => {
    if (Number.isInteger(s) && s >= 0 && s < subCount) return true
    add(path, `Choose a sub-experiment from 1 to ${subCount}, which every experiment has.`)
    return false
  }
  /** Checks an input is one number in a sub-experiment of every experiment. */
  const checkInput = (path, { parameter, subexperiment }) => {
    const control = view.controls.find((candidate) => candidate.parameter === parameter)
    if (!control) {
      add(`${path}.parameter`, parameter ? `${parameter} isn't an input of the protocol.` : 'Choose an input of the protocol.')
      return
    }
    if (!checkSub(`${path}.subexperiment`, subexperiment)) return
    const e = control.cells.findIndex((row) => row[subexperiment]?.kind !== 'constant')
    if (e >= 0) add(path, `${parameter} isn't a number in experiment ${e + 1}, sub-experiment ${subexperiment + 1}.`)
  }

  const names = new Set()
  features.forEach((feature, i) => {
    const path = `features[${i}]`
    const name = feature.name?.trim()
    if (!name) add(`${path}.name`, 'A feature needs a name.')
    else if (names.has(name)) add(`${path}.name`, `Another feature is already called ${name}.`)
    else names.add(name)
    if (!FEATURE_OPERATIONS.includes(feature.operation)) add(`${path}.operation`, 'Choose an operation: mean, min, max or max − min.')
    if (!operands.has(feature.operand)) add(`${path}.operand`, feature.operand ? `${feature.operand} isn't a variable of the model.` : 'Choose a variable.')
    checkSub(`${path}.subexperiment`, feature.subexperiment)
  })
  featurePlots.forEach((featurePlot, p) => {
    const path = `featurePlots[${p}]`
    if (!names.has(featurePlot.y?.trim())) add(`${path}.y`, featurePlot.y ? `No feature is called ${featurePlot.y}.` : 'Choose a feature to plot.')
    const { x, series } = featurePlot
    if (x?.kind === 'feature') {
      if (!names.has(x.feature?.trim())) add(`${path}.x.feature`, x.feature ? `No feature is called ${x.feature}.` : 'Choose a feature to plot against.')
    } else if (x?.kind === 'input') checkInput(`${path}.x`, x)
    else if (x?.kind !== 'experiment') add(`${path}.x.kind`, 'Plot against a feature, an input or the experiment.')
    if (series) checkInput(`${path}.series`, series)
  })
  return { errors }
}

/**
 * Writes the bundle's README: what it holds, how to run it, and what to know.
 *
 * @param {Object} options
 * @param {string} options.stem - The bundle's name.
 * @param {string[]} [options.warnings] - What the export warned of.
 * @param {boolean} [options.hasDrivers] - Whether the model computes some inputs itself.
 * @returns {string} Markdown.
 */
export function buildBundleReadme({ stem, warnings = [], hasDrivers = false }) {
  const warningLines = warnings.length ? warnings.map((warning) => `- ${warning}`).join('\n') : '- None.'
  const drivers = hasDrivers
    ? `\nThe model computes the protocol's ramps and traces itself, in the \`${DRIVER_COMPONENT}\` component: each driver's
\`_selector\` constant picks its input in each sub-experiment, and its \`_value\` constant is the number it takes otherwise.
`
    : ''
  return `# ${stem}: a protocol to run outside PhLynx

Exported by PhLynx. \`${BUNDLE_FILES.sedml}\` describes the protocol's run, its plots and its features in SED-ML
(Level 1 Version 4); \`${BUNDLE_FILES.script}\` runs it with Myokit and draws the plots.

## What's here

| File | What it is |
| --- | --- |
| \`${BUNDLE_FILES.sedml}\` | The protocol: each experiment as a repeated task of its warm-up and sub-experiments, with the plots, features and a report. |
| \`${BUNDLE_FILES.model}\` | The flattened model, with a \`${CLOCK_COMPONENT}\` component: \`${CLOCK_TIME}\` is 0 at the end of each warm-up. |
| \`${BUNDLE_FILES.script}\` | Runs \`${BUNDLE_FILES.sedml}\` and writes its plots and reports. |
| \`${BUNDLE_FILES.requirements}\` | The Python packages the script needs. |
| \`${BUNDLE_FILES.obsData}\` | The protocol as circulatory_autogen and CUFLynx read it, as the workspace has it. |
| \`${BUNDLE_FILES.manifest}\` | The COMBINE archive manifest: rename the zip to \`.omex\` to open it as one. |
${drivers}
## Install

Python 3.10 or later. Myokit compiles the model, so it needs a C compiler and SUNDIALS:

- macOS: \`xcode-select --install\`, then \`brew install sundials\`.
- Linux: your compiler (\`gcc\`) and SUNDIALS (\`libsundials-dev\` on Debian or Ubuntu).
- Or, anywhere: \`conda install -c conda-forge sundials\`.

Then, ideally in a virtual environment:

\`\`\`sh
python -m venv .venv
source .venv/bin/activate
pip install -r ${BUNDLE_FILES.requirements}
\`\`\`

(\`pip install myokit\` alone installs Myokit; see https://myokit.org/install for more on SUNDIALS.)

## Run

\`\`\`sh
python ${BUNDLE_FILES.script}
\`\`\`

- \`--out DIR\`: where to write the results (\`results/\` by default).
- \`--no-show\`: write the figures without opening them.
- \`--format png,svg,pdf\`: the figure formats to write.
- \`--dpi N\`: the resolution of bitmap figures.
- \`--verbose\`: say what runs as it runs.

## Outputs

In \`results/\`: a figure for each plot (the trace plots, a grid of them when experiments have their own, and each
feature plot), a CSV for the report (every data generator: each experiment's time, traces and features), a tidy
\`traces.csv\`, and \`run_info.json\` with the versions used and how long each part took.

## Warnings from the export

${warningLines}

## Known limits

- A segment that keeps only its last point is written with its output starting and ending at that point;
  \`${BUNDLE_FILES.script}\` reads such a time course as one point. Its sub-task's id ends with \`_single\`.
- A feature over a sub-experiment after the first leaves out that sub-experiment's first point, which belongs to the
  one before, as PhLynx joins them.
- Other SED-ML tools don't yet run nested repeated tasks whose sub-tasks change the model faithfully: some ignore a
  sub-task's changes, others run sub-tasks independently. libOpenCOR will run \`${BUNDLE_FILES.sedml}\` directly once
  it supports RepeatedTask.
- \`${BUNDLE_FILES.obsData}\` is for circulatory_autogen and CUFLynx; the script doesn't read it.
`
}

/**
 * Bundles a protocol's SED-ML with its model, the script that runs it, and the workspace's obs_data.json.
 *
 * @param {Object} options
 * @param {string} options.sedml - From buildProtocolSedml.
 * @param {string} options.cellml - The model with its drivers and clock.
 * @param {string} options.script - run_sedml.py.
 * @param {ArrayBuffer|string|null} options.obsDataPayload - The workspace's obs_data.json, byte for byte, or null.
 * @param {string} options.readme - From buildBundleReadme.
 * @returns {Promise<Blob>}
 */
export async function generateProtocolSedmlZip({ sedml, cellml, script, obsDataPayload, readme }) {
  const zip = new JSZip()
  const entries = [
    { location: BUNDLE_FILES.sedml, format: 'http://identifiers.org/combine.specifications/sed-ml', master: true, content: sedml },
    { location: BUNDLE_FILES.model, format: 'http://identifiers.org/combine.specifications/cellml', content: cellml },
    { location: BUNDLE_FILES.script, format: 'text/x-python', content: script },
    { location: BUNDLE_FILES.requirements, format: 'text/plain', content: BUNDLE_REQUIREMENTS },
    { location: BUNDLE_FILES.readme, format: 'text/markdown', content: readme },
    obsDataPayload != null && { location: BUNDLE_FILES.obsData, format: 'application/json', content: obsDataPayload },
  ].filter(Boolean)
  entries.forEach(({ location, content }) => zip.file(location, content))
  zip.file(BUNDLE_FILES.manifest, buildManifestXml(entries))
  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 9 } })
}
