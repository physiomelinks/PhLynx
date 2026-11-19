import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { getBuiltInPieceTemplate } from '../../../src/services/bioView/pieces/builtInTemplates.js'
import { buildWorkspaceFile } from '../../../src/services/workspaceFile.js'
import { useBioPiecesStore } from '../../../src/stores/bioPiecesStore.js'

describe('bioPiecesStore', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('adds copies of a template’s pieces', () => {
    const store = useBioPiecesStore()
    const { errors } = store.addTemplate(getBuiltInPieceTemplate('cell'), { x: 0, y: 0 })
    expect(errors).toEqual([])
    expect(store.pieces.map((piece) => piece.id)).toEqual(['cell', 'plasma-membrane'])
  })

  it('keeps its pieces as they were when a list doesn’t validate', () => {
    const store = useBioPiecesStore()
    store.addTemplate(getBuiltInPieceTemplate('cell'), { x: 0, y: 0 })
    const before = store.pieces
    expect(store.setPieces([{ id: 'z', kind: 'zone', label: 'Z', compartment: 'nowhere' }]).errors).toHaveLength(1)
    expect(store.pieces).toBe(before)
  })

  it('saves and loads its pieces, and saves nothing without any', () => {
    const store = useBioPiecesStore()
    expect(store.getState()).toBeNull()
    store.addTemplate(getBuiltInPieceTemplate('cardiomyocyte'), { x: 40, y: 40 })
    const saved = JSON.parse(JSON.stringify(store.getState()))
    const copy = JSON.parse(JSON.stringify(store.pieces))
    store.resetState()
    store.loadState(saved)
    expect(JSON.parse(JSON.stringify(store.pieces))).toEqual(copy)
  })

  it('drops saved pieces that don’t validate, and loads empty without any', () => {
    const store = useBioPiecesStore()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    store.loadState({ pieces: [{ id: 'z', kind: 'zone', label: 'Z', compartment: 'nowhere' }] })
    expect(store.pieces).toEqual([])
    expect(warn).toHaveBeenCalled()
    store.loadState(undefined)
    expect(store.pieces).toEqual([])
    warn.mockRestore()
  })

  it('wraps a change as a step that can be put back either way', () => {
    const store = useBioPiecesStore()
    const step = store.edit(() => store.addTemplate(getBuiltInPieceTemplate('cell'), { x: 0, y: 0 }))
    step.apply()
    expect(step.isAt('after')).toBe(true)
    step.restore('before')
    expect(store.pieces).toEqual([])
    expect(step.isAt('before')).toBe(true)
    step.restore('after')
    expect(store.pieces).toHaveLength(2)
  })

  it('goes into the workspace file under bioPieces, only when there are pieces', () => {
    const store = useBioPiecesStore()
    const stub = { getState: () => ({}) }
    const file = (bioPieces) =>
      buildWorkspaceFile({
        flow: {},
        library: stub,
        simulation: stub,
        inspectionModules: stub,
        omex: stub,
        parameters: stub,
        bioPieces,
      })
    expect(file(store)).not.toHaveProperty('bioPieces')
    store.addTemplate(getBuiltInPieceTemplate('cell'), { x: 0, y: 0 })
    expect(file(store).bioPieces.pieces).toHaveLength(2)
  })
})
