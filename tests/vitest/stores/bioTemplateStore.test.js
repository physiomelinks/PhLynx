import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { getBuiltInTemplate } from '../../../src/services/bioView/builtInTemplates.js'
import { validateTemplate } from '../../../src/services/bioView/templates.js'
import { useBioTemplateStore } from '../../../src/stores/bioTemplateStore.js'

const plain = (value) => JSON.parse(JSON.stringify(value))

/** The epithelial cell renamed, as a workspace saved before the built-in changed would hold it. */
const savedEpithelial = () => ({ ...plain(getBuiltInTemplate('epithelial-cell')), name: 'Old epithelial cell' })

describe('bioTemplateStore', () => {
  let store
  let warn

  beforeEach(() => {
    setActivePinia(createPinia())
    store = useBioTemplateStore()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => warn.mockRestore())

  it('lists the built-ins in its library', () => {
    expect(store.library.map((template) => template.id)).toContain('epithelial-cell')
    expect(store.getDefinition('epithelial-cell')).toBe(getBuiltInTemplate('epithelial-cell'))
    expect(store.getDefinition('nope')).toBeNull()
  })

  it('adds an instance and embeds its template once', () => {
    const first = store.addInstance('epithelial-cell', { x: 10, y: 20 })
    const second = store.addInstance('epithelial-cell', { x: 400, y: 20 }, ' Gut ')

    expect(first).toEqual({
      id: expect.stringMatching(/^bt-[0-9a-f]{8}$/),
      template: 'epithelial-cell',
      at: { x: 10, y: 20 },
    })
    expect(second.label).toBe('Gut')
    expect(first.id).not.toBe(second.id)
    expect(store.instances).toHaveLength(2)
    expect([...store.definitions.keys()]).toEqual(['epithelial-cell'])
    expect(store.addInstance('nope', { x: 0, y: 0 })).toBeNull()
    expect(store.addInstance('enterocyte', { x: Number.NaN, y: 0 })).toBeNull()
    expect(store.instances).toHaveLength(2)
  })

  it('moves an instance by a delta or to a point', () => {
    const { id } = store.addInstance('enterocyte', { x: 10, y: 20 })

    expect(store.moveInstance(id, { delta: { x: 5, y: -5 } })).toBe(true)
    expect(store.getInstance(id).at).toEqual({ x: 15, y: 15 })
    expect(store.moveInstance(id, { at: { x: 0, y: 1 } })).toBe(true)
    expect(store.getInstance(id).at).toEqual({ x: 0, y: 1 })
    expect(store.moveInstance(id, {})).toBe(false)
    expect(store.moveInstance('bt-missing', { at: { x: 0, y: 0 } })).toBe(false)
  })

  it('renames an instance, and a blank label clears it', () => {
    const { id } = store.addInstance('enterocyte', { x: 0, y: 0 })

    store.renameInstance(id, '  Villus ')
    expect(store.getInstance(id).label).toBe('Villus')
    store.renameInstance(id, '  ')
    expect(store.getInstance(id)).not.toHaveProperty('label')
    expect(store.renameInstance('bt-missing', 'x')).toBe(false)
  })

  it('drops a template copy once no instance uses it', () => {
    const a = store.addInstance('enterocyte', { x: 0, y: 0 })
    const b = store.addInstance('enterocyte', { x: 300, y: 0 })

    store.removeInstance(a.id)
    expect(store.definitions.has('enterocyte')).toBe(true)
    store.removeInstance(b.id)
    expect(store.definitions.size).toBe(0)
    expect(store.removeInstance(b.id)).toBe(false)
  })

  it('uses the embedded copy over a changed library template', () => {
    store.loadState({
      templates: { 'epithelial-cell': savedEpithelial() },
      instances: [{ id: 'bt-old', template: 'epithelial-cell', at: { x: 0, y: 0 } }],
    })

    expect(store.getDefinition('epithelial-cell').name).toBe('Old epithelial cell')
    store.addInstance('epithelial-cell', { x: 500, y: 0 })
    expect(store.definitions.get('epithelial-cell').name).toBe('Old epithelial cell')
  })

  it('returns null state without instances, and the used templates and instances with them', () => {
    expect(store.getState()).toBeNull()
    const instance = store.addInstance('vessel-wall', { x: 1, y: 2 }, 'Capillary')

    const state = store.getState()
    expect(state.instances).toEqual([instance])
    expect(Object.keys(state.templates)).toEqual(['vessel-wall'])
    expect(state.templates['vessel-wall']).toEqual(plain(getBuiltInTemplate('vessel-wall')))
  })

  it('round trips its state through loadState', () => {
    store.addInstance('epithelial-cell', { x: 0, y: 0 })
    store.addInstance('chemical-synapse', { x: 600, y: 0 }, 'Synapse')
    const state = plain(store.getState())

    setActivePinia(createPinia())
    const loaded = useBioTemplateStore()
    loaded.loadState(state)

    expect(loaded.getState()).toEqual(state)
    const { template } = validateTemplate(state.templates['epithelial-cell'])
    expect(loaded.definitions.get('epithelial-cell')).toEqual(template)
    expect(warn).not.toHaveBeenCalled()
  })

  it('skips invalid templates, and instances whose template is missing or that are malformed', () => {
    store.loadState({
      templates: {
        enterocyte: plain(getBuiltInTemplate('enterocyte')),
        broken: { schemaVersion: 1, id: 'broken', name: 'Broken', cells: 'nope' },
        renamed: plain(getBuiltInTemplate('vessel-wall')),
      },
      instances: [
        { id: 'bt-1', template: 'enterocyte', at: { x: 0, y: 0 } },
        { id: 'bt-2', template: 'broken', at: { x: 0, y: 0 } },
        { id: 'bt-3', template: 'renamed', at: { x: 0, y: 0 } },
        { id: 'bt-4', template: 'epithelial-cell', at: { x: 0, y: 0 } },
        { id: 'bt-1', template: 'enterocyte', at: { x: 9, y: 9 } },
        { id: 'bt 5', template: 'enterocyte', at: { x: 0, y: 0 } },
        { id: 'bt-6', template: 'enterocyte', at: { x: 'a', y: 0 } },
      ],
    })

    expect(store.instances).toEqual([{ id: 'bt-1', template: 'enterocyte', at: { x: 0, y: 0 } }])
    expect([...store.definitions.keys()]).toEqual(['enterocyte'])
    expect(warn).toHaveBeenCalled()
  })

  it('loads empty from a missing state and resets', () => {
    store.addInstance('enterocyte', { x: 0, y: 0 })
    store.loadState(undefined)
    expect(store.instances).toEqual([])
    expect(store.definitions.size).toBe(0)

    store.addInstance('enterocyte', { x: 0, y: 0 })
    store.resetState()
    expect(store.getState()).toBeNull()
  })

  describe('edit', () => {
    it('applies a change and reports which side the store is at', () => {
      const change = store.edit(() => store.addInstance('enterocyte', { x: 0, y: 0 }))
      expect(change.isAt('before')).toBe(false)

      const instance = change.apply()
      expect(store.instances).toEqual([instance])
      expect(change.isAt('after')).toBe(true)
      expect(change.isAt('before')).toBe(false)

      change.restore('before')
      expect(store.getState()).toBeNull()
      expect(store.definitions.size).toBe(0)
      expect(change.isAt('before')).toBe(true)

      change.restore('after')
      expect(store.instances).toEqual([instance])
      expect(store.definitions.has('enterocyte')).toBe(true)
      expect(change.isAt('after')).toBe(true)
    })

    it('is at neither side once a later change moves the store on', () => {
      const { id } = store.addInstance('enterocyte', { x: 0, y: 0 })
      const change = store.edit(() => store.moveInstance(id, { delta: { x: 10, y: 0 } }))
      change.apply()

      store.renameInstance(id, 'Later')
      expect(change.isAt('after')).toBe(false)
      expect(change.isAt('before')).toBe(false)
    })

    it('restores copies, so later changes do not alter the snapshot', () => {
      const { id } = store.addInstance('enterocyte', { x: 0, y: 0 })
      const change = store.edit(() => store.removeInstance(id))
      change.apply()
      change.restore('before')
      store.moveInstance(id, { at: { x: 50, y: 50 } })

      change.restore('before')
      expect(store.getInstance(id).at).toEqual({ x: 0, y: 0 })
    })
  })
})
