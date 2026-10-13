import { describe, expect, it } from 'vitest'

import { findVoiNames, getLinkedUnitRows, inferType, setLinkedUnits, syncInitialiserUnits } from '../../../src/utils/variables'

const state = (name, initialiser, units = '') => ({ name, units, type: 'variable', stateRole: 'state', initialiser })
const constant = (name, units = '') => ({ name, units, type: 'constant' })
const names = (rows) => rows.map((row) => row.name)

describe('getLinkedUnitRows', () => {
  it('links a state and its initialiser, from either side', () => {
    const rows = [state('x', 'x_init'), constant('x_init'), constant('k')]
    expect(names(getLinkedUnitRows(rows, rows[0]))).toEqual(['x', 'x_init'])
    expect(names(getLinkedUnitRows(rows, rows[1]))).toEqual(['x_init', 'x'])
  })

  it('follows a shared initialiser to every state using it', () => {
    const rows = [state('a', 'shared'), state('b', 'shared'), constant('shared'), state('c', 'c_init'), constant('c_init')]
    expect(names(getLinkedUnitRows(rows, rows[0]))).toEqual(['a', 'b', 'shared'])
  })

  it('returns only the row when it has no initialiser, or its initialiser row is missing', () => {
    const rows = [state('x', ''), state('y', 'gone'), constant('k')]
    expect(names(getLinkedUnitRows(rows, rows[0]))).toEqual(['x'])
    expect(names(getLinkedUnitRows(rows, rows[1]))).toEqual(['y'])
    expect(names(getLinkedUnitRows(rows, rows[2]))).toEqual(['k'])
  })
})

describe('setLinkedUnits', () => {
  it('sets the units on the state and its initialiser, whichever is edited', () => {
    const rows = [state('x', 'x_init', 'm'), constant('x_init', 'm'), constant('k', 'second')]
    setLinkedUnits(rows, rows[0], 'metre')
    expect(rows.map((row) => row.units)).toEqual(['metre', 'metre', 'second'])

    setLinkedUnits(rows, rows[1], 'mV')
    expect(rows.map((row) => row.units)).toEqual(['mV', 'mV', 'second'])
  })

  it('cascades across a shared initialiser', () => {
    const rows = [state('a', 'shared', 'mM'), state('b', 'shared', 'mM'), constant('shared', 'mM')]
    setLinkedUnits(rows, rows[1], 'uM')
    expect(rows.map((row) => row.units)).toEqual(['uM', 'uM', 'uM'])
  })
})

describe('syncInitialiserUnits', () => {
  it('only fills blank initialisers by default', () => {
    const rows = [state('x', 'x_init', 'metre'), constant('x_init', 'm'), state('y', 'y_init', 'second'), constant('y_init')]
    syncInitialiserUnits(rows)
    expect(rows.map((row) => row.units)).toEqual(['metre', 'm', 'second', 'second'])
  })

  it('with overwrite, gives the initialiser its state units', () => {
    const rows = [state('x', 'x_init', 'metre'), constant('x_init', 'm')]
    syncInitialiserUnits(rows, { overwrite: true })
    expect(rows.map((row) => row.units)).toEqual(['metre', 'metre'])
  })

  it('with overwrite, fills a blank state from its initialiser', () => {
    const rows = [state('x', 'x_init'), constant('x_init', 'metre')]
    syncInitialiserUnits(rows, { overwrite: true })
    expect(rows.map((row) => row.units)).toEqual(['metre', 'metre'])
  })

  it('with overwrite, gives a shared group its first state units', () => {
    const rows = [state('a', 'shared'), state('b', 'shared', 'uM'), state('c', 'shared', 'mM'), constant('shared', 'nM')]
    syncInitialiserUnits(rows, { overwrite: true })
    expect(rows.map((row) => row.units)).toEqual(['uM', 'uM', 'uM', 'uM'])
  })
})

describe('findVoiNames', () => {
  const unitsFrom = (units) => (name) => units[name]

  it('takes the variable of integration as time, whatever its name', () => {
    const analysis = { voi: ['tau'], stateVariables: ['V'], referenced: ['tau', 'V', 't'] }
    expect(findVoiNames(analysis, unitsFrom({ tau: 'second', t: 'second' }))).toEqual(new Set(['tau']))
  })

  it('takes a variable of integration that isn’t time, such as a distance', () => {
    const analysis = { voi: ['x'], stateVariables: ['y'], referenced: ['x', 'y', 't'] }
    expect(findVoiNames(analysis, unitsFrom({ x: 'metre', t: 'second' }))).toEqual(new Set(['x']))
  })

  it('leaves a t that isn’t the variable of integration alone', () => {
    const analysis = { voi: ['time'], stateVariables: ['V'], referenced: ['time', 'V', 't'] }
    expect(findVoiNames(analysis, unitsFrom({ time: 'second', t: 'metre' }))).toEqual(new Set(['time']))
  })

  it('falls back to a time-named variable in time units when there is no ODE', () => {
    const analysis = { voi: [], assigned: ['I'], referenced: ['I', 't'] }
    expect(findVoiNames(analysis, unitsFrom({ t: 'millisecond' }))).toEqual(new Set(['t']))
  })

  it('reads the units the math declares before asking for others', () => {
    const analysis = { voi: [], declared: [{ name: 't', units: 'second' }], referenced: ['t'] }
    expect(findVoiNames(analysis)).toEqual(new Set(['t']))
    expect(findVoiNames(analysis, unitsFrom({ t: 'metre' }))).toEqual(new Set(['t']))
  })

  it('finds no time in an algebraic module whose t isn’t in time units, or is computed', () => {
    expect(findVoiNames({ voi: [], referenced: ['t'] }, unitsFrom({ t: 'metre' }))).toEqual(new Set())
    expect(findVoiNames({ voi: [], referenced: ['t'] }, unitsFrom({}))).toEqual(new Set())
    expect(findVoiNames({ voi: [], assigned: ['time'], referenced: ['time'] }, unitsFrom({ time: 'second' }))).toEqual(new Set())
  })
})

describe('inferType', () => {
  const roles = { states: new Set(['V']), assigned: new Set(['I']), voi: new Set(['time']) }

  it('makes what the math computes, and its VoI, a variable', () => {
    for (const name of ['V', 'I', 'time']) expect(inferType(name, roles), name).toBe('variable')
  })

  it('makes a variable named t a constant when it isn’t the VoI', () => {
    expect(inferType('t', roles)).toBe('constant')
  })
})
