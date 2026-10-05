import { describe, expect, it } from 'vitest'

import { getLinkedUnitRows, setLinkedUnits, syncInitialiserUnits } from '../../../src/utils/variables'

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
