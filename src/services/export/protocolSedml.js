/**
 * Writes a protocol's run as SED-ML (Level 1 Version 4), with its trace plots, as a record of PhLynx's own run. It
 * follows PhLynx's plan (compileProtocolPlan): each experiment is a repeated task of its warm-up and its
 * sub-experiments, and each segment of those a sub-task that sets its values first.
 */
import { nameExperiment, resolveExperimentColour } from '@physiomelinks/protocol-kit'

import { CLOCK_OFFSET, CLOCK_TIME } from '../simulation/protocolDriverModel'
import { buildAlgorithm, formatSedNumber } from '../simulation/sedParameters'
import { SERIES_COLOURS } from '../simulation/seriesSlots'

/** The model the SED-ML runs: the scope with its drivers and the protocol's clock written in. */
export const SEDML_MODEL = 'protocol_model.cellml'

const SEDML_NAMESPACE = 'http://sed-ml.org/sed-ml/level1/version4'
const CELLML_NAMESPACE = 'http://www.cellml.org/cellml/2.0#'
const MATHML_NAMESPACE = 'http://www.w3.org/1998/Math/MathML'
const MODEL_ID = 'model'

// How the traces sharing a plot are told apart when they share an experiment's colour.
const LINE_TYPES = ['solid', 'dash', 'dot']
const LINE_THICKNESS = '1.5'

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
 * before it starts its output a point later. One that has only that point and its last keeps its last alone, a
 * single point its output starts and ends on.
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
 * @returns {Object}
 */
const variable = (id, name, taskReference) => element('variable', { id, target: writeTarget(name), taskReference })

/**
 * Makes a line style.
 *
 * @param {string} id
 * @param {{baseStyle?: string, line: {type: string, color: string}}} options
 * @returns {Object}
 */
const style = (id, { baseStyle, line }) =>
  element('style', { id, baseStyle }, [element('line', { type: line.type, color: line.color, thickness: LINE_THICKNESS })])

/**
 * Builds the SED-ML of a protocol's run, with its trace plots and a report of them.
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
 * @param {boolean} options.overlay - Whether every experiment shares each trace plot, or each has its own.
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
  overlay,
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

  // Data generators: each experiment's time, inputs and traces.
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
  ]

  const document = element('sedML', { xmlns: SEDML_NAMESPACE, 'xmlns:cellml': CELLML_NAMESPACE, level: '1', version: '4' }, [
    element('listOfModels', {}, [element('model', { id: MODEL_ID, language: 'urn:sedml:language:cellml.2_0', source: SEDML_MODEL })]),
    element('listOfSimulations', {}, simulationElements),
    element('listOfTasks', {}, [...taskElements, ...repeatedTasks]),
    element('listOfDataGenerators', {}, dataGenerators.map(({ element: generator }) => generator)),
    element('listOfOutputs', {}, outputs),
    element('listOfStyles', {}, styles),
  ])
  return `<?xml version="1.0" encoding="UTF-8"?>\n${writeElement(document)}\n`
}
