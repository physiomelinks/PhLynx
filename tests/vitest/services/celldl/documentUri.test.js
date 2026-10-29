import { describe, expect, it } from 'vitest'

import { LOCAL_DOCUMENT_BASE, documentUriFor, mintDocumentUri } from '../../../../src/services/celldl/documentUri.js'

describe('mintDocumentUri', () => {
  it("names a module's diagram under PhLynx's local base", () => {
    expect(mintDocumentUri('rc.cellml:rc')).toBe(`${LOCAL_DOCUMENT_BASE}rc.cellml_rc.celldl`)
  })

  it('gives an IRI that encodeURI leaves as it is, whatever the math reference', () => {
    for (const mathRef of ['my model.cellml:pump', 'a%20b.cellml:x', 'ünïcode/#?.cellml:c', '', null]) {
      const uri = mintDocumentUri(mathRef)
      expect(encodeURI(uri)).toBe(uri)
      expect(uri).toMatch(/^https:\/\/bg-rdf\.org\/models\/local\/phlynx\/[A-Za-z0-9._-]+\.celldl$/)
    }
  })
})

describe('documentUriFor', () => {
  const base = mintDocumentUri('rc.cellml:rc')

  it('keeps the IRI a document with relative IRIs was read under', () => {
    expect(documentUriFor({ baseUri: base, modelIri: base })).toBe(base)
    expect(documentUriFor({ baseUri: base, modelIri: `${base}#RC_circuit` })).toBe(base)
    expect(documentUriFor({ baseUri: base })).toBe(base)
  })

  it("takes the document a model with absolute IRIs names itself in", () => {
    expect(documentUriFor({ baseUri: base, modelIri: 'file:///models/rc.celldl#RC' })).toBe('file:///models/rc.celldl')
  })
})
