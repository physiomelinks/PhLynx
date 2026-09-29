import { describe, expect, it, vi } from 'vitest'

import { applyParametersToNodes } from '../../../src/utils/parameters.js'

const node = (name, variables) => ({
  id: name,
  data: { name, variables: variables.map((v) => ({ units: 'metre', value: null, type: 'variable', ...v })) },
})
const row = (variable_name, value, units = 'metre') => ({ variable_name, units, value, data_reference: 'ref' })

describe('applyParametersToNodes', () => {
  it('sets <variable>_<instance> rows on that instance and names of node variables as global constants', () => {
    const nodes = [node('va', [{ name: 'C_up' }, { name: 'd_up' }]), node('vb', [{ name: 'C_up' }])]
    const libraryStore = { assignGlobalConstant: vi.fn() }

    const result = applyParametersToNodes(
      nodes,
      [row('C_up_va', ' 1.5 '), row('d_up_vb', '2'), row('d_up', '3'), row('unknown', '4')],
      libraryStore
    )

    expect(result).toEqual({ localCount: 1, globalCount: 1, totalUpdated: 2 })
    expect(nodes[0].data.variables[0]).toMatchObject({ value: '1.5', type: 'constant', data_reference: 'ref' })
    expect(nodes[0].data.variables[1].type).toBe('variable')
    expect(nodes[1].data.variables[0].type).toBe('variable')
    expect(libraryStore.assignGlobalConstant).toHaveBeenCalledWith('d_up', '3', 'metre', 'ref')
  })
})
