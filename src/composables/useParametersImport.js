import { useDefaultParametersStore, toParamSet } from '../stores/defaultParametersStore'
import { useLibraryStore } from '../stores/libraryStore'
import { applyInstancesToNodes, planGlobals, planSetApply, planSetsForNodes, setApplyConfirmation } from '../utils/parameters/apply'
import { applyParametersToNodes, skippedParametersMessage } from '../utils/parameters'
import { csvToModuleFile } from '../utils/parameters/parse'

const isSame = (value, otherValue) => JSON.stringify(value) === JSON.stringify(otherValue)

/** Whether two sets hold the same globals and values. */
const sameValues = (set, other) =>
  Boolean(other) && isSame([...set.globals], [...other.globals]) && isSame([...set.values], [...other.values])

/**
 * Imports parsed parameter files: a module parameterisation into the default-parameters store, applied to the
 * instances of its math named after it or seeded with it; a model file's values to nodes by instance. A
 * `<variable>_<instance>` CSV is left to the caller's `applyParametersToNodes` path. A set no config links yet is only
 * stored; once one does, `applyLinkedSets` offers it to the instances named after it.
 *
 * @param {Object} deps
 * @param {import('vue').Ref<Array>} deps.nodes - Workspace nodes.
 * @param {Function} deps.recordEdit - From useNodeDataHistory; makes each file one undo step.
 * @param {Function} deps.confirm - From useConfirmDialog.
 * @param {Function} deps.choose - From useConfirmDialog.
 */
export function useParametersImport({ nodes, recordEdit, confirm, choose }) {
  const libraryStore = useLibraryStore()
  const defaults = useDefaultParametersStore()

  /** Names of the variables the workspace's nodes have. */
  const variableNames = () => new Set(nodes.value.flatMap((node) => node.data.variables.map((row) => row.name.trim())))

  /**
   * Writes new rows, and the sets they now come from, to nodes.
   *
   * @param {Map<string, Array>} variablesById
   * @param {Map<string, string>} [tags] - The set ref each node is to record.
   */
  function writeRows(variablesById, tags = new Map()) {
    for (const node of nodes.value) {
      if (variablesById.has(node.id)) node.data.variables = variablesById.get(node.id)
      if (tags.has(node.id)) node.data.parameterisation = tags.get(node.id)
    }
  }

  /** Sets global constants, keeping those already set unless told to overwrite. */
  const assign = (globals, overwrite = false) =>
    globals.forEach((g) => libraryStore.assignGlobalConstant(g.name, g.value, g.units, g.data_reference, overwrite))

  /**
   * Runs an edit as one undo step that also restores the default-parameters store, or just runs it.
   *
   * @param {string} type
   * @param {string[]} nodeIds
   * @param {Function} apply
   * @param {boolean} record
   */
  async function edit(type, nodeIds, apply, record) {
    if (!record) {
      apply()
      return
    }
    const states = { before: defaults.getState() }
    await recordEdit({
      type,
      nodeIds,
      keys: ['variables', 'parameterisation'],
      apply: () => {
        apply()
        states.after = defaults.getState()
      },
      library: {
        isAt: (side) => isSame(defaults.getState(), states[side]),
        restore: (side) => defaults.loadState(states[side]),
      },
    })
  }

  /**
   * Gives a `<variable>_<instance>` CSV as a module file when it matches no instance and its name is a configured
   * default parameterisation (a module library CSV with no `sourced` column).
   *
   * @param {import('../utils/parameters/parse').ParameterFile} file
   * @returns {import('../utils/parameters/parse').ParameterFile}
   */
  function retryCsvAsModule(file) {
    if (!file.rows) return file
    const result = applyParametersToNodes(nodes.value, file.rows)
    if (result.updated || result.skipped.length) return file
    const isDefault = [...libraryStore.availableModules.values()].some((module) => module.defaultParameterisation === file.ref)
    return isDefault ? csvToModuleFile(file.rows, file.ref) : file
  }

  /**
   * Plans storing a module parameterisation, asking first when its ref is taken.
   *
   * @returns {Promise<{placements: Array}|{result: Object}>} The placements, or the result of a skipped file.
   */
  async function planModuleFile(file, fileName) {
    const set = toParamSet(file, fileName)
    let onCollision = 'keep-both'
    if (defaults.collisionsFor(set.ref).length) {
      // The same values loaded again replace the set without asking, so a model's files can be reloaded.
      const again = defaults.planSet(set, { onCollision: 'replace' })
      if (again.every((placement) => sameValues(placement.set, defaults.getSet(placement.mathRef, placement.ref)))) {
        return { placements: again }
      }
      const choice = await choose({
        header: 'Parameter Set Already Loaded',
        message: `A parameter set named "${set.ref}" is already loaded. Replace it, or keep both (the new one as "${set.ref}_2")?`,
        acceptLabel: 'Keep both',
        extraLabel: 'Replace',
        rejectLabel: 'Skip',
      })
      if (choice === 'reject') {
        return { result: { fileName, ok: false, count: 0, stored: [], warnings: ['skipped, as a set of that name is loaded'] } }
      }
      if (choice === 'extra') onCollision = 'replace'
    }
    return { placements: defaults.planSet(set, { onCollision }) }
  }

  /**
   * The sets placements store, as targets for the instances: by name only for a set kept under the ref it was read
   * as, so a `<ref>_2` copy never reaches an instance that happens to share its name.
   *
   * @param {Array<{mathRef: string|null, ref: string, fileRef: string, set: Object}>} placements
   * @returns {import('../utils/parameters/apply').SetTarget[]}
   */
  const targetsOf = (placements) =>
    placements
      .filter((placement) => placement.mathRef && placement.set)
      .map(({ mathRef, ref, fileRef, set }) => ({ mathRef, set, byName: ref === fileRef }))

  /**
   * Asks before sets change instance values, listing the changes by instance.
   *
   * @param {string[]} refs - The sets.
   * @param {import('../utils/parameters/apply').ValueChange[]} changed
   * @param {boolean} canCancel - Offers to load nothing as well as to keep the instance values.
   * @returns {Promise<'apply'|'keep'|'cancel'>}
   */
  async function askToApply(refs, changed, canCancel) {
    const byNode = new Map()
    for (const change of changed) {
      if (!byNode.has(change.nodeId)) byNode.set(change.nodeId, { name: change.nodeName, changes: [] })
      byNode.get(change.nodeId).changes.push(`${change.name}: ${change.from || '(blank)'} → ${change.to || '(blank)'}`)
    }
    const values = `${changed.length} ${changed.length === 1 ? 'value' : 'values'}`
    const instances = `${byNode.size} ${byNode.size === 1 ? 'instance' : 'instances'}`
    const options = {
      header: 'Change Instance Values?',
      message:
        `Applying ${refs.join(', ')} changes ${values} on ${instances}, those named after a set or seeded with it. ` +
        'Keeping the instance values leaves the sets as library defaults for new instances.',
      issues: [...byNode].map(([nodeId, { name, changes }]) => ({ key: nodeId, label: name, message: changes.join(', ') })),
      acceptLabel: 'Change values',
    }
    if (!canCancel) return (await confirm({ ...options, rejectLabel: 'Keep instance values' })) ? 'apply' : 'keep'
    const choice = await choose({ ...options, extraLabel: 'Keep instance values', rejectLabel: 'Cancel' })
    return { accept: 'apply', extra: 'keep', reject: 'cancel' }[choice] ?? 'cancel'
  }

  /**
   * The sets that reached no instance, when the workspace has any.
   *
   * @param {import('../utils/parameters/apply').SetTarget[]} targets
   * @param {Array<{ref: string}>} uses
   * @returns {string[]}
   */
  function unused(targets, uses) {
    if (!nodes.value.length) return []
    const used = new Set(uses.map((use) => use.ref))
    return [...new Set(targets.map((target) => target.set.ref))].filter((ref) => !used.has(ref))
  }

  /**
   * Stores module parameterisations, as one undo step with the instance values they change once confirmed, and
   * seeds the globals the workspace uses.
   *
   * @param {Array<{file: Object, fileName: string}>} entries - Module files.
   * @param {boolean} record
   * @returns {Promise<Array<Object>>} One result per file.
   */
  async function importModuleFiles(entries, record) {
    const results = new Array(entries.length)
    const planned = []
    for (const [index, { file, fileName }] of entries.entries()) {
      const plan = await planModuleFile(file, fileName)
      if (plan.result) results[index] = plan.result
      else planned.push({ index, file, fileName, placements: plan.placements })
    }

    const targets = targetsOf(planned.flatMap((each) => each.placements))
    const plan = planSetsForNodes(nodes.value, targets)
    let choice = 'apply'
    if (plan.changed.length) {
      const refs = [...new Set(plan.uses.filter((use) => use.count).map((use) => use.ref))]
      choice = await askToApply(refs, plan.changed, true)
    }
    if (choice === 'cancel') {
      for (const { index, fileName } of planned) {
        results[index] = { fileName, ok: false, count: 0, stored: [], warnings: ['not loaded, as changing its instances was cancelled'] }
      }
      return results
    }

    const used = variableNames()
    const apply = choice === 'apply'
    await edit(
      'import-parameters',
      apply ? plan.nodeIds : [],
      () => {
        for (const { index, file, fileName, placements } of planned) {
          const stored = defaults.commitSet(placements)
          const refs = new Set(stored.map((each) => each.ref))
          const uses = plan.uses.filter((use) => stored.some((each) => each.ref === use.ref && each.mathRef === use.mathRef))
          const fileTargets = targetsOf(placements)
          const result = { fileName, ok: true, count: 0, stored, warnings: [...file.warnings], uses: [], defaultOnly: [], kept: [] }
          for (const each of stored) result.warnings.push(...each.warnings)
          if (apply) {
            result.uses = uses
            result.count = uses.reduce((sum, use) => sum + use.count, 0)
            result.defaultOnly = unused(fileTargets, uses)
          } else {
            result.kept = [...refs].filter((ref) => uses.some((use) => use.ref === ref && use.count))
            result.defaultOnly = unused(fileTargets, uses.filter((use) => use.count))
          }
          for (const { mathRef, ref } of stored) {
            if (mathRef) assign(planGlobals(defaults.getSet(mathRef, ref).globals, libraryStore.getGlobalConstant, used).added)
          }
          results[index] = result
        }
        if (!apply) return
        writeRows(plan.variablesById, plan.tags)
        const first = results.find((result) => result?.ok && result.stored.length)
        if (first) {
          first.warnings.push(...plan.warnings)
          if (plan.skipped.length) first.warnings.push(skippedParametersMessage(plan.skipped))
        }
      },
      record
    )
    return results
  }

  /**
   * Offers sets just linked by arriving configs to the instances named after them or seeded with them, applying them
   * as one undo step once confirmed.
   *
   * @param {Array<{mathRef: string, ref: string, fileRef?: string}>} links - From the store's recent links.
   * @returns {Promise<{count: number, uses: Array, defaultOnly: string[], kept: string[]}>}
   */
  async function applyLinkedSets(links) {
    const targets = links
      .map(({ mathRef, ref, fileRef = ref }) => ({ mathRef, set: defaults.getSet(mathRef, ref), byName: ref === fileRef }))
      .filter((target) => target.set)
    const plan = planSetsForNodes(nodes.value, targets)
    const changedUses = plan.uses.filter((use) => use.count)
    const outcome = { count: 0, uses: [], defaultOnly: unused(targets, changedUses), kept: [] }
    if (!plan.nodeIds.length) return outcome

    const refs = [...new Set(changedUses.map((use) => use.ref))]
    if (plan.changed.length && (await askToApply(refs, plan.changed, false)) === 'keep') {
      return { ...outcome, kept: refs }
    }
    await edit(
      'apply-parameters',
      plan.nodeIds,
      () => writeRows(plan.variablesById, plan.tags),
      true
    )
    return { ...outcome, count: plan.changed.length, uses: plan.uses }
  }

  /** Applies a model file's values by instance; its globals overwrite those set only once confirmed. */
  async function importModelFile(file, fileName, record) {
    const { added, changed } = planGlobals(file.globals, libraryStore.getGlobalConstant, variableNames())
    let overwrite = false
    if (changed.length) {
      overwrite = await confirm({
        header: 'Overwrite Global Constants?',
        message: `${fileName} sets global constants that already have values:`,
        issues: changed.map(({ name, from, value }) => ({ key: name, message: `${name}: ${from} → ${value}` })),
        acceptLabel: 'Overwrite',
        rejectLabel: 'Keep current',
      })
    }

    const changes = applyInstancesToNodes(nodes.value, file.instances)
    await edit(
      'import-parameters',
      changes.nodeIds,
      () => {
        writeRows(changes.variablesById)
        assign(added)
        if (overwrite) assign(changed, true)
      },
      record
    )
    const warnings = [...file.warnings, ...changes.warnings]
    if (changes.skipped.length) warnings.push(skippedParametersMessage(changes.skipped))
    const count = changes.updated + added.length + (overwrite ? changed.length : 0)
    return { fileName, ok: count > 0, count, stored: [], warnings }
  }

  /**
   * Imports parsed parameter files that are not `<variable>_<instance>` CSVs: the module files first, as one
   * confirmation and undo step, then each model file.
   *
   * @param {Array<{file: import('../utils/parameters/parse').ParameterFile, fileName: string}>} entries
   * @param {{record?: boolean}} [options] - `record: false` leaves the undo history alone, as a model load does.
   * @returns {Promise<Array<{fileName: string, ok: boolean, count: number, stored: Array, warnings: string[]}>>} One
   *   result per file, in order.
   */
  async function importParameterFiles(entries, { record = true } = {}) {
    const isModule = (entry) => entry.file.kind === 'module'
    const moduleResults = await importModuleFiles(entries.filter(isModule), record)
    const byEntry = new Map(entries.filter(isModule).map((entry, index) => [entry, moduleResults[index]]))
    for (const entry of entries.filter((each) => !isModule(each))) {
      byEntry.set(entry, await importModelFile(entry.file, entry.fileName, record))
    }
    return entries.map((entry) => byEntry.get(entry))
  }

  /**
   * Imports a parsed parameter file that is not a `<variable>_<instance>` CSV.
   *
   * @param {import('../utils/parameters/parse').ParameterFile} file
   * @param {string} fileName
   * @param {{record?: boolean}} [options]
   * @returns {Promise<{fileName: string, ok: boolean, count: number, stored: Array, warnings: string[]}>}
   */
  async function importParameterFile(file, fileName, options) {
    const [result] = await importParameterFiles([{ file, fileName }], options)
    return result
  }

  /**
   * Re-applies one of its math's sets to an instance, as the instance editor's picker does: the values it changes are
   * listed to confirm first, then overwritten and the set recorded on the node as one undo step. A global constant
   * already set keeps its shared value; one not yet set takes the set's.
   *
   * @param {string} nodeId
   * @param {string} paramRef
   * @returns {Promise<boolean>} Whether the set was applied.
   */
  async function applySetToNode(nodeId, paramRef) {
    const node = nodes.value.find((each) => each.id === nodeId)
    const set = node && defaults.getSet(node.data.mathRef, paramRef)
    if (!set) return false
    const { rows, changes } = planSetApply(node.data.variables, set)
    if (changes.length && !(await confirm(setApplyConfirmation(paramRef, changes)))) return false
    const used = variableNames()
    await recordEdit({
      type: 'apply-parameter-set',
      nodeIds: [nodeId],
      keys: ['variables', 'parameterisation'],
      apply: () => {
        writeRows(new Map([[nodeId, rows]]), new Map([[nodeId, set.ref]]))
        assign(planGlobals(set.globals, libraryStore.getGlobalConstant, used).added)
      },
    })
    return true
  }

  return { importParameterFile, importParameterFiles, applyLinkedSets, applySetToNode, retryCsvAsModule }
}
