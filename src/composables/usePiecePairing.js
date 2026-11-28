import { computed, nextTick, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { patchBioView } from '../services/bioView/drop'
import { validatePieces } from '../services/bioView/pieces/model'
import { compartmentsFor, piecesOwed } from '../services/bioView/pieces/pairing'
import { useBioPiecesStore } from '../stores/bioPiecesStore'
import { useFlowHistoryStore } from '../stores/historyStore'
import { useLibraryStore } from '../stores/libraryStore'
import { FLOW_IDS } from '../utils/constants'

/**
 * Keeps every compartment's module a compartment: a module whose annotations say it is a compartment and that is on
 * no piece, however it got there (added in the diagram, pasted, imported, or its annotations edited), is given a
 * compartment of its own, standing freely, in the same step as what made it so (see pieces/pairing.js). One the
 * workspace's history put back as it was, by an undo or redo, is left as it is.
 *
 * Mount once, with the workspace.
 *
 * @returns {{ giveCompartments: Function, whilePaused: Function, kindOf: Function }}
 */
export function usePiecePairing() {
  const main = useVueFlow(FLOW_IDS.MAIN)
  const piecesStore = useBioPiecesStore()
  const libraryStore = useLibraryStore()
  const history = useFlowHistoryStore()

  /** How many callers have paused it, as a workspace load does while it fills what it loaded. */
  let paused = 0
  /** Whether an undo or redo has just run, whose result is the history's, not a new edit's. */
  let isAfterReplay = false

  /**
   * What a node's annotations say its component is, once its sidecar is parsed.
   *
   * @param {{data?: Object}} node
   * @returns {string|null}
   */
  const kindOf = (node) => {
    const mathRef = node.data?.mathRef
    return (mathRef && libraryStore.getParsedModuleAnnotations(mathRef)?.component?.kind) || null
  }

  const owed = computed(() => piecesOwed(piecesStore.pieces, main.nodes.value, kindOf))

  /**
   * Gives each of some nodes a compartment of its own, bound to it: in the step open or pending, so it is part of
   * what made the node, else outside the history.
   *
   * @param {string[]} ids - Node ids.
   * @param {{ record?: boolean }} [options] - record: false makes no step, as for a workspace just loaded.
   * @returns {boolean} Whether any was given one.
   */
  function giveCompartments(ids, { record = true } = {}) {
    const nodes = ids.map((id) => main.findNode(id)).filter(Boolean)
    if (!nodes.length) return false
    const { pieces: raw, sites } = compartmentsFor(piecesStore.pieces, nodes)
    const { pieces: next } = validatePieces(raw)
    if (!next) return false
    const before = { pieces: piecesStore.pieces, views: new Map(nodes.map((node) => [node.id, node.data?.bioView])) }
    const after = {
      pieces: next,
      views: new Map(
        nodes.map((node) => [
          node.id,
          patchBioView(node.data?.bioView, { site: sites.get(node.id), position: undefined }),
        ]),
      ),
    }
    const restore = ({ pieces, views }) => {
      piecesStore.restoreSnapshot(pieces)
      for (const [id, bioView] of views) {
        const node = main.findNode(id)
        if (!node) continue
        const { bioView: _, ...rest } = node.data
        main.updateNodeData(id, bioView === undefined ? rest : { ...rest, bioView }, { replace: true })
      }
    }
    restore(after)
    // Added as a pending command, so it joins the step of what made the node: the batch open, or the add waiting
    // on the history's timer.
    if (record) {
      history.addCommand({
        type: 'bio-pieces-compartment',
        undo: () => restore(before),
        redo: () => restore(after),
      })
    }
    return true
  }

  /**
   * Runs something with no compartments given meanwhile, as a workspace load does while it fills what it loaded.
   *
   * @param {() => Promise<*>|*} run
   * @returns {Promise<*>}
   */
  async function whilePaused(run) {
    paused++
    try {
      return await run()
    } finally {
      // What the run changed is seen once it is done, and is no new edit.
      await nextTick()
      paused--
    }
  }

  // An undo or redo puts things as they were; what it leaves owed is the history's, not something to fix. The flag
  // outlasts the replay until what it changed has been seen.
  watch(
    () => history.isReplaying,
    (isReplaying) => {
      if (isReplaying) isAfterReplay = true
      else setTimeout(() => (isAfterReplay = false))
    },
    { flush: 'sync' },
  )

  watch(owed, (now, before) => {
    if (paused || isAfterReplay || history.isReplaying) return
    const fresh = now.filter((id) => !before?.includes(id))
    if (!fresh.length) return
    // A command still being run takes no other: wait for it.
    if (history.isUndoRedoing) {
      setTimeout(() => {
        if (!paused && !history.isReplaying) giveCompartments(fresh.filter((id) => owed.value.includes(id)))
      })
      return
    }
    giveCompartments(fresh)
  })

  return { giveCompartments, whilePaused, kindOf }
}
