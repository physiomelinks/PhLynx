import { describe, expect, it } from 'vitest'

import { buildParameterChanges } from '../../../../src/services/simulation/parameterChanges.js'

const NODES = [
  {
    id: 'a',
    data: {
      variables: [
        { name: 'k', type: 'constant', value: '2' },
        { name: 'blank', type: 'constant', value: '' },
        { name: 'R', type: 'global_constant', value: '' },
        { name: 'q', type: 'constant', value: '1' },
        { name: 'v', type: 'variable', value: '5' },
      ],
    },
  },
]
const MAPPING = new Map([
  ['a::k', 'instance_parameters/k'],
  ['a::blank', 'instance_parameters/blank'],
  ['a::R', 'global_parameters/R'],
  ['a::q', 'a/q'],
  ['a::v', 'a/v'],
])
const VARIABLES = new Map([
  ['instance_parameters/k', { kind: 'constant' }],
  ['instance_parameters/blank', { kind: 'constant' }],
  ['global_parameters/R', { kind: 'constant' }],
  ['a/q', { kind: 'computedConstant' }],
  ['a/v', { kind: 'state' }],
])
const NONE = { rows: new Set(), globals: new Set() }

/**
 * Builds the changes for some overrides.
 *
 * @param {Object} overrides - `{ rows, globals }` as arrays of pairs.
 * @param {Object} [flattenedWith]
 * @returns {Array|null}
 */
const changesFor = ({ rows = [], globals = [] }, flattenedWith = NONE) =>
  buildParameterChanges({
    nodes: NODES,
    overrides: { rows: new Map(rows), globals: new Map(globals) },
    flattenedWith,
    mapping: MAPPING,
    variables: VARIABLES,
    getGlobalConstant: (name) => (name === 'R' ? { value: '8.314' } : undefined),
  })

describe('buildParameterChanges', () => {
  it('changes the variables that rows and global constants map to', () => {
    expect(changesFor({ rows: [['a::k', 3]], globals: [['R', 9]] })).toEqual([
      { component: 'instance_parameters', variable: 'k', value: 3 },
      { component: 'global_parameters', variable: 'R', value: 9 },
    ])
  })

  it('puts back the model’s values for those flattened in but no longer tried out', () => {
    expect(changesFor({}, { rows: new Set(['a::k']), globals: new Set(['R']) })).toEqual([
      { component: 'instance_parameters', variable: 'k', value: 2 },
      { component: 'global_parameters', variable: 'R', value: 8.314 },
    ])
  })

  it.each([
    ['a variable libOpenCOR can’t change', { rows: [['a::q', 2]] }, NONE],
    ['a blank value to put back', {}, { rows: new Set(['a::blank']), globals: new Set() }],
    ['a value that isn’t a number', { rows: [['a::k', Number.NaN]] }, NONE],
  ])('gives up on %s, so the model is flattened again', (_, overrides, flattenedWith) => {
    expect(changesFor(overrides, flattenedWith)).toBeNull()
  })

  it.each([
    ['a node outside the scope', { rows: [['elsewhere::k', 2]] }],
    ['a row that is no longer a constant', { rows: [['a::v', 2]] }],
    ['a global constant no node in the scope uses', { globals: [['F', 96485]] }],
  ])('leaves out a value for %s, as the flatten ignores it', (_, overrides) => {
    expect(changesFor(overrides)).toEqual([])
  })

  it('needs no changes without sliders', () => {
    expect(changesFor({})).toEqual([])
  })
})
