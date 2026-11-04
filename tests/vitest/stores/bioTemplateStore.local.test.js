import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BUILT_IN_TEMPLATES, getBuiltInTemplate } from '../../../src/services/bioView/builtInTemplates.js'
import { parseTemplateText, templateFile } from '../../../src/services/bioView/templateFiles.js'
import { LOCAL_TEMPLATES_KEY, NOT_KEPT_WARNING, useBioTemplateStore } from '../../../src/stores/bioTemplateStore.js'

const plain = (value) => JSON.parse(JSON.stringify(value))

/** A user's own template: the epithelial cell under another id and name. */
const tubule = (extra = {}) => ({
  ...plain(getBuiltInTemplate('epithelial-cell')),
  id: 'proximal-tubule',
  name: 'Renal proximal tubule',
  ...extra,
})

/** A fresh store, as the app makes on start, reading whatever localStorage holds. */
function freshStore() {
  setActivePinia(createPinia())
  return useBioTemplateStore()
}

const stored = () => JSON.parse(window.localStorage.getItem(LOCAL_TEMPLATES_KEY))

describe('bioTemplateStore local library', () => {
  let warn

  beforeEach(() => {
    window.localStorage.clear()
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
    vi.restoreAllMocks()
  })

  it('adds a template under a local id, after the built-ins, and keeps it in localStorage', () => {
    const store = freshStore()
    const { template, errors, warnings } = store.addLocalTemplate(tubule())

    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    expect(template.id).toBe('local:proximal-tubule')
    expect(Object.isFrozen(template)).toBe(true)
    expect(store.library.map((t) => t.id)).toEqual([...BUILT_IN_TEMPLATES.map((t) => t.id), 'local:proximal-tubule'])
    expect(stored().map((t) => t.id)).toEqual(['local:proximal-tubule'])

    const again = freshStore()
    expect(again.localTemplates).toEqual([template])
    expect(again.getDefinition('local:proximal-tubule')).toEqual(template)
  })

  it('never takes a built-in id, even from a file that names one', () => {
    const store = freshStore()
    const { template } = store.addLocalTemplate({ ...tubule(), id: 'epithelial-cell' })
    expect(template.id).toBe('local:epithelial-cell')
    expect(store.getDefinition('epithelial-cell')).toBe(getBuiltInTemplate('epithelial-cell'))
  })

  it('reads a file id that already has the local prefix', () => {
    expect(freshStore().addLocalTemplate(tubule({ id: 'local:proximal-tubule' })).template.id).toBe(
      'local:proximal-tubule'
    )
  })

  it('numbers a different template with a taken id, and does not add the same one twice', () => {
    const store = freshStore()
    const first = store.addLocalTemplate(tubule()).template
    expect(store.addLocalTemplate(tubule()).template).toBe(first)
    expect(store.addLocalTemplate(tubule({ name: 'Distal tubule' })).template.id).toBe('local:proximal-tubule-2')
    expect(store.localTemplates).toHaveLength(2)
  })

  it('returns the errors and adds nothing for an invalid template', () => {
    const store = freshStore()
    const { template, errors } = store.addLocalTemplate({ ...tubule(), schemaVersion: 2 })
    expect(template).toBeNull()
    expect(errors).toEqual(['Template: "schemaVersion" must be 1.'])
    expect(store.localTemplates).toEqual([])
    expect(window.localStorage.getItem(LOCAL_TEMPLATES_KEY)).toBeNull()
  })

  it('passes on warnings for keys it ignores', () => {
    const { template, warnings } = freshStore().addLocalTemplate(tubule({ colour: 'red' }))
    expect(template).not.toBeNull()
    expect(warnings).toEqual(['Template: unknown key "colour" was ignored.'])
  })

  it('removes a local template, and leaves placed ones with their workspace copy', () => {
    const store = freshStore()
    const { template } = store.addLocalTemplate(tubule())
    const instance = store.addInstance(template.id, { x: 0, y: 0 })

    expect(store.removeLocalTemplate(template.id)).toBe(true)
    expect(store.removeLocalTemplate(template.id)).toBe(false)
    expect(store.removeLocalTemplate('epithelial-cell')).toBe(false)
    expect(store.localTemplates).toEqual([])
    expect(stored()).toEqual([])
    expect(store.getDefinition(instance.template)).toBe(template)
  })

  it('skips stored templates that are invalid or have no local id', () => {
    window.localStorage.setItem(
      LOCAL_TEMPLATES_KEY,
      JSON.stringify([tubule({ id: 'local:good' }), tubule({ id: 'not-local' }), { id: 'local:bad' }])
    )
    expect(freshStore().localTemplates.map((t) => t.id)).toEqual(['local:good'])
  })

  it('keeps the first of stored templates that share an id', () => {
    window.localStorage.setItem(
      LOCAL_TEMPLATES_KEY,
      JSON.stringify([tubule({ id: 'local:good' }), tubule({ id: 'local:good', name: 'Other' })])
    )
    expect(freshStore().localTemplates.map((t) => t.name)).toEqual(['Renal proximal tubule'])
  })

  it('warns when the template cannot be kept on this device', () => {
    const store = freshStore()
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError')
      },
    }
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue(full)
    const { template, warnings } = store.addLocalTemplate(tubule())
    expect(template.id).toBe('local:proximal-tubule')
    expect(warnings).toEqual([NOT_KEPT_WARNING])
  })

  it('starts empty when localStorage is unreadable or unavailable', () => {
    window.localStorage.setItem(LOCAL_TEMPLATES_KEY, '{not json')
    expect(freshStore().localTemplates).toEqual([])

    // jsdom's Storage ignores spies on its prototype, so the whole object is swapped.
    const blocked = () => {
      throw new Error('blocked')
    }
    vi.spyOn(window, 'localStorage', 'get').mockReturnValue({ getItem: blocked, setItem: blocked })
    const store = freshStore()
    expect(store.localTemplates).toEqual([])
    const { template, warnings } = store.addLocalTemplate(tubule())
    expect(template.id).toBe('local:proximal-tubule')
    expect(warnings).toEqual([NOT_KEPT_WARNING])
  })

  it('saves a workspace that embeds a local template, which opens without it', () => {
    const store = freshStore()
    const { template } = store.addLocalTemplate(tubule())
    store.addInstance(template.id, { x: 5, y: 6 })
    const state = plain(store.getState())
    expect(Object.keys(state.templates)).toEqual(['local:proximal-tubule'])

    window.localStorage.clear()
    const elsewhere = freshStore()
    expect(elsewhere.localTemplates).toEqual([])
    elsewhere.loadState(state)
    expect(elsewhere.instances).toHaveLength(1)
    expect(elsewhere.getDefinition('local:proximal-tubule')).toEqual(template)
    expect(warn).not.toHaveBeenCalled()

    // Loading its file there adds the workspace's copy to the library under the same id.
    const { raw } = parseTemplateText(templateFile(template).text)
    expect(elsewhere.addLocalTemplate(raw).template).toBe(elsewhere.getDefinition('local:proximal-tubule'))
  })

  it('gives a workspace template a free id when the user has a different one under its id', () => {
    const elsewhere = freshStore()
    const theirs = elsewhere.addLocalTemplate(tubule()).template
    const instance = elsewhere.addInstance(theirs.id, { x: 1, y: 2 })
    const state = plain(elsewhere.getState())

    window.localStorage.clear()
    const store = freshStore()
    const mine = store.addLocalTemplate(tubule({ name: 'My tubule' })).template
    expect(mine.id).toBe('local:proximal-tubule')
    store.loadState(state)

    expect(store.getInstance(instance.id).template).toBe('local:proximal-tubule-2')
    expect(store.getDefinition('local:proximal-tubule-2').name).toBe('Renal proximal tubule')
    expect(store.getDefinition('local:proximal-tubule')).toBe(mine)
    expect(Object.keys(store.getState().templates)).toEqual(['local:proximal-tubule-2'])

    // Loading the other file now joins the workspace's copy, without taking the user's id.
    const { raw } = parseTemplateText(templateFile(theirs).text)
    expect(store.addLocalTemplate(raw).template.id).toBe('local:proximal-tubule-2')
    expect(new Set(store.library.map((t) => t.id)).size).toBe(store.library.length)
  })

  it('keeps the id of a workspace template the user has too', () => {
    const store = freshStore()
    const { template } = store.addLocalTemplate(tubule())
    store.addInstance(template.id, { x: 0, y: 0 })
    const state = plain(store.getState())
    const again = freshStore()
    again.loadState(state)
    expect(again.instances[0].template).toBe('local:proximal-tubule')
    expect(again.definitions.has('local:proximal-tubule')).toBe(true)
  })

  it('round trips a template through Save Template As File and Load Template File', () => {
    const store = freshStore()
    const { template } = store.addLocalTemplate(tubule())
    const file = templateFile(template)
    expect(file.filename).toBe('proximal-tubule.template.json')

    const { raw, errors } = parseTemplateText(file.text)
    expect(errors).toEqual([])
    store.removeLocalTemplate(template.id)
    expect(store.addLocalTemplate(raw).template).toEqual(template)
  })

  it('round trips a built-in through a file into the local library', () => {
    const store = freshStore()
    const builtIn = getBuiltInTemplate('epithelial-cell')
    const { raw } = parseTemplateText(templateFile(builtIn).text)
    const { template } = store.addLocalTemplate(raw)
    expect({ ...template, id: 'epithelial-cell' }).toEqual(builtIn)
  })
})
