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
    expect(labelFor('https://identifiers.org/opb/OPB_00593')).toBe('chemical amount density flow rate')
    expect(labelFor('OPB:00425')).toBe('amount')
    expect(labelFor('SBO:0000290')).toBe('physical compartment')
  })

  it('labels inorganic phosphate as Pi and hydrogenphosphate as its ion', () => {
    expect(labelFor('http://purl.obolibrary.org/obo/CHEBI_24838')).toBe('Pi')
    expect(labelFor('CHEBI:43474')).toBe('HPO₄²⁻')
  })

  it('returns undefined for unknown terms, and displayLabel falls back to the CURIE', () => {
    expect(labelFor('CHEBI:1')).toBeUndefined()
    expect(displayLabel('http://purl.obolibrary.org/obo/CHEBI_1')).toBe('CHEBI:1')
    expect(displayLabel('GO:0005886')).toBe('plasma membrane')
  })

  it('asks added sources first, then the earlier ones', () => {
    const provider = createLabelProvider([createTableSource(new Map([['CHEBI:29101', 'first']]))])
    expect(provider.labelFor('CHEBI:29101')).toBe('first')
    expect(provider.labelFor('CHEBI:29103')).toBeUndefined()
    provider.addSource({ labelFor: (curie) => (curie === 'CHEBI:29101' ? 'second' : undefined) })
    expect(provider.labelFor('CHEBI:29101')).toBe('second')
  })

  it('asks a fallback source only when no other source has a label', () => {
    const provider = createLabelProvider()
    provider.addSource(createTableSource(new Map([['CL:9900001', 'cached cell'], ['CHEBI:29101', 'cached']])), {
      isFallback: true,
    })
    expect(provider.labelFor('http://purl.obolibrary.org/obo/CL_9900001')).toBe('cached cell')
    expect(provider.labelFor('CHEBI:29101')).toBe('Na⁺')
  })
})
