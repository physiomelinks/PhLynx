/**
 * How simulation settings become SED values, shared by the in-app engine and the SED-ML export so that
 * PhLynx and web OpenCOR run the same simulation.
 */

/**
 * The solvers a simulation can use: CVODE, or a fixed-step method. `kisaoId` names it in SED-ML and
 * `className` in libOpenCOR.
 */
export const SOLVERS = {
  CVODE: { label: 'CVODE', kisaoId: 'KISAO:0000019', className: 'SolverCvode', isFixedStep: false },
  Euler: { label: 'Forward Euler', kisaoId: 'KISAO:0000030', className: 'SolverForwardEuler', isFixedStep: true },
  Heun: { label: 'Heun', kisaoId: 'KISAO:0000301', className: 'SolverHeun', isFixedStep: true },
  RungeKutta2: { label: 'Second-order Runge–Kutta', kisaoId: 'KISAO:0000381', className: 'SolverSecondOrderRungeKutta', isFixedStep: true },
  RungeKutta4: { label: 'Fourth-order Runge–Kutta', kisaoId: 'KISAO:0000032', className: 'SolverFourthOrderRungeKutta', isFixedStep: true },
}

/**
 * The solver settings exports always used before they could be changed, and still the defaults: CVODE, a
 * tolerance of 1e-7, at most 500 steps between output points, and no limit on a step (0).
 */
export const DEFAULT_SOLVER_SETTINGS = Object.freeze({ solver: 'CVODE', timeStep: 0, tolerance: 1e-7, maxSteps: 500 })

// The most steps CVODE can be allowed: libOpenCOR holds the number as a 32-bit integer.
export const MAX_SOLVER_STEPS = 2 ** 31 - 1

// The KiSAO id of a fixed-step solver's step.
const FIXED_STEP_KISAO_ID = 'KISAO:0000483'

// The KiSAO ids of the CVODE settings that can be changed, with the simulation setting each one sets.
const CVODE_SETTING_KISAO_IDS = { 'KISAO:0000209': 'tolerance', 'KISAO:0000415': 'maxSteps', 'KISAO:0000467': 'timeStep' }

// The CVODE settings that can't be changed, as written in SED-ML.
const FIXED_CVODE_PARAMETERS = [
  { kisaoId: 'KISAO:0000475', name: 'integrationMethod', value: 'BDF' },
  { kisaoId: 'KISAO:0000476', name: 'iterationType', value: 'Newton' },
  { kisaoId: 'KISAO:0000477', name: 'linearSolver', value: 'Dense' },
  { kisaoId: 'KISAO:0000478', name: 'preconditioner', value: 'Banded' },
  { kisaoId: 'KISAO:0000479', name: 'upperHalfBandwidth', value: '0' },
  { kisaoId: 'KISAO:0000480', name: 'lowerHalfBandwidth', value: '0' },
  { kisaoId: 'KISAO:0000481', name: 'interpolateSolution', value: 'true' },
]

/**
 * Writes a number as SED-ML text, with a two-digit exponent as the export has always written them (1e-07).
 *
 * @param {number} value
 * @returns {string}
 */
export const formatSedNumber = (value) => String(value).replace(/e([+-])(\d)$/, 'e$10$2')

/**
 * Gets the solver settings to run with, taking the defaults for any a settings object lacks.
 *
 * @param {Object} settings - Simulation settings.
 * @returns {{solver: string, timeStep: number, tolerance: number, maxSteps: number}}
 */
export function resolveSolverSettings(settings) {
  const pick = (name) => settings?.[name] ?? DEFAULT_SOLVER_SETTINGS[name]
  return { solver: pick('solver'), timeStep: pick('timeStep'), tolerance: pick('tolerance'), maxSteps: pick('maxSteps') }
}

/**
 * Finds what stops the solver settings from being used, if anything. A setting a settings object lacks
 * takes its default, but one cleared in Simulation Settings (null) needs a value.
 *
 * @param {Object} settings - Simulation settings.
 * @returns {string|null} The problem, or null when there is none.
 */
export function findSolverSettingsProblem(settings) {
  const solver = SOLVERS[resolveSolverSettings(settings).solver]
  if (!solver) return `The simulation settings name a solver PhLynx doesn’t know: ${settings.solver}.`
  const value = (name) => (settings?.[name] === undefined ? DEFAULT_SOLVER_SETTINGS[name] : settings[name])
  const isNumber = (candidate) => typeof candidate === 'number' && Number.isFinite(candidate)
  const timeStep = value('timeStep')
  if (solver.isFixedStep) return isNumber(timeStep) && timeStep > 0 ? null : `${solver.label} needs a time step above 0.`
  const tolerance = value('tolerance')
  const maxSteps = value('maxSteps')
  if (!isNumber(tolerance) || tolerance <= 0) return 'CVODE needs a tolerance above 0.'
  if (!Number.isInteger(maxSteps) || maxSteps < 1 || maxSteps > MAX_SOLVER_STEPS) {
    return `CVODE needs a maximum number of steps from 1 to ${MAX_SOLVER_STEPS}.`
  }
  if (!isNumber(timeStep) || timeStep < 0) return 'CVODE needs a maximum step of 0 or more; 0 means no limit.'
  return null
}

/**
 * Reads the solver settings from a SED-ML algorithm, as buildAlgorithm writes them. A solver PhLynx doesn't
 * offer gives none, and a parameter the algorithm leaves out isn't given.
 *
 * @param {string} kisaoId - The algorithm's KiSAO id.
 * @param {Map<string, string>} parameters - Its parameters' values, by KiSAO id.
 * @returns {Object} Some of `{ solver, timeStep, tolerance, maxSteps }`.
 */
export function readSolverSettings(kisaoId, parameters) {
  const entry = Object.entries(SOLVERS).find(([, solver]) => solver.kisaoId === kisaoId)
  if (!entry) return {}
  const [solverName, solver] = entry
  const settingIds = solver.isFixedStep ? { [FIXED_STEP_KISAO_ID]: 'timeStep' } : CVODE_SETTING_KISAO_IDS
  const settings = { solver: solverName }
  for (const [parameterId, name] of Object.entries(settingIds)) {
    const value = Number.parseFloat(parameters.get(parameterId))
    if (Number.isFinite(value)) settings[name] = value
  }
  return settings
}

/**
 * Builds a simulation's algorithm from its settings: the solver, and its parameters with their KiSAO ids,
 * libOpenCOR's names for them, and their values as SED-ML text.
 *
 * @param {Object} settings - Simulation settings.
 * @returns {{solver: Object, parameters: Array<{kisaoId: string, name: string, value: string}>}}
 */
export function buildAlgorithm(settings) {
  const { solver: solverName, timeStep, tolerance, maxSteps } = resolveSolverSettings(settings)
  const solver = SOLVERS[solverName]
  if (!solver) throw new Error(`Unknown solver '${solverName}'.`)
  if (solver.isFixedStep) {
    return { solver, parameters: [{ kisaoId: FIXED_STEP_KISAO_ID, name: 'step', value: formatSedNumber(timeStep) }] }
  }
  return {
    solver,
    parameters: [
      { kisaoId: 'KISAO:0000209', name: 'relativeTolerance', value: formatSedNumber(tolerance) },
      { kisaoId: 'KISAO:0000211', name: 'absoluteTolerance', value: formatSedNumber(tolerance) },
      { kisaoId: 'KISAO:0000415', name: 'maximumNumberOfSteps', value: formatSedNumber(maxSteps) },
      { kisaoId: 'KISAO:0000467', name: 'maximumStep', value: formatSedNumber(timeStep) },
      ...FIXED_CVODE_PARAMETERS,
    ],
  }
}

/**
 * Builds a uniform time course from the simulation settings. The times are passed on as given, as the
 * SED-ML export has always written them.
 *
 * @param {{initialPoint: number, startingPoint: number, endingPoint: number, pointInterval: number}} settings
 * @returns {{initialTime: number, outputStartTime: number, outputEndTime: number, numberOfSteps: number}}
 */
export function buildUniformTimeCourse(settings) {
  return {
    initialTime: settings.initialPoint,
    outputStartTime: settings.startingPoint,
    outputEndTime: settings.endingPoint,
    // Web OpenCOR counts steps this way too, so the two give the same points.
    numberOfSteps: Math.floor((settings.endingPoint - settings.startingPoint) / settings.pointInterval),
  }
}
