import { describe, expect, it } from 'vitest'

import { findWorkspaceMatches, parseSearchQuery, variableKindLabel } from '../../../src/utils/workspaceSearch.js'

/** Builds an instance node holding the named variable rows. */
const makeNode = (id, rows = [], data = {}) => ({
  id,
  data: { name: id, variables: rows.map((row) => (typeof row === 'string' ? { name: row, type: 'variable' } : row)), ...data },
})

/** Searches the nodes and gets each match as `nodeId: var, var`. */
const search = (nodes, text) =>
  findWorkspaceMatches(nodes, parseSearchQuery(text)).map(({ nodeId, variables }) =>
    variables.length ? `${nodeId}: ${variables.map((row) => row.name).join(', ')}` : nodeId
  )

describe('parseSearchQuery', () => {
  it('treats plain text as a name search', () => {
    expect(parseSearchQuery('  Na ')).toEqual({ mode: 'name', term: 'na', instanceTerm: '', words: [] })
  })

  it.each(['var:R', 'VAR: r ', ' var:r'])('reads %j as a variable search', (text) => {
    expect(parseSearchQuery(text)).toEqual({ mode: 'var', term: 'r', instanceTerm: '', words: ['r'] })
  })

  it('reads a bare prefix as a variable search with nothing to find', () => {
    expect(parseSearchQuery('var:')).toMatchObject({ mode: 'var', term: '', words: [] })
  })

  it.each(['variable', 'my var:x', 'file.cellml:comp'])('keeps %j a name search', (text) => {
    expect(parseSearchQuery(text)).toMatchObject({ mode: 'name', term: text.toLowerCase() })
  })

  it('splits a variable search into words', () => {
    expect(parseSearchQuery('var:g  Na').words).toEqual(['g', 'na'])
  })

  it('reads an instance before the last slash', () => {
    expect(parseSearchQuery('var:SA/k')).toMatchObject({ instanceTerm: 'sa', words: ['k'] })
    expect(parseSearchQuery('var:SA/')).toMatchObject({ instanceTerm: 'sa', words: [] })
  })
})

describe('findWorkspaceMatches', () => {
  it('matches names, modules and maths files as the name search always has', () => {
    const nodes = [
      makeNode('heart', [], { moduleRef: 'Pump' }),
      makeNode('Na_channel'),
      makeNode('vessel', [], { mathRef: 'na_maths.cellml' }),
    ]
    expect(search(nodes, 'NA')).toEqual(['Na_channel', 'vessel'])
    expect(search(nodes, 'pump')).toEqual(['heart'])
  })

  it('finds nothing for an empty term', () => {
    expect(search([makeNode('a', ['x'])], '')).toEqual([])
    expect(search([makeNode('a', ['x'])], 'var:')).toEqual([])
  })

  it('finds every instance using a global constant', () => {
    const R = { name: 'R', type: 'global_constant' }
    expect(search([makeNode('n1', [R, 'v']), makeNode('n2', [R]), makeNode('n3', ['v'])], 'var:R')).toEqual(['n1: R', 'n2: R'])
  })

  it('matches variable names only, not instance names', () => {
    expect(search([makeNode('Na_channel', ['g', 'E']), makeNode('cell', ['Na_i'])], 'var:na')).toEqual(['cell: Na_i'])
  })

  it('needs every word in a variable name', () => {
    expect(search([makeNode('a', ['g_Na', 'g_K', 'E_Na'])], 'var:na g')).toEqual(['a: g_Na'])
  })

  it('filters instances by the part before a slash', () => {
    const nodes = [makeNode('SA_node', ['k_on', 'V']), makeNode('AV_node', ['k_on'])]
    expect(search(nodes, 'var:sa/k')).toEqual(['SA_node: k_on'])
    expect(search(nodes, 'var:sa/')).toEqual(['SA_node: k_on, V'])
  })

  it('lists exact names first, then names starting with the term, then the rest', () => {
    expect(search([makeNode('a', ['V_init', 'dV', 'V', 'Vm'])], 'var:v')).toEqual(['a: V, V_init, Vm, dV'])
  })

  it('tolerates nodes without variables and rows without names', () => {
    const nodes = [{ id: 'bare', data: { name: 'bare' } }, makeNode('a', [{ type: 'variable' }, 'x'])]
    expect(search(nodes, 'var:x')).toEqual(['a: x'])
  })
})

describe('variableKindLabel', () => {
  it.each([
    [{ type: 'global_constant' }, 'global'],
    [{ type: 'constant' }, 'parameter'],
    [{ type: 'boundary_condition' }, 'boundary'],
    [{ type: 'variable', stateRole: 'state' }, 'state'],
    [{ type: 'variable' }, ''],
  ])('labels %j as %j', (row, label) => {
    expect(variableKindLabel(row)).toBe(label)
  })
})
