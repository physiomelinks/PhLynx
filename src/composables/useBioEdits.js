import { useVueFlow } from '@vue-flow/core'
import { useNodeDataHistory } from './useNodeDataHistory'
import { parseSiteRef } from '../services/bioView/templates'
import { useBioTemplateStore } from '../stores/bioTemplateStore'
import { useFlowHistoryStore } from '../stores/historyStore'
import { FLOW_IDS } from '../utils/constants'

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
  /** Whole flow units, so a saved workspace holds no rounding noise from the screen. */
  const whole = ({ x, y }) => ({ x: Math.round(x), y: Math.round(y) })

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
    const plan = new Map()
    for (const node of boundTo(id)) {
      const { site, order, ...rest } = node.data.bioView
      const role = rest.role ?? roles?.value?.get(node.id)?.role
      plan.set(node.id, role === 'membraneProtein' ? { ...rest, facet: null } : rest)
    }
    return applyPlan(plan, 'bio-template-remove', templates.edit(() => templates.removeInstance(id)))
  }

  return { applyPlan, templateMoves, placeTemplate, moveTemplate, renameTemplate, relayoutTemplate, removeTemplate }
}
