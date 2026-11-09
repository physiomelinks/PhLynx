import { describe, expect, it } from 'vitest'
import {
  canonicalCurie,
  expandCurie,
  hasPrefix,
  oboIri,
  isFlowProperty,
  OPB,
  splitCurie,
  takesSpecies,
} from '../../../../src/services/annotations/iris.js'

describe('canonicalCurie', () => {
  it.each([
    ['http://purl.obolibrary.org/obo/CHEBI_17634', 'CHEBI:17634'],
    ['http://identifiers.org/CHEBI:17634', 'CHEBI:17634'],
    ['https://identifiers.org/chebi/CHEBI:17634', 'CHEBI:17634'],
    ['chebi:17634', 'CHEBI:17634'],
    ['http://identifiers.org/opb/OPB_00340', 'OPB:00340'],
    ['https://identifiers.org/opb:OPB_00340', 'OPB:00340'],
    ['http://identifiers.org/OPB:00340', 'OPB:00340'],
    ['OPB_00340', 'OPB:00340'],
    ['http://purl.obolibrary.org/obo/GO_0005737', 'GO:0005737'],
    ['http://identifiers.org/GO:0005737', 'GO:0005737'],
    ['http://identifiers.org/go/GO:0005737', 'GO:0005737'],
    ['http://purl.obolibrary.org/obo/SBO_0000290', 'SBO:0000290'],
    ['http://identifiers.org/biomodels.sbo/SBO:0000290', 'SBO:0000290'],
    ['http://identifiers.org/uniprot/P11168', 'uniprot:P11168'],
    ['https://identifiers.org/uniprot:P11168', 'uniprot:P11168'],
    ['https://purl.uniprot.org/uniprot/P11168', 'uniprot:P11168'],
    ['UNIPROT:P11168', 'uniprot:P11168'],
    ['http://purl.obolibrary.org/obo/UBERON_0000948', 'UBERON:0000948'],
    ['http://purl.obolibrary.org/obo/CL_0000066', 'CL:0000066'],
    ['http://uri.interlex.org/base/ilx_0000001', 'ILX:0000001'],
  ])('%s → %s', (iri, curie) => {
    expect(canonicalCurie(iri)).toBe(curie)
  })

  it('leaves unknown IRIs unchanged', () => {
    const iri = 'https://example.org/model#thing'
    expect(canonicalCurie(iri)).toBe(iri)
    expect(canonicalCurie('https://identifiers.org/foo:BAR_1')).toBe('https://identifiers.org/foo:BAR_1')
  })
})

describe('CURIE helpers', () => {
  it('expands to the canonical IRI and round-trips', () => {
    expect(expandCurie('GO:0005737')).toBe('https://identifiers.org/go/GO:0005737')
    expect(expandCurie('CHEBI:29101')).toBe('https://identifiers.org/chebi/CHEBI:29101')
    expect(expandCurie('SBO:0000290')).toBe('https://identifiers.org/sbo/SBO:0000290')
    expect(expandCurie('OPB:00340')).toBe('https://identifiers.org/opb/OPB_00340')
    expect(expandCurie('uniprot:P11168')).toBe('https://identifiers.org/uniprot/P11168')
    for (const curie of ['CHEBI:29101', 'SBO:0000290', 'OPB:00592', 'uniprot:O60928', 'CL:1000339', 'UBERON:0002114']) {
      expect(canonicalCurie(expandCurie(curie))).toBe(curie)
    }
    expect(expandCurie('foo:bar')).toBe('foo:bar')
  })

  it('gives the OBO PURL OLS knows a term by, and the canonical IRI outside OBO', () => {
    expect(oboIri('GO:0005737')).toBe('http://purl.obolibrary.org/obo/GO_0005737')
    expect(oboIri('CHEBI:29101')).toBe('http://purl.obolibrary.org/obo/CHEBI_29101')
    expect(oboIri('OPB:00340')).toBe('https://identifiers.org/opb/OPB_00340')
    expect(oboIri('uniprot:P11168')).toBe('https://identifiers.org/uniprot/P11168')
  })

  it('splits and tests prefixes', () => {
    expect(splitCurie('CHEBI:29101')).toEqual(['CHEBI', '29101'])
    expect(splitCurie('https://x.org/a')).toEqual([null, 'https://x.org/a'])
    expect(hasPrefix('uniprot:P05023', 'uniprot')).toBe(true)
    expect(hasPrefix('GO:0005886', 'CHEBI')).toBe(false)
  })

  it('marks molar and charge flow rates as flows', () => {
    expect(isFlowProperty(OPB.molarFlowRate)).toBe(true)
    expect(isFlowProperty(OPB.amountDensityFlowRate)).toBe(true)
    expect(isFlowProperty(OPB.chargeFlowRate)).toBe(true)
    expect(isFlowProperty(OPB.concentration)).toBe(false)
  })
})

describe('takesSpecies', () => {
  it('is true only for properties of a species', () => {
    expect(takesSpecies(OPB.concentration)).toBe(true)
    expect(takesSpecies(OPB.amount)).toBe(true)
    expect(takesSpecies(OPB.molarFlowRate)).toBe(true)
    expect(takesSpecies(OPB.amountDensityFlowRate)).toBe(true)
    expect(takesSpecies(OPB.electricalPotential)).toBe(false)
    expect(takesSpecies(OPB.chargeFlowRate)).toBe(false)
    expect(takesSpecies(null)).toBe(false)
  })
})
