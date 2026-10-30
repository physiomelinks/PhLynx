import { describe, expect, it } from 'vitest'
import {
  createLabelProvider,
  createTableSource,
  displayLabel,
  labelFor,
} from '../../../../src/services/annotations/labels.js'

describe('labels', () => {
  it('labels built-in terms by any IRI form', () => {
    expect(labelFor('CHEBI:17634')).toBe('D-glucose')
    expect(labelFor('http://purl.obolibrary.org/obo/GO_0005737')).toBe('cytoplasm')
    expect(labelFor('http://identifiers.org/opb/OPB_00318')).toBe('charge flow rate')
    expect(labelFor('SBO:0000290')).toBe('physical compartment')
  })

  it('returns undefined for unknown terms, and displayLabel falls back to the CURIE', () => {
    expect(labelFor('CHEBI:1')).toBeUndefined()
    expect(displayLabel('http://purl.obolibrary.org/obo/CHEBI_1')).toBe('CHEBI:1')
    expect(displayLabel('GO:0005886')).toBe('plasma membrane')
  })

  it('asks added sources first, then the earlier ones', () => {
    const provider = createLabelProvider([createTableSource(new Map([['CHEBI:29101', 'sodium']]))])
    expect(provider.labelFor('CHEBI:29101')).toBe('sodium')
    expect(provider.labelFor('CHEBI:29103')).toBeUndefined()
    provider.addSource({ labelFor: (curie) => (curie === 'CHEBI:29101' ? 'Na (ApiNATOMY)' : undefined) })
    expect(provider.labelFor('CHEBI:29101')).toBe('Na (ApiNATOMY)')
  })
})
