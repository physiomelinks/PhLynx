import { describe, expect, it, vi } from 'vitest'

import {
  checkSettings,
  countComputedPoints,
  createSimulationSession,
  MAX_RESULT_BYTES,
  SimulationError,
  startSimulation,
} from '../../../../src/services/simulation/engine.js'

const SETTINGS = { initialPoint: 0, startingPoint: 0, endingPoint: 2, pointInterval: 0.5 }

/**
 * Builds a fake libOpenCOR: a decay model whose run takes `pollsToFinish` polls, recording what is freed.
 *
 * @param {Object} [options]
 * @returns {{loc: Object, freed: string[], solver: Object, simulation: Object, unmanaged: Array}}
 */
function createFakeLibOpenCOR({ fileErrors = [], instanceErrors = [], voiName = 'c/t', pollsToFinish = 2, stateCount = 1, steadyState = false } = {}) {
  const freed = []
  const unmanaged = []
  const logger = (name, errors) => ({
    hasErrors: errors.length > 0,
    issueCount: errors.length,
    issue: (i) => ({ typeAsString: 'Error', description: errors[i], delete: () => freed.push(`${name} issue`) }),
    delete: () => freed.push(name),
  })
  class SolverCvode {}
  const solver = Object.assign(new SolverCvode(), { delete: () => freed.push('solver') })
  class SedSteadyState {}
  const simulation = Object.assign(steadyState ? new SedSteadyState() : {}, { odeSolver: solver, delete: () => freed.push('simulation') })
  const model = {
    changes: [],
    addChange(change) {
      this.changes.push(change)
      return true
    },
    removeAllChanges() {
      this.changes = []
      return true
    },
    delete: () => freed.push('model'),
  }
  let polls = 0
  const voi = new Float64Array([0, 0.5, 1, 1.5, 2])
  const task = {
    voiName,
    voiUnit: 'second',
    voi,
    stateCount,
    stateName: () => 'c/x',
    stateUnit: () => 'metre',
    state: () => new Float64Array([1, 0.8, 0.6, 0.5, 0.4]),
    rateCount: 0,
    constantCount: 0,
    computedConstantCount: 0,
    algebraicVariableCount: 0,
    delete: () => freed.push('task'),
  }
  let isRunning = false
  const instance = {
    ...logger('instance', instanceErrors),
    startRun: vi.fn(() => (isRunning = true)),
    stopRun: vi.fn(() => freed.push('stopRun')),
    waitForRun: () => 12,
    get status() {
      if (isRunning && polls++ >= pollsToFinish) isRunning = false
      return { value: isRunning ? 1 : 0 }
    },
    progress: 0.5,
    task: () => task,
  }
  const loc = {
    SedSteadyState,
    File: class {
      constructor(name) {
        Object.assign(this, logger('file', fileErrors), { name })
        this.setContents = vi.fn()
      }
    },
    SedDocument: class {
      constructor() {
        Object.assign(this, logger('document', []))
      }

      simulation() {
        return simulation
      }

      model() {
        return model
      }

      instantiate() {
        return instance
      }
    },
    SedChangeAttribute: class SedChangeAttribute {
      constructor(componentName, variableName, newValue) {
        Object.assign(this, { componentName, variableName, newValue })
      }

      delete() {
        freed.push('change')
      }
    },
    SolverForwardEuler: class SolverForwardEuler {
      delete() {
        freed.push('new solver')
      }
    },
    SolverCvode: Object.assign(SolverCvode, {
      IntegrationMethod: { BDF: 'bdf' },
      IterationType: { NEWTON: 'newton' },
      LinearSolver: { DENSE: 'dense' },
      Preconditioner: { BANDED: 'banded' },
    }),
    FileManager: {
      instance: () => ({
        unmanage: (file) => {
          freed.push('unmanage file')
          unmanaged.push(file.name)
        },
        delete: () => freed.push('file manager'),
      }),
    },
  }
  return { loc, freed, solver, simulation, model, instance, task, unmanaged }
}

const failureOf = (promise) => promise.then(
  () => null,
  (error) => error
)

describe('startSimulation', () => {
  it('copies the results out of libOpenCOR’s memory, which the run frees', async () => {
    const fake = createFakeLibOpenCOR()
    const state = new Float64Array([1, 0.8, 0.6, 0.5, 0.4])
    fake.task.state = () => state

    const result = await startSimulation({ module: fake.loc, cellml: '<model/>', settings: SETTINGS }).promise
    fake.task.voi.fill(-1)
    state.fill(-1)

    expect([...result.voi.values]).toEqual([0, 0.5, 1, 1.5, 2])
    expect([...result.variables.get('c/x').values]).toEqual([1, 0.8, 0.6, 0.5, 0.4])
  })

  it('rejects settings without a time course to run, before starting it', async () => {
    const fake = createFakeLibOpenCOR()

    const error = await failureOf(startSimulation({ module: fake.loc, cellml: '<model/>', settings: { ...SETTINGS, endingPoint: 0 } }).promise)

    expect(error.message).toMatch(/end after the start/)
    expect(fake.instance.startRun).not.toHaveBeenCalled()
  })

  it('frees everything when the instance can’t be made', async () => {
    const fake = createFakeLibOpenCOR({ instanceErrors: ['Unsupported model.'] })

    const error = await failureOf(startSimulation({ module: fake.loc, cellml: '<model/>', settings: SETTINGS }).promise)

    expect(error.issues).toEqual([{ type: 'Error', description: 'Unsupported model.' }])
    expect(fake.freed).toEqual(['instance issue', 'solver', 'instance', 'model', 'simulation', 'document', 'unmanage file', 'file manager', 'file'])
  })

  it('gives each run its own file', async () => {
    const fake = createFakeLibOpenCOR()

    await startSimulation({ module: fake.loc, cellml: '<model/>', settings: SETTINGS }).promise
    await startSimulation({ module: fake.loc, cellml: '<model/>', settings: SETTINGS }).promise

    expect(new Set(fake.unmanaged).size).toBe(2)
  })

  it('returns no points when stopped before the run starts', async () => {
    const fake = createFakeLibOpenCOR()
    const run = startSimulation({ module: fake.loc, cellml: '<model/>', settings: SETTINGS })
    run.stop()

    const result = await run.promise

    expect(fake.instance.startRun).not.toHaveBeenCalled()
    expect(result.isStopped).toBe(true)
    expect(result.voi.values).toHaveLength(0)
  })

  it('stops a run before freeing it when onProgress throws', async () => {
    const fake = createFakeLibOpenCOR({ pollsToFinish: 5 })
    const onProgress = () => {
      throw new Error('The page went away.')
    }

    const error = await failureOf(startSimulation({ module: fake.loc, cellml: '<model/>', settings: SETTINGS, onProgress }).promise)

    expect(error.message).toBe('The page went away.')
    expect(fake.freed.indexOf('stopRun')).toBeLessThan(fake.freed.indexOf('instance'))
  })

  it('runs the model with the shared settings and returns its results', async () => {
    const fake = createFakeLibOpenCOR()
    const progress = []

    const result = await startSimulation({ module: fake.loc, cellml: '<model/>', settings: SETTINGS, onProgress: (p) => progress.push(p) }).promise

    expect(fake.simulation).toMatchObject({ initialTime: 0, outputStartTime: 0, outputEndTime: 2, numberOfSteps: 4 })
    expect(fake.solver).toMatchObject({
      relativeTolerance: 1e-7,
      absoluteTolerance: 1e-7,
      maximumNumberOfSteps: 500,
      maximumStep: 0,
      integrationMethod: 'bdf',
      iterationType: 'newton',
      linearSolver: 'dense',
      preconditioner: 'banded',
      interpolateSolution: true,
    })
    expect(result.voi).toMatchObject({ name: 'c/t', unit: 'second' })
    expect([...result.voi.values]).toEqual([0, 0.5, 1, 1.5, 2])
    expect(result.variables.get('c/x')).toMatchObject({ kind: 'state', unit: 'metre' })
    expect(result).toMatchObject({ elapsedMs: 12, isStopped: false, issues: [] })
    expect(progress).toEqual([0.5, 0.5, 1])
  })

  it('frees every libOpenCOR object it made, and releases the file', async () => {
    const fake = createFakeLibOpenCOR()

    await startSimulation({ module: fake.loc, cellml: '<model/>', settings: SETTINGS }).promise

    // The run's objects go when it ends, and the model's when its session does.
    expect(fake.freed).toEqual(['task', 'solver', 'instance', 'model', 'simulation', 'document', 'unmanage file', 'file manager', 'file'])
    expect(fake.unmanaged).toEqual([expect.stringMatching(/^phlynx-simulation-\d+\.cellml$/)])
  })

  it('rejects an unreadable model with its issues, still freeing what it made', async () => {
    const fake = createFakeLibOpenCOR({ fileErrors: ['Not a CellML file.'] })

    const error = await failureOf(startSimulation({ module: fake.loc, cellml: 'nonsense', settings: SETTINGS }).promise)

    expect(error).toBeInstanceOf(SimulationError)
    expect(error.issues).toEqual([{ type: 'Error', description: 'Not a CellML file.' }])
    expect(fake.freed).toEqual(['file issue', 'unmanage file', 'file manager', 'file'])
  })

  it('rejects a model with nothing to simulate over time', async () => {
    const fake = createFakeLibOpenCOR({ voiName: '' })

    const error = await failureOf(startSimulation({ module: fake.loc, cellml: '<model/>', settings: SETTINGS }).promise)

    expect(error.message).toMatch(/no differential equation/)
    expect(fake.instance.startRun).not.toHaveBeenCalled()
  })

  it('solves a model without ODEs once, as a steady state, whatever the time settings', async () => {
    const fake = createFakeLibOpenCOR({ voiName: '', steadyState: true, stateCount: 0 })
    fake.task.voi = new Float64Array()
    Object.assign(fake.task, {
      computedConstantCount: 1,
      computedConstantName: () => 'c/y',
      computedConstantUnit: () => 'metre',
      computedConstant: () => new Float64Array([6]),
    })

    const settings = { ...SETTINGS, endingPoint: 0 }
    const result = await startSimulation({ module: fake.loc, cellml: '<model/>', settings }).promise

    expect(result.isSteadyState).toBe(true)
    expect(result.voi.values).toHaveLength(0)
    expect(result.variables.get('c/y')).toEqual({ kind: 'computedConstant', unit: 'metre', values: new Float64Array([6]) })
    expect(fake.simulation.numberOfSteps).toBeUndefined()
  })

  it('sweeps a constant of a model without ODEs, solving it once per value', async () => {
    const fake = createFakeLibOpenCOR({ voiName: '', steadyState: true, stateCount: 0 })
    fake.task.voi = new Float64Array()
    const swept = () => Number(fake.model.changes.find((change) => change.variableName === 'a').newValue)
    Object.assign(fake.task, {
      constantCount: 1,
      constantName: () => 'c/a',
      constantUnit: () => 'volt',
      constant: () => new Float64Array([swept()]),
      computedConstantCount: 1,
      computedConstantName: () => 'c/y',
      computedConstantUnit: () => 'metre',
      computedConstant: () => new Float64Array([2 * swept()]),
    })
    const onProgress = vi.fn()

    const session = createSimulationSession({ module: fake.loc, cellml: '<model/>' })
    const changes = [{ component: 'c', variable: 'a', value: 99 }, { component: 'c', variable: 'k', value: 1 }]
    const sweep = { component: 'c', variable: 'a', values: [1, 2, 3] }
    const result = await session.run({ settings: SETTINGS, changes, sweep, onProgress }).promise
    session.dispose()

    expect(result).toMatchObject({ isSteadyState: true, isSweep: true, isStopped: false })
    expect(result.voi).toEqual({ name: 'c/a', unit: 'volt', values: new Float64Array([1, 2, 3]) })
    expect([...result.variables.get('c/y').values]).toEqual([2, 4, 6])
    // The swept value replaces a slider's, and the other changes stay.
    expect(fake.model.changes.map((change) => [change.variableName, change.newValue])).toEqual([['k', '1'], ['a', '3']])
    expect(onProgress.mock.calls.map(([value]) => value)).toEqual([1 / 3, 2 / 3, 1])
  })

  /**
   * Builds a fake model without ODEs whose c/y is twice its swept constant c/a.
   *
   * @returns {Object} As createFakeLibOpenCOR.
   */
  function createSweepFake() {
    const fake = createFakeLibOpenCOR({ voiName: '', steadyState: true, stateCount: 0 })
    fake.task.voi = new Float64Array()
    const swept = () => Number(fake.model.changes.find((change) => change.variableName === 'a').newValue)
    Object.assign(fake.task, {
      computedConstantCount: 1,
      computedConstantName: () => 'c/y',
      computedConstantUnit: () => 'metre',
      computedConstant: () => new Float64Array([2 * swept()]),
    })
    return fake
  }

  const SWEEP = { component: 'c', variable: 'a', values: [1, 2, 3] }

  it('drops the point a sweep was stopped during, and reports it stopped', async () => {
    const fake = createSweepFake()
    const start = fake.instance.startRun.getMockImplementation()
    const session = createSimulationSession({ module: fake.loc, cellml: '<model/>' })
    fake.instance.startRun.mockImplementation(() => {
      const started = start()
      if (fake.instance.startRun.mock.calls.length === 3) run.stop()
      return started
    })

    const run = session.run({ settings: SETTINGS, sweep: SWEEP })
    const result = await run.promise
    session.dispose()

    expect(result).toMatchObject({ isSweep: true, isStopped: true })
    expect([...result.voi.values]).toEqual([1, 2])
    expect([...result.variables.get('c/y').values]).toEqual([2, 4])
  })

  it('keeps what a failed sweep solved, as a sweep', async () => {
    const fake = createSweepFake()
    fake.instance.waitForRun = () => {
      if (fake.instance.startRun.mock.calls.length === 3) Object.assign(fake.instance, { hasErrors: true, issueCount: 0 })
      return 1
    }
    const session = createSimulationSession({ module: fake.loc, cellml: '<model/>' })

    const error = await failureOf(session.run({ settings: SETTINGS, sweep: SWEEP }).promise)
    session.dispose()

    expect(error.message).toBe('The model could not be solved at c/a = 3.')
    expect(error.partialResults).toMatchObject({ isSteadyState: true, isSweep: true })
    expect([...error.partialResults.variables.get('c/y').values]).toEqual([2, 4])
  })

  it('reports a steady state stopped while it solves as stopped', async () => {
    const fake = createFakeLibOpenCOR({ voiName: '', steadyState: true, stateCount: 0, pollsToFinish: 3 })
    fake.task.voi = new Float64Array()
    const start = fake.instance.startRun.getMockImplementation()
    fake.instance.startRun.mockImplementation(() => {
      const started = start()
      run.stop()
      return started
    })

    const run = startSimulation({ module: fake.loc, cellml: '<model/>', settings: SETTINGS })
    const result = await run.promise

    expect(fake.instance.stopRun).toHaveBeenCalled()
    expect(result).toMatchObject({ isSteadyState: true, isStopped: true })
  })

  it('rejects a run whose results wouldn’t fit in memory, before starting it', async () => {
    const fake = createFakeLibOpenCOR({ stateCount: 1000 })
    const settings = { ...SETTINGS, endingPoint: MAX_RESULT_BYTES / 8 / 1000, pointInterval: 1 }

    const error = await failureOf(startSimulation({ module: fake.loc, cellml: '<model/>', settings }).promise)

    expect(error.message).toMatch(/GB of memory/)
    expect(fake.instance.startRun).not.toHaveBeenCalled()
  })

  it('keeps the points computed before the solver failed', async () => {
    const fake = createFakeLibOpenCOR()
    fake.task.voi = new Float64Array([0, 0.5, 1, 0, 0])
    fake.instance.waitForRun = () => {
      Object.assign(fake.instance, { hasErrors: true, issueCount: 0 })
      return 3
    }

    const error = await failureOf(startSimulation({ module: fake.loc, cellml: '<model/>', settings: SETTINGS }).promise)

    expect([...error.partialResults.voi.values]).toEqual([0, 0.5, 1])
    expect([...error.partialResults.variables.get('c/x').values]).toEqual([1, 0.8, 0.6])
  })

  it('reports a run the solver failed', async () => {
    const fake = createFakeLibOpenCOR({ instanceErrors: [] })
    fake.instance.waitForRun = () => {
      Object.assign(fake.instance, { hasErrors: true, issueCount: 1 })
      return 3
    }

    const error = await failureOf(startSimulation({ module: fake.loc, cellml: '<model/>', settings: SETTINGS }).promise)

    expect(error.message).toBe('The simulation failed.')
  })

  it('suggests a smaller point interval when the solver takes too many steps', async () => {
    const failingFake = () => {
      const fake = createFakeLibOpenCOR()
      fake.instance.waitForRun = () => {
        Object.assign(fake.instance, {
          hasErrors: true,
          issueCount: 1,
          issue: () => ({ typeAsString: 'Error', description: 'Task | CVODE: at t = 6.7, mxstep steps taken before reaching tout.', delete: () => {} }),
        })
        return 3
      }
      return fake
    }

    const error = await failureOf(startSimulation({ module: failingFake().loc, cellml: '<model/>', settings: SETTINGS }).promise)

    expect(error.message).toMatch(/more than 500 steps between two output points\. Try a smaller point interval, or allow more steps/)
    expect(error.issues[0].description).toMatch(/mxstep/)

    const custom = await failureOf(startSimulation({ module: failingFake().loc, cellml: '<model/>', settings: { ...SETTINGS, maxSteps: 2000 } }).promise)
    expect(custom.message).toMatch(/more than 2000 steps/)
  })

  it('applies the CVODE settings it is given', async () => {
    const fake = createFakeLibOpenCOR()

    await startSimulation({ module: fake.loc, cellml: '<model/>', settings: { ...SETTINGS, tolerance: 1e-9, maxSteps: 5000, timeStep: 0.01 } }).promise

    expect(fake.solver).toMatchObject({ relativeTolerance: 1e-9, absoluteTolerance: 1e-9, maximumNumberOfSteps: 5000, maximumStep: 0.01 })
  })

  it('puts a fixed-step solver in CVODE’s place, with its step, and frees it', async () => {
    const fake = createFakeLibOpenCOR()

    await startSimulation({ module: fake.loc, cellml: '<model/>', settings: { ...SETTINGS, solver: 'Euler', timeStep: 0.001 } }).promise

    expect(fake.simulation.odeSolver.constructor.name).toBe('SolverForwardEuler')
    expect(fake.simulation.odeSolver.step).toBe(0.001)
    expect(fake.simulation.odeSolver.relativeTolerance).toBeUndefined()
    expect(fake.freed).toEqual(expect.arrayContaining(['solver', 'new solver']))
  })

  it('stops a run, keeping the points it computed', async () => {
    const fake = createFakeLibOpenCOR({ pollsToFinish: 3 })
    fake.task.voi = new Float64Array([0, 0.5, 1, 0, 0])
    const run = startSimulation({ module: fake.loc, cellml: '<model/>', settings: SETTINGS, onProgress: () => run.stop() })

    const result = await run.promise

    expect(fake.instance.stopRun).toHaveBeenCalled()
    expect(result.isStopped).toBe(true)
    expect([...result.voi.values]).toEqual([0, 0.5, 1])
    expect([...result.variables.get('c/x').values]).toEqual([1, 0.8, 0.6])
  })
})

describe('createSimulationSession', () => {
  it('reruns its model with new parameter changes, freeing each run’s objects as it ends', async () => {
    const fake = createFakeLibOpenCOR()
    const session = createSimulationSession({ module: fake.loc, cellml: '<model/>' })

    await session.run({ settings: SETTINGS, changes: [{ component: 'instance_parameters', variable: 'k', value: 2 }] }).promise
    await session.run({ settings: SETTINGS, changes: [{ component: 'instance_parameters', variable: 'k', value: 3 }] }).promise

    expect(fake.model.changes.map((change) => [change.componentName, change.variableName, change.newValue])).toEqual([['instance_parameters', 'k', '3']])
    expect(fake.freed).toEqual(['task', 'solver', 'instance', 'change', 'task', 'solver', 'instance'])
    expect(fake.unmanaged).toEqual([])

    session.dispose()
    expect(fake.freed.slice(7)).toEqual(['change', 'model', 'simulation', 'document', 'unmanage file', 'file manager', 'file'])
  })
})

describe('checkSettings', () => {
  it.each([
    ['a cleared start', { startingPoint: null }, /needs a value/],
    ['a cleared initial time', { initialPoint: null }, /needs a value/],
    ['an end before the start', { startingPoint: 0, endingPoint: -10, pointInterval: -1 }, /end after the start/],
    ['a negative interval', { pointInterval: -0.5 }, /above 0/],
    ['an interval longer than the time course', { pointInterval: 5 }, /longer than/],
    ['an initial time after the start', { initialPoint: 1 }, /can’t be after the start/],
    ['an unknown solver', { solver: 'Leapfrog' }, /doesn’t know: Leapfrog/],
    ['a fixed-step solver without a step', { solver: 'RungeKutta4', timeStep: 0 }, /Fourth-order Runge–Kutta needs a time step above 0/],
    ['a zero tolerance', { tolerance: 0 }, /tolerance above 0/],
    ['a fractional number of steps', { maxSteps: 2.5 }, /from 1 to 2147483647/],
    ['more steps than libOpenCOR can hold', { maxSteps: 2 ** 31 }, /from 1 to 2147483647/],
    ['a negative maximum step', { timeStep: -1 }, /maximum step of 0 or more/],
    ['a cleared tolerance', { tolerance: null }, /tolerance above 0/],
    ['a cleared step', { solver: 'Euler', timeStep: null }, /Forward Euler needs a time step above 0/],
  ])('rejects %s', (_, change, message) => {
    expect(() => checkSettings({ ...SETTINGS, ...change })).toThrow(message)
  })

  it('takes the default solver settings for any the settings lack', () => {
    expect(() => checkSettings(SETTINGS)).not.toThrow()
    expect(() => checkSettings({ ...SETTINGS, maxSteps: 2 ** 31 - 1 })).not.toThrow()
    expect(() => checkSettings({ ...SETTINGS, solver: 'Heun', timeStep: 0.1, tolerance: 0 })).not.toThrow()
  })

  it('accepts a time course that starts before zero', () => {
    expect(() => checkSettings({ initialPoint: -2, startingPoint: -1, endingPoint: 1, pointInterval: 0.5 })).not.toThrow()
  })
})

describe('countComputedPoints', () => {
  const course = (outputStartTime, outputEndTime, numberOfSteps) => ({ outputStartTime, outputEndTime, numberOfSteps })

  it('counts the points that lie on the time course’s output times', () => {
    expect(countComputedPoints(new Float64Array([0, 1, 2, 3]), course(0, 3, 3))).toBe(4)
    expect(countComputedPoints(new Float64Array([0, 1, 0, 0]), course(0, 3, 3))).toBe(2)
    expect(countComputedPoints(new Float64Array([]), course(0, 3, 3))).toBe(0)
  })

  it('stops at the unfilled points of a time course before zero', () => {
    expect(countComputedPoints(new Float64Array([-10, -9.5, -9, 0, 0]), course(-10, -8, 4))).toBe(3)
    expect(countComputedPoints(new Float64Array([-1, -0.5, 0, 0, 0]), course(-1, 1, 4))).toBe(3)
  })
})
