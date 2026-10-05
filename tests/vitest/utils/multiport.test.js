import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { normaliseConfig, restorePorts } from '../../../src/utils/config.js'
import {
  couplingConflicts,
  cycleMultiportType,
  isMultiport,
  multiplyFactor,
  parseMultiport,
  restorePortVariables,
  setMultiport,
  setPortVariables,
  setVariableFactor,
  sharedSumConflicts,
  variableTypes,
} from '../../../src/utils/multiport.js'

const port = (variables, multiportType, multiplyFactor) => ({ label: 'p', variables, multiportType, multiplyFactor })

describe('parseMultiport', () => {
  it.each([
    ['sum', 'Sum'],
    ['SUM', 'Sum'],
    [true, 'True'],
    ['true', 'True'],
    ['multiply', 'Multiply'],
    ['None', 'None'],
    ['False', 'None'],
    [undefined, 'None'],
  ])('reads %j as %j', (value, expected) => {
    expect(parseMultiport(value)).toBe(expected)
  })

  it('copies a per-variable list as written', () => {
    const list = ['sum', 'True']
    expect(parseMultiport(list)).toEqual(list)
    expect(parseMultiport(list)).not.toBe(list)
  })

  it('reads a list whose entries all agree as that one value', () => {
    expect(parseMultiport(['None', false])).toBe('None')
    expect(parseMultiport(['sum', 'SUM'])).toBe('Sum')
  })
})

describe('variableTypes', () => {
  it('applies a whole-port value to every variable', () => {
    expect(variableTypes(port(['a', 'b'], 'Sum'))).toEqual(['Sum', 'Sum'])
    expect(variableTypes(port(['a'], undefined))).toEqual(['None'])
  })

  it('reads a list one entry per variable, ignoring case', () => {
    expect(variableTypes(port(['a', 'b', 'c'], ['sum', 'TRUE', 'Multiply']))).toEqual(['Sum', 'True', 'Multiply'])
  })

  it('reads None beside the other types as True', () => {
    expect(variableTypes(port(['a', 'b', 'c'], ['sum', 'None', false]))).toEqual(['Sum', 'True', 'True'])
  })

  it('rejects a list of the wrong length or with an unknown entry', () => {
    expect(() => variableTypes(port(['a', 'b'], ['sum']))).toThrow(/1 multiport entries for 2 variables/)
    expect(() => variableTypes(port(['a'], ['add']))).toThrow(/unknown multiport "add" for "a"/)
  })
})

describe('multiplyFactor', () => {
  it('reads a whole-port or per-variable factor, 1 when unset', () => {
    expect(multiplyFactor(port(['a', 'b'], 'Multiply', 2), 1)).toBe(2)
    expect(multiplyFactor(port(['a', 'b'], ['multiply', 'multiply'], [2, 3]), 1)).toBe(3)
    expect(multiplyFactor(port(['a'], 'Multiply'), 0)).toBe(1)
  })

  it('rejects a factor that is not a number', () => {
    expect(() => multiplyFactor(port(['a'], 'Multiply', 'x'), 0)).toThrow(/"a" needs a numeric multiply factor/)
  })
})

describe('couplingConflicts', () => {
  it('accepts a sum fed by plain or multiplied variables', () => {
    expect(couplingConflicts(port(['v_sum', 'u'], ['sum', 'True']), port(['v', 'u'], 'None'))).toEqual([])
    expect(couplingConflicts(port(['q'], 'Multiply'), port(['total'], 'Sum'))).toEqual([])
    expect(couplingConflicts(port(['a', 'b'], 'True'), port(['a'], 'None'))).toEqual([])
  })

  it('names the pairs that are both Sum or both Multiply', () => {
    expect(couplingConflicts(port(['x', 'y'], ['sum', 'multiply']), port(['p', 'q'], ['sum', 'multiply']))).toEqual([
      '"x" and "p" are both Sum variables.',
      '"y" and "q" are both Multiply variables.',
    ])
  })

  it('needs as many variables on both sides to sum or multiply', () => {
    expect(couplingConflicts(port(['x', 'y'], ['sum', 'True']), port(['p'], 'None'))).toEqual([
      'Ports "p" and "p" need the same number of variables to sum or multiply.',
    ])
  })

  it('reports a malformed list', () => {
    expect(couplingConflicts(port(['x'], ['sum', 'True']), port(['p'], 'None'))).toEqual([
      'Port "p" has 2 multiport entries for 1 variables.',
    ])
  })
})

describe('sharedSumConflicts', () => {
  const sumPort = (label, variable) => ({ label, variables: [variable], multiportType: 'Sum' })
  const edge = (id, hubPort, leafPort = { label: 'in', variables: ['v'], multiportType: 'None' }) => ({
    id,
    source: 'hub',
    target: id,
    data: { couplings: [{ sourcePort: hubPort, targetPort: leafPort }] },
  })

  it('flags every edge into two ports that sum the same variable', () => {
    const conflicts = sharedSumConflicts([edge('e1', sumPort('a', 'v_sum')), edge('e2', sumPort('b', 'v_sum'))], () => 'Hub')
    const message = '"Hub" sums "v_sum" through ports "a" and "b"; a variable can be summed through one port only.'
    expect([...conflicts]).toEqual([
      ['e1', [message]],
      ['e2', [message]],
    ])
  })

  it('accepts several edges into one Sum port, or ports summing different variables', () => {
    expect(sharedSumConflicts([edge('e1', sumPort('a', 'v_sum')), edge('e2', sumPort('a', 'v_sum'))]).size).toBe(0)
    expect(sharedSumConflicts([edge('e1', sumPort('a', 'v_sum')), edge('e2', sumPort('b', 'w_sum'))]).size).toBe(0)
  })

  it('leaves a malformed port to couplingConflicts', () => {
    const malformed = { label: 'b', variables: ['v_sum'], multiportType: ['sum', 'True'] }
    expect(sharedSumConflicts([edge('e1', sumPort('a', 'v_sum')), edge('e2', malformed)]).size).toBe(0)
  })
})

describe('setMultiport', () => {
  it('makes every variable True for several connections, or None for one', () => {
    const p = port(['a', 'b'], ['sum', 'multiply'], 2)
    setMultiport(p, false)
    expect(p.multiportType).toBe('None')
    expect(isMultiport(p)).toBe(false)
    setMultiport(p, true)
    expect(p.multiportType).toBe('True')
    expect(isMultiport(p)).toBe(true)
  })
})

describe('cycleMultiportType', () => {
  it('moves one variable through True, Sum and Multiply, never None', () => {
    const p = port(['a'], 'True')
    const seen = []
    for (let i = 0; i < 3; i++) {
      cycleMultiportType(p, 'a')
      seen.push(p.multiportType)
    }
    expect(seen).toEqual(['Sum', 'Multiply', 'True'])
  })

  it('changes only the clicked variable, storing one value when they agree', () => {
    const p = port(['a', 'b'], 'True')
    cycleMultiportType(p, 'a')
    expect(p.multiportType).toEqual(['sum', 'True'])
    cycleMultiportType(p, 'b')
    expect(p.multiportType).toBe('Sum')
  })

  it('gives a new Multiply variable a factor of 1, keeping the others', () => {
    const p = port(['a', 'b'], ['multiply', 'sum'], 2)
    cycleMultiportType(p, 'b')
    expect(p).toMatchObject({ multiportType: 'Multiply', multiplyFactor: [2, 1] })
  })
})

describe('setVariableFactor', () => {
  it('stores one factor until the Multiply variables differ', () => {
    const p = port(['a', 'b', 'c'], ['multiply', 'multiply', 'True'], 2)
    setVariableFactor(p, 'b', 2)
    expect(p.multiplyFactor).toBe(2)
    setVariableFactor(p, 'b', 3)
    expect(p.multiplyFactor).toEqual([2, 3, null])
  })
})

describe('restorePortVariables', () => {
  it('puts back removed variables, keeping later changes to the others', () => {
    const p = port(['a', 'b'], ['sum', 'True'])
    const earlier = { ...p }
    setPortVariables(p, ['b'])
    cycleMultiportType(p, 'b')
    restorePortVariables(p, earlier)
    expect(p).toMatchObject({ variables: ['a', 'b'], multiportType: 'Sum' })
  })

  it('follows a rename back', () => {
    const p = port(['x'], 'True')
    const earlier = { ...p }
    setPortVariables(p, ['y'], () => 'x')
    cycleMultiportType(p, 'y')
    restorePortVariables(p, earlier, () => 'y')
    expect(p).toMatchObject({ variables: ['x'], multiportType: 'Sum' })
  })
})

describe('setPortVariables', () => {
  it('keeps each variable with its type and factor through a reorder or removal', () => {
    const p = port(['a', 'b', 'c'], ['multiply', 'sum', 'True'], [2, null, null])
    setPortVariables(p, ['c', 'a', 'b'])
    expect(p).toMatchObject({ variables: ['c', 'a', 'b'], multiportType: ['True', 'multiply', 'sum'], multiplyFactor: 2 })
    setPortVariables(p, ['b'])
    expect(p).toMatchObject({ variables: ['b'], multiportType: 'Sum' })
  })

  it('adds a variable as True on a multiport and None otherwise', () => {
    const multi = port(['a'], 'Sum')
    setPortVariables(multi, ['a', 'b'])
    expect(multi.multiportType).toEqual(['sum', 'True'])
    const single = port(['a'], 'None')
    setPortVariables(single, ['a', 'b'])
    expect(single.multiportType).toBe('None')
  })

  it('keeps a port with no variables yet a multiport', () => {
    const p = port([], 'True')
    setPortVariables(p, ['a', 'b'])
    expect(p.multiportType).toBe('True')
  })

  it('follows a rename', () => {
    const p = port(['a', 'b'], ['sum', 'True'])
    setPortVariables(p, ['x', 'b'], (name) => (name === 'x' ? 'a' : name))
    expect(p.multiportType).toEqual(['sum', 'True'])
  })

  it('keeps the whole-port value when every variable is removed', () => {
    const p = port(['a'], 'Sum')
    setPortVariables(p, [])
    expect(p).toMatchObject({ variables: [], multiportType: 'Sum' })
  })
})

it('round-trips a per-variable multi_port through a bundled config', () => {
  const configs = JSON.parse(readFileSync('src/assets/module_configs/BG.json', 'utf8'))
  const config = structuredClone(configs.find((c) => c.module_type === 'Nout_junction' && c.module_subtype === 'pv_simple'))
  config.exit_ports[0].multi_port = ['sum', 'True']

  const module = normaliseConfig(config)
  const exitPort = module.ports.find((p) => p.portType === 'exit_ports')
  expect(variableTypes(exitPort)).toEqual(['Sum', 'True'])
  expect(restorePorts(module.ports).exit_ports[0].multi_port).toEqual(['sum', 'True'])
})
