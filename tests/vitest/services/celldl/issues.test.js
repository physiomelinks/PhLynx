import { describe, expect, it } from 'vitest'

import { elementLabel, issueItems, issueLines } from '../../../../src/services/celldl/issues.js'

describe('issueLines', () => {
  it('lists the first issues, after the element each names, and counts the rest', () => {
    const issues = Array.from({ length: 7 }, (_, index) => ({ message: `m${index}`, ...(index === 0 && { elementId: 'X' }) }))
    expect(issueLines(issues)).toEqual(['• X: m0', '• m1', '• m2', '• m3', '• m4', '…and 2 more'])
  })
})

describe('elementLabel', () => {
  it("prefers the manifest's label, then its symbol, then the annotation's label, then the id", () => {
    const elements = { A: { label: 'Glucose', symbol: 'q_A' }, B: { symbol: 'q_B' } }
    const annotations = { C: { label: 'r1' } }
    expect(['A', 'B', 'C', 'D'].map((id) => elementLabel(id, { elements, annotations }))).toEqual(['Glucose', 'q_B', 'r1', 'D'])
    expect(elementLabel('D')).toBe('D')
  })
})

describe('issueItems', () => {
  it('lists every issue, errors first, labelling those that name an element', () => {
    const errors = Array.from({ length: 6 }, (_, index) => ({ message: `e${index}` }))
    const items = issueItems(
      { warnings: [{ message: 'w', elementId: 'B' }], errors: [{ message: 'e', elementId: 'A' }, ...errors] },
      { elements: { A: { symbol: 'q_A' } } }
    )
    expect(items).toHaveLength(8)
    expect(items[0]).toEqual({ key: 'error-0', severity: 'error', message: 'e', elementId: 'A', label: 'q_A' })
    expect(items[1]).toMatchObject({ severity: 'error', elementId: null, label: null })
    expect(items.at(-1)).toEqual({ key: 'warning-0', severity: 'warning', message: 'w', elementId: 'B', label: 'B' })
  })

  it('lists nothing for no result', () => {
    expect(issueItems()).toEqual([])
  })
})
