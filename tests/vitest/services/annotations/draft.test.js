import { describe, expect, it } from 'vitest'
import {
  applyAnnotationDraft,
  classifyAnnotationRow,
  createAnnotationDraft,
  draftBaseSidecar,
  getDraftEntry,
  getDraftKind,
  getDraftSpaceKind,
  hasDraftEdits,
  importDraftSidecar,
  renameDraftVariables,
  setDraftEntry,
  setDraftKind,
  setDraftSpaceKind,
  signDraft,
} from '../../../../src/services/annotations/draft.js'
import { SIDECAR_BASE_IRI } from '../../../../src/services/annotations/sidecar.js'

const MATH_REF = 'file:decay'
const X_ENTRY = { property: 'OPB:00340', species: ['CHEBI:29101'], location: 'GO:0005737' }
const FLOW_ENTRY = { property: 'OPB:00592', species: ['CHEBI:29101'], location: 'GO:0005737', from: 'GO:0005576' }
const SIDECAR = {
  mathRef: MATH_REF,
  file: 'file',
  component: { subject: `${SIDECAR_BASE_IRI}file#decay`, kind: 'transporter', is: ['uniprot:P11168'], isVersionOf: [] },
  variables: [
    { variable: 'x', id: 'vx0000000', subject: `${SIDECAR_BASE_IRI}file#vx0000000`, entity: null, ...X_ENTRY, from: null },
    { variable: 'f', id: 'vf0000000', subject: `${SIDECAR_BASE_IRI}file#vf0000000`, entity: null, ...FLOW_ENTRY },
  ],
  warnings: [],
}

describe('annotation drafts', () => {
  it('reads entries from the sidecar until the draft edits them', () => {
    const draft = createAnnotationDraft()
    expect(getDraftEntry(draft, SIDECAR, 'x')).toEqual({ ...X_ENTRY, from: null })
    expect(getDraftEntry(draft, SIDECAR, 'f')).toEqual(FLOW_ENTRY)
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

  it('reads and sets a compartment’s space kind, dropping a change back to the sidecar’s', () => {
    const pool = { ...SIDECAR, component: { ...SIDECAR.component, kind: 'compartment', spaceKind: 'GO:0005737' } }
    expect(getDraftSpaceKind(createAnnotationDraft(), pool)).toBe('GO:0005737')
    expect(getDraftSpaceKind(createAnnotationDraft(), SIDECAR)).toBeNull()
    const cleared = setDraftSpaceKind(createAnnotationDraft(), pool, null)
    expect(cleared.spaceKind).toBeNull()
    expect(hasDraftEdits(cleared)).toBe(true)
    expect(signDraft(cleared)).toMatchObject({ spaceKind: null })
    expect(getDraftSpaceKind(cleared, pool)).toBeNull()
    expect(hasDraftEdits(setDraftSpaceKind(cleared, pool, 'GO:0005737'))).toBe(false)
    const extracellular = setDraftSpaceKind(createAnnotationDraft(), pool, 'GO:0005576')
    expect(applyAnnotationDraft(pool, extracellular, MATH_REF).component.spaceKind).toBe('GO:0005576')
    const membrane = setDraftKind(extracellular, pool, 'membrane')
    expect(applyAnnotationDraft(pool, membrane, MATH_REF).component.spaceKind).toBeNull()
  })

  it('applies edits to the sidecar, giving a new entry its id subject, else a provisional one', () => {
    let draft = setDraftEntry(createAnnotationDraft(), SIDECAR, 'x', null)
    draft = setDraftEntry(draft, SIDECAR, 'k', { property: 'OPB:00592', species: [], location: 'self' })
    draft = setDraftEntry(draft, SIDECAR, 'y', { property: 'OPB:00340', species: [], location: 'self' })
    draft = setDraftKind(draft, SIDECAR, 'compartment')
    const applied = applyAnnotationDraft(SIDECAR, draft, MATH_REF, { ids: new Map([['k', 'vk0000000']]) })
    const entry = { entity: null, species: [], location: 'self', from: null, process: null }
    expect(applied.variables.slice(1)).toEqual([
      { variable: 'k', id: 'vk0000000', subject: `${SIDECAR_BASE_IRI}file#vk0000000`, ...entry, property: 'OPB:00592' },
      { variable: 'y', id: null, subject: `${SIDECAR_BASE_IRI}file#new%3Ay`, ...entry, property: 'OPB:00340' },
    ])
    expect(applied.variables[0].variable).toBe('f')
    expect(applied.component.kind).toBe('compartment')
    expect(applyAnnotationDraft(SIDECAR, createAnnotationDraft(), MATH_REF)).toBe(SIDECAR)
  })

  it('keeps a flow’s saved source while its location stays, and has none otherwise', () => {
    const { from, ...withoutFrom } = FLOW_ENTRY
    expect(from).toBe('GO:0005576')
    expect(hasDraftEdits(setDraftEntry(createAnnotationDraft(), SIDECAR, 'f', withoutFrom))).toBe(false)
    const none = setDraftEntry(createAnnotationDraft(), SIDECAR, 'f', { ...FLOW_ENTRY, from: null })
    expect(getDraftEntry(none, SIDECAR, 'f')).toEqual({ ...FLOW_ENTRY, from: null })

    const moved = setDraftEntry(createAnnotationDraft(), SIDECAR, 'f', { ...withoutFrom, location: 'GO:0005576' })
    expect(moved.variables.get('f')).toMatchObject({ location: 'GO:0005576' })
    expect(moved.variables.get('f').from).toBeNull()
    // Even a transporter's flow takes no source that wasn't chosen.
    expect(applyAnnotationDraft(SIDECAR, moved, MATH_REF).variables[1]).toMatchObject({
      location: 'GO:0005576',
      from: null,
      process: null,
    })
    const level = setDraftEntry(createAnnotationDraft(), SIDECAR, 'x', { ...X_ENTRY, from: 'GO:0005576' })
    expect(hasDraftEdits(level)).toBe(false)
  })

  it('gives a level that becomes a flow no source', () => {
    const flow = setDraftEntry(createAnnotationDraft(), SIDECAR, 'x', { ...X_ENTRY, property: 'OPB:00592' })
    expect(flow.variables.get('x').from).toBeNull()
    expect(applyAnnotationDraft(SIDECAR, flow, MATH_REF).variables[0]).toMatchObject({ from: null })
  })

  it('applies edits when the math has no sidecar yet', () => {
    const draft = setDraftEntry(createAnnotationDraft(), null, 'k', { property: 'OPB:00592', species: [], location: 'self' })
    const applied = applyAnnotationDraft(null, draft, MATH_REF)
    expect(applied.mathRef).toBe(MATH_REF)
    expect(applied.variables.map((entry) => entry.variable)).toEqual(['k'])
  })

  it('moves an edit made before its variable was renamed, and drops one on a variable now gone', () => {
    const draft = { ...createAnnotationDraft(), variables: new Map([['x', X_ENTRY], ['gone', X_ENTRY], ['k', null]]) }
    const renamed = renameDraftVariables(draft, new Map([['x', 'y']]), new Set(['y', 'k']))
    expect([...renamed.variables]).toEqual([['k', null], ['y', X_ENTRY]])
    expect(renameDraftVariables(renamed, new Map(), new Set(['y', 'k']))).toBe(renamed)
  })

  it('keeps an edit made after the rename over one made before it', () => {
    const later = { ...X_ENTRY, location: 'GO:0005886' }
    const draft = { ...createAnnotationDraft(), variables: new Map([['x', X_ENTRY], ['y', later]]) }
    expect(renameDraftVariables(draft, new Map([['x', 'y']]), new Set(['y'])).variables.get('y')).toBe(later)
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

describe('an imported sidecar', () => {
  it('replaces the math\'s as the base of the edits, dropping earlier edits', () => {
    const edited = setDraftKind(createAnnotationDraft(), SIDECAR, 'membrane')
    const imported = { ...SIDECAR, variables: [] }
    const draft = importDraftSidecar('# imported', imported)
    expect(edited.componentKind).toBe('membrane')
    expect(draft.componentKind).toBeUndefined()
    expect(hasDraftEdits(draft)).toBe(true)
    expect(draftBaseSidecar(draft, SIDECAR)).toBe(imported)
    expect(draftBaseSidecar(createAnnotationDraft(), SIDECAR)).toBe(SIDECAR)
    expect(signDraft(draft).imported).toBe('# imported')
    expect(getDraftEntry(draft, draftBaseSidecar(draft, SIDECAR), 'x')).toBeNull()
  })
})
