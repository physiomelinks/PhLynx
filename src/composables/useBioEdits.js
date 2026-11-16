import { useVueFlow } from '@vue-flow/core'
import { useNodeDataHistory } from './useNodeDataHistory'
import { whole } from '../services/bioView/drop'
import { instanceTemplate, parseSiteRef, sitesOf } from '../services/bioView/templates'
import { useBioTemplateStore } from '../stores/bioTemplateStore'
import { useFlowHistoryStore } from '../stores/historyStore'
import { FLOW_IDS } from '../utils/constants'
import { sanitiseName } from '../utils/identifiers'

/**
 * Edits made in the physiological view: new bioViews for diagram nodes, and changes to the template instances
 * placed in it. Each call is one undo step in the diagram's history, whatever it changes.
 *
 * @param {Ref<Map<string, Object>>} [roles] - Node id -> resolveBioRole's result, for a role a bioView leaves out.
 * @returns {Object} applyPlan and the template actions.
 */
export function useBioEdits(roles = null) {
  const main = useVueFlow(FLOW_IDS.MAIN)
  const { recordEdit } = useNodeDataHistory(FLOW_IDS.MAIN)
  const templates = useBioTemplateStore()
  const history = useFlowHistoryStore()
  /** Template actions are the user's own, never part of an undo or redo. */
  const busy = () => history.isUndoRedoing

  /**
   * Writes new bioViews, with a change to the template store if given, as one undo step.
   *
   * @param {Map<string, Object|undefined>} plan - Node id -> its new bioView; undefined removes it.
   * @param {string} [type='bio-layout'] - The command type.
   * @param {Object} [templateEdit] - From the template store's edit().
   * @returns {Promise<boolean>} Whether a step was recorded.
   */
  function applyPlan(plan, type = 'bio-layout', templateEdit = undefined) {
    const ids = [...plan.keys()].filter((id) => main.findNode(id))
    if (!ids.length && !templateEdit) return Promise.resolve(false)
    return recordEdit({
      type,
      nodeIds: ids,
      keys: ['bioView'],
      library: templateEdit,
      apply: () => {
        ids.forEach((id) => {
          const node = main.findNode(id)
          const { bioView, ...rest } = node.data
          const next = plan.get(id)
          main.updateNodeData(id, next === undefined ? rest : { ...rest, bioView: next }, { replace: true })
        })
        templateEdit?.apply()
      },
    })
  }

  /**
   * The nodes bound to a site of an instance.
   *
   * @param {string} instanceId
   * @returns {Array<Object>}
   */
  function boundTo(instanceId) {
    return main.nodes.value.filter((node) => parseSiteRef(node.data?.bioView?.site)?.instance === instanceId)
  }

  /**
   * Places a template.
   *
   * @param {string} templateId
   * @param {{x: number, y: number}} at - Its top-left, in flow coordinates.
   * @returns {Promise<boolean>}
   */
  function placeTemplate(templateId, at) {
    if (busy() || !templates.getDefinition(templateId)) return Promise.resolve(false)
    return applyPlan(new Map(), 'bio-template-add', templates.edit(() => templates.addInstance(templateId, whole(at))))
  }

  /**
   * Gives the store change that moves several instances, for applyPlan.
   *
   * @param {Map<string, {x: number, y: number}>} moves - Instance id -> how far it moves.
   * @returns {Object|undefined} Undefined when nothing moves.
   */
  function templateMoves(moves) {
    const real = [...moves]
      .map(([id, delta]) => [id, whole(delta)])
      .filter(([id, delta]) => templates.getInstance(id) && (delta.x || delta.y))
    if (!real.length) return undefined
    return templates.edit(() => real.forEach(([id, delta]) => templates.moveInstance(id, { delta })))
  }

  /**
   * Moves an instance, and everything bound to it.
   *
   * @param {string} id
   * @param {{x: number, y: number}} delta
   * @returns {Promise<boolean>}
   */
  function moveTemplate(id, delta) {
    const edit = !busy() && templateMoves(new Map([[id, delta]]))
    return edit ? applyPlan(new Map(), 'bio-template-move', edit) : Promise.resolve(false)
  }

  /**
   * Names an instance; a blank name goes back to its template's.
   *
   * @param {string} id
   * @param {string} label
   * @returns {Promise<boolean>}
   */
  function renameTemplate(id, label) {
    const instance = templates.getInstance(id)
    if (busy() || !instance || (instance.label ?? '') === (label ?? '').trim()) return Promise.resolve(false)
    return applyPlan(new Map(), 'bio-template-rename', templates.edit(() => templates.renameInstance(id, label)))
  }

  /**
   * Why a diagram instance can't take a name, as the diagram checks it once sanitised: another has it.
   *
   * @param {string} id
   * @param {string} name
   * @returns {string|null}
   */
  function nameError(id, name) {
    const sanitised = sanitiseName(name ?? '')
    const isTaken = main.nodes.value.some((node) => node.id !== id && node.data?.name === sanitised)
    return sanitised && isTaken ? 'An instance with this name already exists.' : null
  }

  /**
   * Renames a diagram instance as the diagram does, as one step: the name sanitised, and a blank one ignored.
   *
   * @param {string} id
   * @param {string} name
   * @returns {Promise<string|null>} Why it wasn't renamed (see nameError), or null.
   */
  async function renameInstance(id, name) {
    const node = main.findNode(id)
    const sanitised = sanitiseName(name ?? '')
    if (busy() || !node || !sanitised || sanitised === node.data?.name) return null
    const error = nameError(id, sanitised)
    if (error) return error
    await recordEdit({
      type: 'rename-node',
      nodeIds: [id],
      keys: ['name'],
      apply: () => main.updateNodeData(id, { name: sanitised }),
    })
    return null
  }

  /**
   * Unbinds nodes from their template sites: proteins go to the tray, the rest where their role puts them.
   *
   * @param {Array<Object>} nodes
   * @returns {Map<string, Object>} A plan for applyPlan.
   */
  function unbindPlan(nodes) {
    const plan = new Map()
    for (const node of nodes) {
      const { site, order, ...rest } = node.data.bioView
      const role = rest.role ?? roles?.value?.get(node.id)?.role
      plan.set(node.id, role === 'membraneProtein' ? { ...rest, facet: null } : rest)
    }
    return plan
  }

  /**
   * The nodes bound to sites of an instance that its template with other changes would no longer offer.
   *
   * @param {string} id
   * @param {Object|null} edits - The changes it would have (see normaliseEdits).
   * @returns {Array<Object>}
   */
  function strandedBy(id, edits) {
    const instance = templates.getInstance(id)
    const template = instance && instanceTemplate({ ...instance, edits }, templates.definitions)
    if (!template) return []
    const offered = new Set(sitesOf(template).map((site) => site.path))
    return boundTo(id).filter((node) => !offered.has(parseSiteRef(node.data.bioView.site).path))
  }

  /**
   * Sets an instance's own changes to its template, as one step. Nodes bound to sites it no longer offers are
   * unbound in that step, as when the template is removed.
   *
   * @param {string} id
   * @param {Object|null} edits - See normaliseEdits; checked by the caller (see addToEdits and removeFromEdits).
   * @param {string} [type='bio-template-add-piece'] - The command type.
   * @returns {Promise<boolean>}
   */
  function editTemplate(id, edits, type = 'bio-template-add-piece') {
    if (busy() || !templates.getInstance(id)) return Promise.resolve(false)
    const plan = unbindPlan(strandedBy(id, edits))
    return applyPlan(plan, type, templates.edit(() => templates.setInstanceEdits(id, edits)))
  }

  /**
   * Puts what is bound to an instance back in the order the template lays it out in.
   *
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  function relayoutTemplate(id) {
    if (busy()) return Promise.resolve(false)
    const plan = new Map()
    for (const node of boundTo(id)) {
      const { order, position, ...rest } = node.data.bioView
      if (order !== undefined || position !== undefined) plan.set(node.id, rest)
    }
    return applyPlan(plan, 'bio-template-relayout')
  }

  /**
   * Removes an instance. What was bound to it stays, with its role: proteins go to the tray, the rest where
   * their role puts them.
   *
   * @param {string} id
   * @returns {Promise<boolean>}
   */
  function removeTemplate(id) {
    if (busy() || !templates.getInstance(id)) return Promise.resolve(false)
    const plan = unbindPlan(boundTo(id))
    return applyPlan(plan, 'bio-template-remove', templates.edit(() => templates.removeInstance(id)))
  }

  return {
    applyPlan,
    templateMoves,
    placeTemplate,
    moveTemplate,
    renameTemplate,
    nameError,
    renameInstance,
    editTemplate,
    strandedBy,
    relayoutTemplate,
    removeTemplate,
  }
}
