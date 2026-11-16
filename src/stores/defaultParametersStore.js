/**
 * Default parameter sets: the parameterisations imported for each math, which seed new instances. A set is keyed
 * `mathRef:paramRef`; one imported before any config names it waits unlinked until a config does.
 */
import { defineStore } from 'pinia'
import { ref } from 'vue'

import { useLibraryStore } from './libraryStore'
import { reconcileWithConfig } from '../utils/parameters/parse'
import { INSTANCE_SET_KIND, isOwnInstanceSet, setEntriesFromVariables } from '../utils/parameters/instanceSet'

/**
 * @typedef {import('../utils/parameters/parse').Param} Param
 * @typedef {{ref: string, source: {file: string, importedAt: string, kind?: 'instance', nodeId?: string},
 *   globals: Map<string, Param>, values: Map<string, Param>}} ParamSet - An instance set (`kind: 'instance'`) was made
 *   by the node `nodeId` from its values, and follows its saved edits.
 * @typedef {'replace'|'keep-both'} CollisionChoice - `keep-both` stores the new set as `<ref>_2`, `<ref>_3`, ...
 * @typedef {{mathRef: string|null, ref: string, fileRef: string, replaced: boolean, warnings: string[], set: ParamSet}}
 *   Placement - Where a set would be stored, as what; `fileRef` is the ref it was read as, which `ref` differs from
 *   when both are kept.
 */

/**
 * Gives a set's store key.
 *
 * @param {string} mathRef - Holds a `:` itself.
 * @param {string} paramRef - Never holds a `:`.
 * @returns {string}
 */
export const keyOf = (mathRef, paramRef) => `${mathRef}:${paramRef}`

/**
 * Splits a store key on its last `:`, since the math ref holds one too.
 *
 * @param {string} key
 * @returns {{mathRef: string, paramRef: string}}
 */
export function splitKey(key) {
  const at = key.lastIndexOf(':')
  return { mathRef: key.slice(0, Math.max(at, 0)), paramRef: key.slice(at + 1) }
}

/** A ref as a key may hold it, with no `:`. */
const cleanRef = (paramRef) => String(paramRef ?? '').replaceAll(':', '_')

/**
 * Makes a set from a parsed `module` parameter file.
 *
 * @param {{ref: string, globals: Map<string, Param>, values: Map<string, Param>}} file - A ParameterFile.
 * @param {string} fileName - The file it was read from.
 * @param {string} [importedAt] - ISO time; now when not given.
 * @returns {ParamSet}
 */
export function toParamSet(file, fileName, importedAt = new Date().toISOString()) {
  return {
    ref: cleanRef(file.ref),
    source: { file: fileName, importedAt },
    globals: new Map(file.globals),
    values: new Map(file.values),
  }
}

/** A set's source as saved: an instance set's kind and node too. */
function sourceState(source) {
  const saved = { file: source?.file ?? '', importedAt: source?.importedAt ?? '' }
  if (source?.kind === INSTANCE_SET_KIND) Object.assign(saved, { kind: INSTANCE_SET_KIND, nodeId: source.nodeId ?? '' })
  return saved
}

/** A set as saved, its maps as entry arrays. */
const setState = (set) => ({
  ref: set.ref,
  source: sourceState(set.source),
  globals: Array.from(set.globals),
  values: Array.from(set.values),
})

/** A saved set, or null when it is malformed. */
function readSetState(saved, paramRef) {
  if (!saved || typeof saved !== 'object') return null
  return {
    ref: cleanRef(saved.ref ?? paramRef),
    source: sourceState(saved.source),
    globals: new Map(Array.isArray(saved.globals) ? saved.globals : []),
    values: new Map(Array.isArray(saved.values) ? saved.values : []),
  }
}

/**
 * Gives the first ref free in a bucket: the ref itself, else `<ref>_2`, `<ref>_3`, ...
 *
 * @param {Map<string, ParamSet>} bucket
 * @param {string} paramRef
 * @returns {string}
 */
function freeRef(bucket, paramRef) {
  if (!bucket.has(paramRef)) return paramRef
  let n = 2
  while (bucket.has(`${paramRef}_${n}`)) n++
  return `${paramRef}_${n}`
}

export const useDefaultParametersStore = defineStore('defaultParameters', () => {
  /** mathRef -> paramRef -> ParamSet. */
  const sets = ref(new Map())
  /** paramRef -> ParamSet: sets no config has named yet. */
  const unlinked = ref(new Map())
  /** Links made when configs arrived, with their warnings, until the import report takes them. Not saved. */
  const recentLinks = ref([])

  const libraryStore = useLibraryStore()

  // A set imported first links once a config naming it arrives.
  libraryStore.$onAction(({ name, after }) => {
    if (name === 'addConfigFile' || name === 'addModule') {
      after(() => {
        const linked = linkUnlinked()
        if (linked.length) recentLinks.value.push(...linked)
      })
    }
  })

  /**
   * Gives the library modules whose config names a ref as its default parameterisation, one per math.
   *
   * @param {string} paramRef
   * @returns {Array<Object>}
   */
  function modulesDefaulting(paramRef) {
    const byMath = new Map()
    for (const module of libraryStore.availableModules.values()) {
      if (module.defaultParameterisation && cleanRef(module.defaultParameterisation) === paramRef) {
        if (!byMath.has(module.mathRef)) byMath.set(module.mathRef, module)
      }
    }
    return [...byMath.values()]
  }

  /** The bucket a math's sets live in, made when missing; the unlinked bucket for no math. */
  function bucketFor(mathRef, create = false) {
    if (!mathRef) return unlinked.value
    if (!sets.value.has(mathRef) && create) sets.value.set(mathRef, new Map())
    return sets.value.get(mathRef)
  }

  /**
   * Plans storing a set in a bucket, settling a clash with a set of the same ref. Changes nothing.
   *
   * @returns {Placement}
   */
  function place(mathRef, set, onCollision) {
    const bucket = bucketFor(mathRef) ?? new Map()
    const clash = bucket.has(set.ref)
    const ref = clash && onCollision === 'keep-both' ? freeRef(bucket, set.ref) : set.ref
    const replaced = clash && ref === set.ref
    return { mathRef: mathRef ?? null, ref, fileRef: set.ref, replaced, warnings: [], set: { ...set, ref } }
  }

  /** Plans storing a set for a module's math, sorted by the module's config types. */
  function placeFor(module, set, onCollision) {
    const { globals, values, warnings } = reconcileWithConfig(set, module)
    return { ...place(module.mathRef, { ...set, globals, values }, onCollision), warnings }
  }

  /**
   * Stores planned sets.
   *
   * @param {Placement[]} placements - From planSet.
   * @returns {Array<{mathRef: string|null, ref: string, fileRef: string, replaced: boolean, warnings: string[]}>}
   *   Where each went.
   */
  function commitSet(placements) {
    return placements.map(({ set, ...placed }) => {
      bucketFor(placed.mathRef, true).set(placed.ref, set)
      return placed
    })
  }

  /**
   * Gives the keys a set would clash with if added: under the given math, under every math whose config defaults
   * to it, or else in the unlinked bucket (keyed by `:ref`).
   *
   * @param {string} paramRef
   * @param {string|null} [mathRef]
   * @returns {string[]}
   */
  function collisionsFor(paramRef, mathRef = null) {
    const ref = cleanRef(paramRef)
    const mathRefs = mathRef ? [mathRef] : modulesDefaulting(ref).map((module) => module.mathRef)
    if (!mathRefs.length) return unlinked.value.has(ref) ? [keyOf('', ref)] : []
    return mathRefs.filter((each) => sets.value.get(each)?.has(ref)).map((each) => keyOf(each, ref))
  }

  /**
   * Plans adding a set: to the given math, else to every math whose config names it as the default, else unlinked.
   * Changes nothing, so the set each placement would store can be compared with what it replaces first.
   *
   * @param {ParamSet} set
   * @param {{mathRef?: string|null, onCollision?: CollisionChoice}} [options]
   * @returns {Placement[]}
   */
  function planSet(set, { mathRef = null, onCollision = 'keep-both' } = {}) {
    const clean = { ...set, ref: cleanRef(set.ref) }
    if (mathRef) return [place(mathRef, clean, onCollision)]
    const modules = modulesDefaulting(clean.ref)
    if (!modules.length) return [place(null, clean, onCollision)]
    return modules.map((module) => placeFor(module, clean, onCollision))
  }

  /**
   * Adds a set, as planSet places it.
   *
   * @param {ParamSet} set
   * @param {{mathRef?: string|null, onCollision?: CollisionChoice}} [options]
   * @returns {Array<{mathRef: string|null, ref: string, replaced: boolean, warnings: string[]}>} Where it went.
   */
  const addSet = (set, options) => commitSet(planSet(set, options))

  /**
   * Links each unlinked set a config now names as its default to that config's math, keeping both on a clash.
   *
   * @returns {Array<{mathRef: string, ref: string, fileRef: string, replaced: boolean, warnings: string[]}>}
   */
  function linkUnlinked() {
    const linked = []
    for (const [ref, set] of [...unlinked.value]) {
      const modules = modulesDefaulting(ref)
      if (!modules.length) continue
      for (const module of modules) linked.push(...commitSet([placeFor(module, set, 'keep-both')]))
      unlinked.value.delete(ref)
    }
    return linked
  }

  /** Gives and forgets the links made as configs arrived. */
  function takeRecentLinks() {
    const links = recentLinks.value
    recentLinks.value = []
    return links
  }

  /**
   * Gives a set.
   *
   * @param {string|null} mathRef - null for the unlinked bucket.
   * @param {string} paramRef
   * @returns {ParamSet|null}
   */
  function getSet(mathRef, paramRef) {
    return bucketFor(mathRef)?.get(paramRef) ?? null
  }

  /**
   * Gives a math's sets, in the order they were added.
   *
   * @param {string} mathRef
   * @returns {ParamSet[]}
   */
  function setsFor(mathRef) {
    return [...(sets.value.get(mathRef)?.values() ?? [])]
  }

  /**
   * Gives the ref a node's own set would take (addInstanceSet): its name without `:`, `_2`, `_3`, ... on a clash.
   *
   * @param {string} mathRef
   * @param {string} name - The node's name.
   * @returns {string}
   */
  const instanceSetRef = (mathRef, name) => freeRef(bucketFor(mathRef) ?? new Map(), cleanRef(name) || 'instance')

  /**
   * Adds the set a node dropped with Parameters "None" makes of its values. Its ref is the node's name, without `:`;
   * `<name>_2`, `<name>_3`, ... when the math already has a set of that ref.
   *
   * @param {string} mathRef
   * @param {string} nodeId - The node that made it, whose saved edits it follows.
   * @param {string} name - The node's name.
   * @param {Array} variables - The node's rows.
   * @param {string} [createdAt] - ISO time; now when not given.
   * @returns {ParamSet} The set added.
   */
  function addInstanceSet(mathRef, nodeId, name, variables, createdAt = new Date().toISOString()) {
    const bucket = bucketFor(mathRef, true)
    const ref = instanceSetRef(mathRef, name)
    const set = {
      ref,
      source: { file: '', importedAt: createdAt, kind: INSTANCE_SET_KIND, nodeId },
      ...setEntriesFromVariables(variables),
    }
    bucket.set(ref, set)
    return bucket.get(ref)
  }

  /**
   * Writes a node's values to the instance set it made. An imported set, or another node's, is never changed.
   *
   * @param {string} mathRef
   * @param {string} paramRef
   * @param {string} nodeId
   * @param {Array} variables - The node's rows.
   * @returns {boolean} Whether the set was written.
   */
  function updateInstanceSet(mathRef, paramRef, nodeId, variables) {
    const set = getSet(mathRef, paramRef)
    if (!isOwnInstanceSet(set, nodeId)) return false
    bucketFor(mathRef).set(paramRef, { ...set, ...setEntriesFromVariables(variables) })
    return true
  }

  /**
   * Writes values into a set, as a save asked to update a set others share. Each value replaces the entry of its name,
   * keeping its units and reference, wherever the set lists it; a value it lacks is added under the given kind.
   *
   * @param {string} mathRef
   * @param {string} paramRef
   * @param {{globals: Map<string, Param>, values: Map<string, Param>}} entries - From changedSetEntries.
   * @returns {ParamSet|null} The set as written, or null when there's none.
   */
  function updateSetEntries(mathRef, paramRef, entries) {
    const set = getSet(mathRef, paramRef)
    if (!set) return null
    const globals = new Map(set.globals)
    const values = new Map(set.values)
    const write = (name, param, fallback) => {
      const list = values.has(name) ? values : globals.has(name) ? globals : fallback
      const current = list.get(name)
      list.set(name, current ? { ...current, value: param.value } : param)
    }
    entries.globals.forEach((param, name) => write(name, param, globals))
    entries.values.forEach((param, name) => write(name, param, values))
    const written = { ...set, globals, values }
    bucketFor(mathRef).set(paramRef, written)
    return bucketFor(mathRef).get(paramRef)
  }

  /**
   * Puts a set back as it was, or removes it when it was not there; for undo.
   *
   * @param {string} mathRef
   * @param {string} paramRef
   * @param {ParamSet|null} set
   */
  function restoreSet(mathRef, paramRef, set) {
    if (set) bucketFor(mathRef, true).set(paramRef, set)
    else removeSet(mathRef, paramRef)
  }

  /**
   * Removes a set.
   *
   * @param {string|null} mathRef - null for the unlinked bucket.
   * @param {string} paramRef
   */
  function removeSet(mathRef, paramRef) {
    const bucket = bucketFor(mathRef)
    if (!bucket) return
    bucket.delete(paramRef)
    if (mathRef && !bucket.size) sets.value.delete(mathRef)
  }

  function resetState() {
    sets.value = new Map()
    unlinked.value = new Map()
    recentLinks.value = []
  }

  /**
   * Gives the saved state: linked sets by store key, unlinked ones by ref.
   *
   * @returns {{sets: Array<[string, Object]>, unlinked: Array<[string, Object]>}}
   */
  function getState() {
    const linked = []
    for (const [mathRef, bucket] of sets.value) {
      for (const [paramRef, set] of bucket) linked.push([keyOf(mathRef, paramRef), setState(set)])
    }
    return { sets: linked, unlinked: Array.from(unlinked.value, ([paramRef, set]) => [paramRef, setState(set)]) }
  }

  /**
   * Restores a saved state, replacing the sets held. Malformed entries are skipped.
   *
   * @param {{sets?: Array<[string, Object]>, unlinked?: Array<[string, Object]>}} [state]
   */
  function loadState(state) {
    resetState()
    for (const [key, saved] of Array.isArray(state?.sets) ? state.sets : []) {
      const { mathRef, paramRef } = splitKey(String(key))
      const set = readSetState(saved, paramRef)
      if (mathRef && set) bucketFor(mathRef, true).set(paramRef, set)
    }
    for (const [paramRef, saved] of Array.isArray(state?.unlinked) ? state.unlinked : []) {
      const set = readSetState(saved, paramRef)
      if (set) unlinked.value.set(cleanRef(paramRef), set)
    }
  }

  return {
    sets,
    unlinked,
    recentLinks,
    addSet,
    planSet,
    commitSet,
    collisionsFor,
    linkUnlinked,
    takeRecentLinks,
    getSet,
    setsFor,
    instanceSetRef,
    addInstanceSet,
    updateInstanceSet,
    updateSetEntries,
    restoreSet,
    removeSet,
    resetState,
    getState,
    loadState,
  }
})
