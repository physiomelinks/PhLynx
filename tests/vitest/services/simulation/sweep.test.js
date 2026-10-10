import { describe, expect, it } from 'vitest'

import {
  createSweep,
  findSweepProblem,
  isSweepableRow,
  MAX_SWEEP_POINTS,
  resolveSweepTarget,
  sweepLabel,
  sweepValues,
} from '../../../../src/services/simulation/sweep.js'

const node = (id, name, variables) => ({ id, data: { name, variables } })

describe('isSweepableRow', () => {
  it('sweeps what has a value of its own, not what the model computes', () => {
    for (const type of ['constant', 'global_constant', 'boundary_condition']) expect(isSweepableRow({ name: 'x', type }), type).toBe(true)
    expect(isSweepableRow({ name: 'x', type: 'variable' })).toBe(false)
  })
})

describe('createSweep', () => {
  it('spans half the value either side', () => {
    const sweep = createSweep(node('n1', 'cell', []), { name: 'V', type: 'boundary_condition', units: 'millivolt', value: '-80' }, () => null)
    expect(sweep).toMatchObject({ key: 'n1::V', nodeName: 'cell', parameterName: 'V', units: 'millivolt', from: -120, to: -40, points: 51 })
    expect(sweepLabel(sweep)).toBe('cell/V')
  })

  it('spans 0 to 1 for a value of 0 or none', () => {
    expect(createSweep(node('n1', 'cell', []), { name: 'k', type: 'constant', value: '0' }, () => null)).toMatchObject({ from: 0, to: 1 })
  })
})

describe('findSweepProblem', () => {
  const sweep = { parameterName: 'V', from: -100, to: 50, points: 16 }

  it('passes a complete sweep', () => {
    expect(findSweepProblem(sweep)).toBeNull()
  })

  it.each([
    [null, /choose a parameter/i],
    [{ ...sweep, from: null }, /start and end/],
    [{ ...sweep, to: 50, from: 50 }, /different value/],
    [{ ...sweep, points: 1 }, /from 2 to/],
    [{ ...sweep, points: MAX_SWEEP_POINTS + 1 }, /from 2 to/],
    [{ ...sweep, points: 2.5 }, /from 2 to/],
  ])('stops %j', (candidate, message) => {
    expect(findSweepProblem(candidate)).toMatch(message)
  })
})

describe('sweepValues', () => {
  it('spaces the values evenly, from the lower end up, ending exactly at the upper', () => {
    expect(sweepValues({ from: 0, to: 1, points: 5 })).toEqual([0, 0.25, 0.5, 0.75, 1])
    expect(sweepValues({ from: 50, to: -100, points: 4 })).toEqual([-100, -50, 0, 50])
    expect(sweepValues({ from: 0, to: 0.3, points: 4 }).at(-1)).toBe(0.3)
  })
})

describe('resolveSweepTarget', () => {
  const nodes = [
    node('n1', 'cell', [
      { name: 'V', type: 'boundary_condition' },
      { name: 'I', type: 'variable' },
      { name: 'g', type: 'global_constant' },
    ]),
  ]
  const mapping = new Map([
    ['n1::V', 'parameters/V'],
    ['n1::I', 'cell/I'],
    ['n1::g', 'global_parameters/g'],
  ])
  const variables = new Map([
    ['parameters/V', { kind: 'constant' }],
    ['cell/I', { kind: 'algebraic' }],
    ['global_parameters/g', { kind: 'constant' }],
  ])
  const resolve = (sweep) => resolveSweepTarget({ sweep, nodes, mapping, variables })

  it('names the constant libOpenCOR changes', () => {
    expect(resolve({ nodeId: 'n1', nodeName: 'cell', parameterName: 'V', type: 'boundary_condition' })).toEqual({ component: 'parameters', variable: 'V' })
  })

  it('finds a global constant through any instance using it', () => {
    expect(resolve({ nodeId: 'gone', nodeName: 'other', parameterName: 'g', type: 'global_constant' })).toEqual({
      component: 'global_parameters',
      variable: 'g',
    })
  })

  it('explains what can’t be swept', () => {
    expect(resolve({ nodeId: 'n1', nodeName: 'cell', parameterName: 'I', type: 'constant' }).problem).toMatch(/computed by the model/)
    expect(resolve({ nodeId: 'n2', nodeName: 'other', parameterName: 'V', type: 'constant' }).problem).toMatch(/isn’t in the simulated instances/)
  })
})
