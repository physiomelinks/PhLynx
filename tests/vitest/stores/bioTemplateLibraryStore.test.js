import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  BUILT_IN_PIECE_TEMPLATES,
  getBuiltInPieceTemplate,
} from '../../../src/services/bioView/pieces/builtInTemplates.js'
import { writtenTemplate } from '../../../src/services/bioView/pieces/model.js'
import { parseTemplateText, templateFile } from '../../../src/services/bioView/templateFiles.js'
import {
  LOCAL_TEMPLATES_KEY,
  NOT_KEPT_WARNING,
  useBioTemplateLibraryStore,
} from '../../../src/stores/bioTemplateLibraryStore.js'

/** A user's own template: the epithelial cell under another id and name, as its file has it. */
const tubule = (extra = {}) => ({
  ...writtenTemplate(getBuiltInPieceTemplate('epithelial-cell')),
  id: 'proximal-tubule',
  name: 'Renal proximal tubule',
  ...extra,
})

/** A fresh store, as the app makes on start, reading whatever localStorage holds. */
function freshStore() {
  setActivePinia(createPinia())
  return useBioTemplateLibraryStore()
}

const stored = () => JSON.parse(window.localStorage.getItem(LOCAL_TEMPLATES_KEY))

describe('the template library', () => {
  beforeEach(() => window.localStorage.clear())
  afterEach(() => vi.restoreAllMocks())

  it('adds a template under a local id, after the built-ins, and keeps it in localStorage', () => {
    const store = freshStore()
    const { template, errors, warnings } = store.addLocalTemplate(tubule())
    expect(errors).toEqual([])
    expect(warnings).toEqual([])
    expect(template.id).toBe('local:proximal-tubule')
    expect(Object.isFrozen(template)).toBe(true)
    expect(store.library.map((t) => t.id)).toEqual([
      ...BUILT_IN_PIECE_TEMPLATES.map((t) => t.id),
      'local:proximal-tubule',
    ])
    expect(stored().map((t) => t.id)).toEqual(['local:proximal-tubule'])

    const again = freshStore()
    expect(again.localTemplates).toEqual([template])
    expect(again.getTemplate('local:proximal-tubule')).toEqual(template)
  })

  it('never takes a built-in id, even from a file that names one, and reads one already local', () => {
    const store = freshStore()
    expect(store.addLocalTemplate({ ...tubule(), id: 'epithelial-cell' }).template.id).toBe('local:epithelial-cell')
    expect(store.getTemplate('epithelial-cell')).toBe(getBuiltInPieceTemplate('epithelial-cell'))
    window.localStorage.clear()
    expect(freshStore().addLocalTemplate(tubule({ id: 'local:proximal-tubule' })).template.id).toBe(
      'local:proximal-tubule',
    )
  })

  it('numbers a different template with a taken id, and does not add the same one twice', () => {
    const store = freshStore()
    const first = store.addLocalTemplate(tubule()).template
    expect(store.addLocalTemplate(tubule()).template).toBe(first)
    expect(store.addLocalTemplate(tubule({ name: 'Distal tubule' })).template.id).toBe('local:proximal-tubule-2')
    expect(store.localTemplates).toHaveLength(2)
  })

  it('returns the errors and adds nothing for a template that is not written as pieces', () => {
    const store = freshStore()
    const { template, errors } = store.addLocalTemplate({ ...tubule(), schemaVersion: 3 })
    expect(template).toBeNull()
    expect(errors).toEqual(['"schemaVersion" must be 4.'])
    expect(store.localTemplates).toEqual([])
    expect(window.localStorage.getItem(LOCAL_TEMPLATES_KEY)).toBeNull()
  })

  it('passes on warnings for keys it ignores', () => {
    const { template, warnings } = freshStore().addLocalTemplate(tubule({ colour: 'red' }))
    expect(template).not.toBeNull()
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('colour')
  })

  it('removes a local template, but never a built-in', () => {
    const store = freshStore()
    const { template } = store.addLocalTemplate(tubule())
    expect(store.removeLocalTemplate(template.id)).toBe(true)
    expect(store.removeLocalTemplate(template.id)).toBe(false)
    expect(store.removeLocalTemplate('epithelial-cell')).toBe(false)
    expect(store.localTemplates).toEqual([])
    expect(stored()).toEqual([])
  })

  it('skips stored templates that are invalid, repeated or have no local id', () => {
    window.localStorage.setItem(
      LOCAL_TEMPLATES_KEY,
      JSON.stringify([
        tubule({ id: 'local:good' }),
        tubule({ id: 'local:good', name: 'Other' }),
        tubule({ id: 'not-local' }),
        { id: 'local:bad' },
      ]),
    )
    expect(freshStore().localTemplates.map((t) => [t.id, t.name])).toEqual([['local:good', 'Renal proximal tubule']])
  })

  it('warns when a template cannot be kept on this device, and starts empty when nothing can be read', () => {
    window.localStorage.setItem(LOCAL_TEMPLATES_KEY, '{not json')
    expect(freshStore().localTemplates).toEqual([])

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

  it('round trips a template through a file, and a built-in into the local library', () => {
    const store = freshStore()
    const { template } = store.addLocalTemplate(tubule())
    const file = templateFile(template)
    expect(file.filename).toBe('proximal-tubule.pieces.json')
    const { raw, errors } = parseTemplateText(file.text)
    expect(errors).toEqual([])
    store.removeLocalTemplate(template.id)
    expect(store.addLocalTemplate(raw).template).toEqual(template)

    const builtIn = getBuiltInPieceTemplate('cardiomyocyte')
    const copy = store.addLocalTemplate(parseTemplateText(templateFile(builtIn).text).raw).template
    expect({ ...copy, id: 'cardiomyocyte' }).toEqual(builtIn)
  })
})
