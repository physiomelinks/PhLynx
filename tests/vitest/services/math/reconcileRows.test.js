import { describe, expect, it } from 'vitest'
import { applyPortTypes, getPortVariables, reconcileRows } from '../../../../src/services/math/reconcileRows'

const analysis = (overrides = {}) => ({
  componentName: 'c',
  declared: [],
  referenced: [],
  stateVariables: [],
  unresolved: [],
  assigned: [],
  voi: [],
  ...overrides,
})

const byName = (rows) => Object.fromEntries(rows.map((row) => [row.name, row]))

describe('reconcileRows (simple mode)', () => {
  it('creates a default initialiser for a state and marks computed variables', () => {
    const rows = byName(
      reconcileRows(analysis({ referenced: ['t', 'V', 'k', 'I'], stateVariables: ['V'], assigned: ['I'], voi: ['t'] }))
    )
    expect(rows.V).toMatchObject({ type: 'variable', stateRole: 'state', initialiser: 'V_init' })
    expect(rows.V_init).toMatchObject({ type: 'constant', access: 'no_access' })
    expect(rows.I.type).toBe('variable')
    expect(rows.t.type).toBe('variable')
    expect(rows.k.type).toBe('constant')
  })

  it('decides time by the variable of integration, not by name (#614)', () => {
    const rows = byName(
      reconcileRows(analysis({ referenced: ['time', 'V', 't'], stateVariables: ['V'], voi: ['time'] }), [
        { name: 't', units: 'metre', value: '0.2', type: 'constant' },
      ])
    )
    expect(rows.time.type).toBe('variable')
    expect(rows.t).toMatchObject({ type: 'constant', value: '0.2' })

    const tau = byName(reconcileRows(analysis({ referenced: ['tau', 'V'], stateVariables: ['V'], voi: ['tau'] })))
    expect(tau.tau.type).toBe('variable')
  })

  it('takes a time-named variable in time units as time in a module without ODEs', () => {
    const declared = [
      { name: 't', units: 'second', interface: 'public', initialValue: '' },
      { name: 'thickness', units: 'metre', interface: 'public', initialValue: '' },
    ]
    const stimulus = byName(reconcileRows(analysis({ declared, referenced: ['I', 't'], assigned: ['I'] })))
    expect(stimulus.t.type).toBe('variable')

    const algebraic = byName(reconcileRows(analysis({ referenced: ['y', 't'], assigned: ['y'] }), [{ name: 't', units: 'metre', type: 'constant' }]))
    expect(algebraic.t.type).toBe('constant')
  })

  it('keeps what the person entered over what the XML says', () => {
    const previous = [{ name: 'k', units: 'metre', value: '3', type: 'global_constant', access: 'no_access' }]
    const rows = byName(
      reconcileRows(analysis({ referenced: ['k'], declared: [{ name: 'k', units: 'second', interface: '', initialValue: '1' }] }), previous)
    )
    expect(rows.k).toMatchObject({ units: 'metre', value: '3', type: 'global_constant', access: 'no_access' })
  })

  it('seeds units and numeric values from declarations for new rows', () => {
    const rows = byName(
      reconcileRows(analysis({ referenced: ['k'], declared: [{ name: 'k', units: 'second', interface: 'public', initialValue: '1.5' }] }))
    )
    expect(rows.k).toMatchObject({ units: 'second', value: '1.5', access: 'access' })
  })

  it('pairs a state with its named initialiser, even one computed by the math', () => {
    const rows = byName(
      reconcileRows(
        analysis({
          referenced: ['c', 'c_init', 'a'],
          stateVariables: ['c'],
          assigned: ['c_init'],
          declared: [{ name: 'c', units: 'mM', interface: '', initialValue: 'c_init' }],
        })
      )
    )
    expect(rows.c.initialiser).toBe('c_init')
    expect(rows.c_init.type).toBe('variable')
    expect(rows.c_init.units).toBe('mM')
  })

  it('carries forward an initialiser known only from a previous pass, including a shared one', () => {
    const previous = [
      { name: 'A', stateRole: 'state', initialiser: 'shared_init', units: 'mM', type: 'variable' },
      { name: 'B', stateRole: 'state', initialiser: 'shared_init', units: 'mM', type: 'variable' },
      { name: 'shared_init', value: '2', units: 'mM', type: 'constant', access: 'no_access' },
    ]
    const rows = reconcileRows(analysis({ referenced: ['A', 'B'], stateVariables: ['A', 'B'] }), previous)
    const named = byName(rows)
    expect(named.A.initialiser).toBe('shared_init')
    expect(named.B.initialiser).toBe('shared_init')
    expect(rows.filter((row) => row.name === 'shared_init')).toHaveLength(1)
    expect(named.shared_init.value).toBe('2')
  })

  it('drops the state marking when a variable stops being a state', () => {
    const previous = [{ name: 'V', stateRole: 'state', initialiser: 'V_init', type: 'variable' }]
    const rows = byName(reconcileRows(analysis({ referenced: ['V'] }), previous))
    expect(rows.V.stateRole).toBeUndefined()
    expect(rows.V.initialiser).toBeUndefined()
  })

  it('keeps a row the math still declares but no equation uses, and drops one it no longer declares', () => {
    const previous = [
      { name: 'k', value: '0', type: 'constant', data_reference: 'Smith2001' },
      { name: 'gone', value: '2', type: 'constant' },
    ]
    const rows = byName(
      reconcileRows(analysis({ referenced: ['t'], declared: [{ name: 'k', units: 'mV', interface: 'public', initialValue: '' }] }), previous)
    )
    expect(rows.k).toMatchObject({ value: '0', data_reference: 'Smith2001' })
    expect(rows.gone).toBeUndefined()
  })

  it('keeps data references and gives a new initialiser its state\'s', () => {
    const previous = [
      { name: 'k', value: '3', type: 'constant', data_reference: 'Smith2001' },
      { name: 'V', value: '-60', type: 'variable', data_reference: 'Jones1999' },
    ]
    const rows = byName(reconcileRows(analysis({ referenced: ['t', 'V', 'k'], stateVariables: ['V'], voi: ['t'] }), previous))
    expect(rows.k.data_reference).toBe('Smith2001')
    expect(rows.V.data_reference).toBe('Jones1999')
    expect(rows.V_init).toMatchObject({ value: '-60', data_reference: 'Jones1999' })
    expect(rows.t.data_reference).toBeNull()
  })

  it('gives an initialiser whose units drifted its state units', () => {
    const previous = [
      { name: 'x', stateRole: 'state', initialiser: 'x_init', units: 'metre', type: 'variable' },
      { name: 'x_init', value: '1', units: 'm', type: 'constant', access: 'no_access' },
    ]
    const rows = byName(reconcileRows(analysis({ referenced: ['x'], stateVariables: ['x'] }), previous))
    expect(rows.x_init.units).toBe('metre')
  })

  it('does not mutate previous rows', () => {
    const previous = [{ name: 'V', units: 'volt', value: '1', type: 'constant', access: 'access' }]
    const snapshot = JSON.parse(JSON.stringify(previous))
    reconcileRows(analysis({ referenced: ['V'], stateVariables: ['V'] }), previous)
    expect(previous).toEqual(snapshot)
  })
})

describe('reconcileRows (advanced mode)', () => {
  const declared = [
    { name: 't', units: 'second', interface: 'public', initialValue: '' },
    { name: 'V', units: 'volt', interface: '', initialValue: '-0.08' },
    { name: 'k', units: 'per_second', interface: '', initialValue: '2' },
    { name: 'I', units: 'amp', interface: '', initialValue: '' },
  ]

  it('builds rows from declarations, with text-owned units and textInit', () => {
    const previous = [{ name: 'k', units: 'metre', value: '9', type: 'global_constant', access: 'no_access' }]
    const rows = byName(
      reconcileRows(analysis({ declared, referenced: ['t', 'V', 'k', 'I'], stateVariables: ['V'], assigned: ['I'] }), previous, {
        mode: 'advanced',
      })
    )
    expect(Object.keys(rows)).toEqual(expect.arrayContaining(['t', 'V', 'k', 'I', 'V_init']))
    expect(rows.k).toMatchObject({ units: 'per_second', value: '9', type: 'global_constant', textInit: '2' })
    expect(rows.I).toMatchObject({ type: 'variable' })
    expect(rows.I.textInit).toBeUndefined()
    expect(rows.t).toMatchObject({ type: 'variable', access: 'access' })
    expect(rows.V).toMatchObject({ stateRole: 'state', type: 'variable', textInit: '-0.08' })
  })

  it('keeps the units the text declares, even where a state and its initialiser differ', () => {
    const math = analysis({
      referenced: ['V', 'V0'],
      stateVariables: ['V'],
      declared: [
        { name: 'V', units: 'volt', interface: '', initialValue: 'V0' },
        { name: 'V0', units: 'millivolt', interface: '', initialValue: '1' },
      ],
    })
    const rows = byName(reconcileRows(math, [], { mode: 'advanced' }))
    expect(rows.V).toMatchObject({ units: 'volt', initialiser: 'V0' })
    expect(rows.V0.units).toBe('millivolt')
  })
})

describe('reconcileRows (row types)', () => {
  const declared = [
    { name: 'k', units: 'second', interface: 'public_in', initialValue: '' },
    { name: 'u_in', units: 'volt', interface: 'public_in', initialValue: '' },
    { name: 'u_bc', units: 'volt', interface: 'public_in', initialValue: '' },
    { name: 'c', units: 'second', interface: 'public_in', initialValue: '' },
    { name: 'g', units: 'second', interface: 'public_in', initialValue: '' },
    { name: 'I', units: 'amp', interface: '', initialValue: '' },
  ]
  const math = analysis({ declared, referenced: ['k', 'u_in', 'u_bc', 'c', 'g', 'I'], assigned: ['I'] })
  const previous = [
    { name: 'k', type: 'variable' },
    { name: 'u_in', type: 'variable' },
    { name: 'u_bc', type: 'boundary_condition' },
    { name: 'c', type: 'constant' },
    { name: 'g', type: 'global_constant' },
    { name: 'I', type: 'constant' },
  ]

  it('makes a declared variable with no initial value a constant, not a variable, in advanced mode', () => {
    const rows = byName(reconcileRows(math, [], { mode: 'advanced' }))
    expect(rows.k.type).toBe('constant')
  })

  it('makes only computed rows variables, re-typing a stale variable from the ports', () => {
    for (const mode of ['simple', 'advanced']) {
      const rows = byName(reconcileRows(math, previous, { mode, portVariables: ['u_in', 'c'] }))
      expect(rows.I.type).toBe('variable')
      expect(rows.k.type).toBe('constant')
      expect(rows.u_in.type).toBe('boundary_condition')
    }
  })

  it('keeps stored boundary conditions and constants, in a port or not', () => {
    const rows = byName(reconcileRows(math, previous, { portVariables: ['c'] }))
    expect(rows.u_bc.type).toBe('boundary_condition')
    expect(rows.c.type).toBe('constant')
    expect(rows.g.type).toBe('global_constant')
  })

  it('defaults a new row to constant, even in a port', () => {
    const rows = byName(reconcileRows(math, [], { portVariables: ['u_in'] }))
    expect(rows.u_in.type).toBe('constant')
    expect(rows.k.type).toBe('constant')
    expect(rows.I.type).toBe('variable')
  })

  it('keeps a stored variable when the ports are unknown', () => {
    const rows = byName(reconcileRows(math, previous))
    expect(rows.k.type).toBe('variable')
  })

  it('re-types stale variables when the ports change, leaving states and other types alone', () => {
    const rows = [
      { name: 'k', type: 'variable' },
      { name: 'm', type: 'variable' },
      { name: 'u_bc', type: 'boundary_condition' },
      { name: 'c', type: 'constant' },
      { name: 'x', type: 'variable', stateRole: 'state' },
    ]
    applyPortTypes(rows, analysis({ stateVariables: ['x'] }), new Set(['k']))
    expect(byName(rows)).toMatchObject({
      k: { type: 'boundary_condition' },
      m: { type: 'constant' },
      u_bc: { type: 'boundary_condition' },
      c: { type: 'constant' },
      x: { type: 'variable' },
    })
  })

  it('reads port variables saved as names or as { name } objects', () => {
    expect(getPortVariables([{ variables: ['a', { name: 'b' }] }, { variables: null }, {}])).toEqual(new Set(['a', 'b']))
    expect(getPortVariables(undefined)).toEqual(new Set())
  })
})

describe('reconcileRows (defaults)', () => {
  const math = analysis({
    referenced: ['x', 'x_init', 'k', 'g'],
    stateVariables: ['x'],
    declared: [
      { name: 'x', units: 'metre', interface: '', initialValue: 'x_init' },
      { name: 'x_init', units: 'metre', interface: '', initialValue: '' },
    ],
  })
  const defaults = new Map([['x_init', '1.5'], ['k', '2'], ['g', '3']])

  it('fills rows that have no value from the defaults, including a state initialiser', () => {
    const rows = byName(reconcileRows(math, [{ name: 'k', value: null, type: 'constant' }], { defaults }))
    expect(rows.x).toMatchObject({ stateRole: 'state', initialiser: 'x_init' })
    expect(rows.x_init.value).toBe('1.5')
    expect(rows.k.value).toBe('2')
    expect(rows.g.value).toBe('3')
  })

  it('keeps a value someone entered or cleared', () => {
    const previous = [
      { name: 'k', value: '9', type: 'constant' },
      { name: 'g', value: '', type: 'constant' },
    ]
    const rows = byName(reconcileRows(math, previous, { defaults }))
    expect(rows.k.value).toBe('9')
    expect(rows.g.value).toBe('')
  })
})
