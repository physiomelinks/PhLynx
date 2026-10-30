import { describe, expect, it } from 'vitest'
import {
  applyAnnotationDraft,
  classifyAnnotationRow,
  createAnnotationDraft,
  getDraftEntry,
  getDraftKind,
  hasDraftEdits,
  setDraftEntry,
  setDraftKind,
} from '../../../../src/services/annotations/draft.js'
import { SIDECAR_BASE_IRI } from '../../../../src/services/annotations/sidecar.js'

const MATH_REF = 'file:decay'
const X_ENTRY = { property: 'OPB:00340', species: ['CHEBI:29101'], location: 'GO:0005737' }
const SIDECAR = {
  mathRef: MATH_REF,
  file: 'file',
  component: { subject: `${SIDECAR_BASE_IRI}file#decay`, kind: 'transporter', is: ['uniprot:P11168'], isVersionOf: [] },
  variables: [{ variable: 'x', subject: `${SIDECAR_BASE_IRI}file#decay.x`, entity: null, ...X_ENTRY }],
  warnings: [],
}

describe('annotation drafts', () => {
  it('reads entries from the sidecar until the draft edits them', () => {
    const draft = createAnnotationDraft()
    expect(getDraftEntry(draft, SIDECAR, 'x')).toEqual(X_ENTRY)
    expect(getDraftEntry(draft, SIDECAR, 'k')).toBeNull()

    const cleared = setDraftEntry(draft, SIDECAR, 'x', null)
    expect(getDraftEntry(cleared, SIDECAR, 'x')).toBeNull()
    expect(hasDraftEdits(cleared)).toBe(true)
    expect(hasDraftEdits(draft)).toBe(false)
  })

  it('drops an edit that puts back the sidecar’s entry, and an empty entry is a clear', () => {
    const edited = setDraftEntry(createAnnotationDraft(), SIDECAR, 'x', { ...X_ENTRY, location: 'self' })
    const restored = setDraftEntry(edited, SIDECAR, 'x', { ...X_ENTRY, species: ['chebi:29101'] })
    expect(hasDraftEdits(restored)).toBe(false)

    const empty = setDraftEntry(createAnnotationDraft(), SIDECAR, 'x', { property: null, species: [], location: null })
    expect(empty.variables.get('x')).toBeNull()
    expect(hasDraftEdits(setDraftEntry(createAnnotationDraft(), SIDECAR, 'k', { property: null, species: [] }))).toBe(false)
  })

  it('reads and sets the module kind, dropping a change back to the sidecar’s', () => {
    expect(getDraftKind(createAnnotationDraft(), SIDECAR)).toEqual({ componentKind: 'transporter', transporter: 'uniprot:P11168' })
    expect(getDraftKind(createAnnotationDraft(), null)).toEqual({ componentKind: null, transporter: null })

    const membrane = setDraftKind(createAnnotationDraft(), SIDECAR, 'membrane')
    expect(getDraftKind(membrane, SIDECAR)).toEqual({ componentKind: 'membrane', transporter: null })
    expect(hasDraftEdits(setDraftKind(membrane, SIDECAR, 'transporter'))).toBe(false)
    expect(setDraftKind(membrane, SIDECAR, 'transporter', 'uniprot:Q9Y6M7')).toMatchObject({ transporter: 'uniprot:Q9Y6M7' })
  })

  it('applies edits to the sidecar, giving a new entry its subject', () => {
    let draft = setDraftEntry(createAnnotationDraft(), SIDECAR, 'x', null)
    draft = setDraftEntry(draft, SIDECAR, 'k', { property: 'OPB:00592', species: [], location: 'self' })
    draft = setDraftKind(draft, SIDECAR, 'compartment')
    const applied = applyAnnotationDraft(SIDECAR, draft, MATH_REF)
    expect(applied.variables).toEqual([
      { variable: 'k', subject: `${SIDECAR_BASE_IRI}file#decay.k`, entity: null, property: 'OPB:00592', species: [], location: 'self' },
    ])
    expect(applied.component.kind).toBe('compartment')
    expect(applyAnnotationDraft(SIDECAR, createAnnotationDraft(), MATH_REF)).toBe(SIDECAR)
  })

  it('applies edits when the math has no sidecar yet', () => {
    const draft = setDraftEntry(createAnnotationDraft(), null, 'k', { property: 'OPB:00592', species: [], location: 'self' })
    const applied = applyAnnotationDraft(null, draft, MATH_REF)
    expect(applied.mathRef).toBe(MATH_REF)
    expect(applied.variables.map((entry) => entry.variable)).toEqual(['k'])
  })

  it('classifies rows: the VoI, constants, and boundary conditions as variables', () => {
    const kinds = new Map([
      ['t', 'voi'],
      ['k', 'constant'],
      ['c', 'computed_constant'],
      ['b', 'constant'],
      ['x', 'state'],
    ])
    expect(classifyAnnotationRow({ name: 't' }, kinds)).toBe('voi')
    expect(classifyAnnotationRow({ name: 'k', type: 'constant' }, kinds)).toBe('constant')
    expect(classifyAnnotationRow({ name: 'c' }, kinds)).toBe('constant')
    expect(classifyAnnotationRow({ name: 'b', type: 'boundary_condition' }, kinds)).toBe('variable')
    expect(classifyAnnotationRow({ name: 'x' }, kinds)).toBe('variable')
    expect(classifyAnnotationRow({ name: 'x' }, null)).toBe('variable')
  })
})
