import { defineStore } from 'pinia'
import { computed, ref, shallowRef } from 'vue'

import { BUILT_IN_TEMPLATES } from '../services/bioView/builtInTemplates'
import { INSTANCE_ID, validateTemplate } from '../services/bioView/templates'

/**
 * Makes a new template instance id.
 *
 * @returns {string} 'bt-' and eight hex digits.
 */
const newInstanceId = () => `bt-${crypto.randomUUID().slice(0, 8)}`

const isPoint = (at) => Number.isFinite(at?.x) && Number.isFinite(at?.y)

/**
 * Copies a saved instance, or returns null when it is malformed.
 *
 * @param {Object} instance
 * @returns {{ id: string, template: string, at: {x: number, y: number}, label?: string }|null}
 */
function normaliseInstance(instance) {
  if (typeof instance?.id !== 'string' || !INSTANCE_ID.test(instance.id)) return null
  if (typeof instance.template !== 'string' || !isPoint(instance.at)) return null
  const copy = { id: instance.id, template: instance.template, at: { x: instance.at.x, y: instance.at.y } }
  if (typeof instance.label === 'string' && instance.label.trim()) copy.label = instance.label.trim()
  return copy
}

const copyInstance = (instance) => ({ ...instance, at: { ...instance.at } })

/**
 * The workspace's physiology templates: the instances placed in the physiological view, and the copy of each
 * template they use. The embedded copy wins over the library, so a changed built-in leaves saved work as it was.
 */
export const useBioTemplateStore = defineStore('bioTemplates', () => {
  /** Placed templates, in the order they were added. */
  const instances = ref([])
  /** Template id -> the validated template this workspace uses. Frozen values, so replaced, never mutated. */
  const definitions = shallowRef(new Map())
  /** The user's own templates. Filled in by a later change; empty for now. */
  const localTemplates = ref([])
  /** Every template that can be added: the built-ins, then the user's. */
  const library = computed(() => [...BUILT_IN_TEMPLATES, ...localTemplates.value])

  function resetState() {
    instances.value = []
    definitions.value = new Map()
  }

  /**
   * @param {string} id - A template id.
   * @returns {Object|null} The workspace's copy of the template, else the library's.
   */
  function getDefinition(id) {
    return definitions.value.get(id) ?? library.value.find((template) => template.id === id) ?? null
  }

  /**
   * @param {string} id
   * @returns {Object|null} The instance with that id.
   */
  function getInstance(id) {
    return instances.value.find((instance) => instance.id === id) ?? null
  }

  /** Drops the definitions no instance uses. */
  function pruneDefinitions() {
    const used = new Set(instances.value.map((instance) => instance.template))
    if ([...definitions.value.keys()].every((id) => used.has(id))) return
    definitions.value = new Map([...definitions.value].filter(([id]) => used.has(id)))
  }

  /**
   * Places a template, embedding its library definition unless the workspace already has one.
   *
   * @param {string} templateId
   * @param {{x: number, y: number}} at
   * @param {string} [label]
   * @returns {Object|null} The new instance, or null when no such template exists.
   */
  function addInstance(templateId, at, label) {
    const template = getDefinition(templateId)
    if (!template || !isPoint(at)) return null
    if (!definitions.value.has(templateId)) definitions.value = new Map(definitions.value).set(templateId, template)
    const instance = normaliseInstance({ id: newInstanceId(), template: templateId, at, label })
    instances.value = [...instances.value, instance]
    return instance
  }

  /**
   * Updates one instance.
   *
   * @param {string} id
   * @param {(instance: Object) => Object} change - Gets a copy, returns the new instance.
   * @returns {boolean} Whether the instance exists.
   */
  function updateInstance(id, change) {
    const index = instances.value.findIndex((instance) => instance.id === id)
    if (index < 0) return false
    instances.value = instances.value.map((instance, i) => (i === index ? change(copyInstance(instance)) : instance))
    return true
  }

  /**
   * Moves an instance by `delta` or to `at`.
   *
   * @param {string} id
   * @param {{ delta?: {x: number, y: number}, at?: {x: number, y: number} }} move
   * @returns {boolean} Whether the instance moved.
   */
  function moveInstance(id, { delta, at } = {}) {
    if (!isPoint(at) && !isPoint(delta)) return false
    return updateInstance(id, (instance) => ({
      ...instance,
      at: isPoint(at) ? { x: at.x, y: at.y } : { x: instance.at.x + delta.x, y: instance.at.y + delta.y },
    }))
  }

  /**
   * Names an instance; a blank label goes back to the template's name.
   *
   * @param {string} id
   * @param {string} [label]
   * @returns {boolean} Whether the instance exists.
   */
  function renameInstance(id, label) {
    return updateInstance(id, (instance) => {
      delete instance.label
      return typeof label === 'string' && label.trim() ? { ...instance, label: label.trim() } : instance
    })
  }

  /**
   * Removes an instance, and its template's copy once no instance uses it.
   *
   * @param {string} id
   * @returns {boolean} Whether the instance existed.
   */
  function removeInstance(id) {
    const remaining = instances.value.filter((instance) => instance.id !== id)
    if (remaining.length === instances.value.length) return false
    instances.value = remaining
    pruneDefinitions()
    return true
  }

  /**
   * Copies the store for undo. Unlike getState it keeps the definition objects, so edits recorded before a
   * restore still recognise the store afterwards.
   *
   * @returns {{ instances: Array<Object>, definitions: Map<string, Object> }}
   */
  function snapshot() {
    return { instances: instances.value.map(copyInstance), definitions: new Map(definitions.value) }
  }

  /** @param {ReturnType<typeof snapshot>} state - From snapshot. */
  function restoreSnapshot(state) {
    instances.value = state.instances.map(copyInstance)
    definitions.value = new Map(state.definitions)
  }

  /**
   * Checks the store against a snapshot. Definitions are frozen, so the same object means the same template.
   *
   * @param {ReturnType<typeof snapshot>} state
   * @returns {boolean}
   */
  function isSnapshot(state) {
    if (JSON.stringify(instances.value) !== JSON.stringify(state.instances)) return false
    if (definitions.value.size !== state.definitions.size) return false
    return [...state.definitions].every(([id, template]) => definitions.value.get(id) === template)
  }

  /**
   * Wraps a change to the store as a recordEdit `library` option: `apply` makes the change, between snapshots
   * of the store, and `isAt` and `restore` then compare with or put back either side.
   *
   * @param {Function} mutate - Changes the store; its result is what `apply` returns.
   * @returns {{ apply: Function, isAt: (side: string) => boolean, restore: (side: string) => void }} Sides are
   *   'before' and 'after'.
   */
  function edit(mutate) {
    const states = {}
    return {
      apply: () => {
        states.before = snapshot()
        const result = mutate()
        states.after = snapshot()
        return result
      },
      isAt: (side) => !!states[side] && isSnapshot(states[side]),
      restore: (side) => {
        if (states[side]) restoreSnapshot(states[side])
      },
    }
  }

  /**
   * Restores saved state. Definitions that fail validation are skipped, and so are instances whose template
   * is missing; a workspace without templates loads empty.
   *
   * @param {Object} [state] - From getState.
   */
  function loadState(state) {
    resetState()
    if (!state) return
    const loaded = new Map()
    for (const [id, raw] of Object.entries(state.templates ?? {})) {
      const { template, errors } = validateTemplate(raw)
      if (!template) console.warn(`Skipping saved template ${id}:`, errors)
      else if (template.id !== id) console.warn(`Skipping saved template ${id}: its id is ${template.id}.`)
      else loaded.set(id, template)
    }

    const ids = new Set()
    const kept = []
    for (const saved of Array.isArray(state.instances) ? state.instances : []) {
      const instance = normaliseInstance(saved)
      if (!instance || ids.has(instance.id)) {
        console.warn('Skipping a malformed or repeated template instance:', saved)
      } else if (!loaded.has(instance.template)) {
        console.warn(`Skipping template instance ${instance.id}: template ${instance.template} is missing.`)
      } else {
        ids.add(instance.id)
        kept.push(instance)
      }
    }
    instances.value = kept
    definitions.value = loaded
    pruneDefinitions()
  }

  /**
   * @returns {{ templates: Object<string, Object>, instances: Array<Object> }|null} Null without instances, so
   *   a workspace without templates saves as before.
   */
  function getState() {
    if (!instances.value.length) return null
    const used = new Set(instances.value.map((instance) => instance.template))
    const templates = {}
    for (const [id, template] of definitions.value) {
      if (used.has(id)) templates[id] = JSON.parse(JSON.stringify(template))
    }
    return { templates, instances: instances.value.map(copyInstance) }
  }

  return {
    instances,
    definitions,
    localTemplates,
    library,
    resetState,
    getDefinition,
    getInstance,
    addInstance,
    moveInstance,
    renameInstance,
    removeInstance,
    snapshot,
    restoreSnapshot,
    edit,
    loadState,
    getState,
  }
})
