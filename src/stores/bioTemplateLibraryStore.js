import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

import { bareTemplateId, freeLocalId, isLocalTemplateId } from '../services/bioView/localIds'
import { BUILT_IN_PIECE_TEMPLATES } from '../services/bioView/pieces/builtInTemplates'
import { validatePiecesTemplate, writtenTemplate } from '../services/bioView/pieces/model'

/** Where the user's own templates are kept, in localStorage. */
export const LOCAL_TEMPLATES_KEY = 'phlynx-bio-pieces-templates-local'

/** The warning given when a template could not be kept on this device. */
export const NOT_KEPT_WARNING = 'It could not be kept on this device, so it will be gone from My Templates next time.'

/** @returns {Array<Object>} The user's templates kept on this device; invalid or repeated ones are skipped. */
function readLocalTemplates() {
  let stored
  try {
    stored = JSON.parse(window.localStorage.getItem(LOCAL_TEMPLATES_KEY) ?? '[]')
  } catch {
    return [] // localStorage unavailable (e.g. private browsing) or unreadable
  }
  if (!Array.isArray(stored)) return []
  const kept = new Map()
  for (const raw of stored) {
    const { template } = validatePiecesTemplate(raw, { allowLocalId: true })
    if (template && isLocalTemplateId(template.id) && !kept.has(template.id)) kept.set(template.id, template)
  }
  return [...kept.values()]
}

/**
 * @param {Array<Object>} templates - Kept on this device.
 * @returns {boolean} Whether they were kept; false when localStorage is full or unavailable.
 */
function writeLocalTemplates(templates) {
  try {
    window.localStorage.setItem(LOCAL_TEMPLATES_KEY, JSON.stringify(templates.map(writtenTemplate)))
    return true
  } catch {
    return false
  }
}

/** Whether two templates are the same apart from their ids. */
const sameTemplate = (a, b) => JSON.stringify({ ...a, id: '' }) === JSON.stringify({ ...b, id: '' })

/**
 * The templates the physiology view can be built from: the built-ins, then the user's own, kept on this device with
 * 'local:' ids. A template is only a shortcut: placing one adds copies of its pieces to the workspace (see
 * bioPiecesStore), so the library is no part of a workspace.
 */
export const useBioTemplateLibraryStore = defineStore('bioTemplateLibrary', () => {
  /** The user's own templates. */
  const localTemplates = ref(readLocalTemplates())
  /** Every template that can be placed: the built-ins, then the user's. */
  const library = computed(() => [...BUILT_IN_PIECE_TEMPLATES, ...localTemplates.value])

  /**
   * @param {string} id
   * @returns {Object|null} The library's template with that id.
   */
  const getTemplate = (id) => library.value.find((template) => template.id === id) ?? null

  /**
   * Validates a template and adds it to the user's library under a 'local:' id, which gets a number added when a
   * different template has it. The same template loaded again is not added twice.
   *
   * @param {*} raw - Parsed JSON, usually a template file.
   * @returns {{ template: Object|null, errors: Array<string>, warnings: Array<string> }} The library's copy.
   */
  function addLocalTemplate(raw) {
    const bare = typeof raw?.id === 'string' ? bareTemplateId(raw.id) : undefined
    const { template, errors, warnings } = validatePiecesTemplate(bare ? { ...raw, id: bare } : raw)
    if (!template) return { template: null, errors, warnings }
    const known = localTemplates.value.find((local) => sameTemplate(local, template))
    if (known) return { template: known, errors, warnings }
    const id = freeLocalId(
      template.id,
      library.value.map((each) => each.id),
    )
    const { template: local } = validatePiecesTemplate({ ...writtenTemplate(template), id }, { allowLocalId: true })
    if (!local) return { template: null, errors: ['The template could not be read back once given its id.'], warnings }
    localTemplates.value = [...localTemplates.value, local]
    const kept = writeLocalTemplates(localTemplates.value)
    return { template: local, errors, warnings: kept ? warnings : [...warnings, NOT_KEPT_WARNING] }
  }

  /**
   * Removes a template from the user's library. What was placed from it stays, as its own pieces.
   *
   * @param {string} id
   * @returns {boolean} Whether it was there.
   */
  function removeLocalTemplate(id) {
    const remaining = localTemplates.value.filter((template) => template.id !== id)
    if (remaining.length === localTemplates.value.length) return false
    localTemplates.value = remaining
    writeLocalTemplates(remaining)
    return true
  }

  return { localTemplates, library, getTemplate, addLocalTemplate, removeLocalTemplate }
})
