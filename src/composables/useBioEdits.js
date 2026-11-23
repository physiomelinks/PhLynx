import { useVueFlow } from '@vue-flow/core'
import { useNodeDataHistory } from './useNodeDataHistory'
import { whole } from '../services/bioView/drop'
import { PIECES_INSTANCE } from '../services/bioView/pieces/layout'
import { stampTemplate } from '../services/bioView/pieces/stamp'
import { topologyOf } from '../services/bioView/pieces/topology'
import { parseSiteRef } from '../services/bioView/siteRefs'
import { useBioPiecesStore } from '../stores/bioPiecesStore'
import { useFlowHistoryStore } from '../stores/historyStore'
import { FLOW_IDS } from '../utils/constants'
import { sanitiseName } from '../utils/identifiers'

/**
 * Edits made in the physiological view: new bioViews for diagram nodes, and changes to the pieces it is built from.
 * Each call is one undo step in the diagram's history, whatever it changes.
 *
 * @param {Ref<Map<string, Object>>} [roles] - Node id -> resolveBioRole's result, for a role a bioView leaves out.
 * @returns {Object} applyPlan and the pieces' actions.
 */
export function useBioEdits(roles = null) {
  const main = useVueFlow(FLOW_IDS.MAIN)
  const { recordEdit } = useNodeDataHistory(FLOW_IDS.MAIN)
  const pieces = useBioPiecesStore()
  const history = useFlowHistoryStore()
  /** Edits to the pieces are the user's own, never part of an undo or redo. */
  const busy = () => history.isUndoRedoing

  /**
   * Writes new bioViews, with a change to the pieces store if given, as one undo step.
   *
   * @param {Map<string, Object|undefined>} plan - Node id -> its new bioView; undefined removes it.
   * @param {string} [type='bio-layout'] - The command type.
   * @param {Object} [storeEdit] - From the pieces store's edit().
   * @returns {Promise<boolean>} Whether a step was recorded.
   */
  function applyPlan(plan, type = 'bio-layout', storeEdit = undefined) {
    const ids = [...plan.keys()].filter((id) => main.findNode(id))
    if (!ids.length && !storeEdit) return Promise.resolve(false)
    return recordEdit({
      type,
      nodeIds: ids,
      keys: ['bioView'],
      library: storeEdit,
      apply: () => {
        ids.forEach((id) => {
          const node = main.findNode(id)
          const { bioView, ...rest } = node.data
          const next = plan.get(id)
          main.updateNodeData(id, next === undefined ? rest : { ...rest, bioView: next }, { replace: true })
        })
        storeEdit?.apply()
      },
    })
  }

  /**
   * Adds copies of a template's pieces, its corner at a point, as one step.
   *
   * @param {{ pieces: ReadonlyArray<Object> }} template - Validated.
   * @param {{x: number, y: number}} at - In flow coordinates.
   * @param {{ into?: {id: string, corner: {x: number, y: number}}|null }} [options] - The compartment it is dropped
   *   in (see stampTemplate); none, the canvas.
   * @returns {Promise<string[]>} Why it couldn't be added, if it couldn't.
   */
  async function placePiecesTemplate(template, at, { into = null } = {}) {
    if (busy()) return []
    // Tried first, so a template that doesn't fit leaves no step behind.
    const { errors } = stampTemplate(pieces.pieces, template, whole(at), { shapes: pieces.shapes, into })
    if (errors.length) return errors
    await applyPlan(
      new Map(),
      'bio-pieces-add',
      pieces.edit(() => pieces.addTemplate(template, whole(at), { into })),
    )
    return []
  }

  /**
   * Unbinds nodes from their sites: proteins go to the tray, the rest where their role puts them.
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
   * The nodes bound to sites of the pieces that other pieces would no longer offer.
   *
   * @param {ReadonlyArray<Object>} next - Validated pieces.
   * @returns {Array<Object>}
   */
  function strandedBy(next) {
    const offered = new Set(topologyOf(next).sites.map((site) => site.path))
    return main.nodes.value.filter((node) => {
      const parsed = parseSiteRef(node.data?.bioView?.site)
      return parsed?.instance === PIECES_INSTANCE && !offered.has(parsed.path)
    })
  }

  /**
   * Replaces the pieces, as one step: an edit worked out from them (see pieces/edits.js and moves.js), already
   * validated. Nodes bound to sites they no longer offer are unbound in that step.
   *
   * @param {ReadonlyArray<Object>} next - The pieces as the edit leaves them.
   * @param {string} [type='bio-pieces-edit'] - The command type.
   * @returns {Promise<boolean>}
   */
  function editPieces(next, type = 'bio-pieces-edit') {
    if (busy()) return Promise.resolve(false)
    return applyPlan(
      unbindPlan(strandedBy(next)),
      type,
      pieces.edit(() => pieces.setPieces(next)),
    )
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

  return {
    applyPlan,
    placePiecesTemplate,
    editPieces,
    strandedBy,
    nameError,
    renameInstance,
  }
}
