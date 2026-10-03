import { useVueFlow } from '@vue-flow/core'
import { nextTick, ref, toValue } from 'vue'

import { useFlowHistoryStore } from '../stores/historyStore'
import { runFcoseLayout } from '../services/layouts/cytoscape'
import { runRescaleLayout } from '../services/layouts/rescale'
import { notify } from '../utils/notify'
import { reorganiseHandles } from '../utils/handles'

/**
 * Lays out freshly added nodes, then connects edges and fits the view.
 * @param {object} [options]
 * @param {object|import('vue').Ref<object>} [options.fitViewParams] fitView options (e.g. padding clear of the library panel).
 */
export function useWorkflowLayout({ fitViewParams } = {}) {
  const { onNodesInitialized, addEdges, updateNodeInternals, fitView } = useVueFlow()
  const historyStore = useFlowHistoryStore()
  
  const layoutPending = ref(false)
  let pendingEdges = []
  let pendingProgressCallback = null
  let layoutCompleteResolve = null
  let layoutCompleteReject = null

  const prepareLayout = (edges, progressCallback = null) => {
    pendingEdges = edges
    pendingProgressCallback = progressCallback
    layoutPending.value = true
    
    return new Promise((resolve, reject) => {
      layoutCompleteResolve = resolve
      layoutCompleteReject = reject
    })
  }

  onNodesInitialized(async (initializedNodes) => {
    if (!layoutPending.value || initializedNodes.length === 0) return

    const callback = pendingProgressCallback
    const resolveFunc = layoutCompleteResolve
    const rejectFunc = layoutCompleteReject

    try {
      if (callback) callback(initializedNodes.length, initializedNodes.length, 'Organizing layout...')

      // Run layout algorithm based on whether positions were pre-defined
      if (initializedNodes[0].style?.opacity !== 0) {
        runRescaleLayout(initializedNodes)
      } else {
        await runFcoseLayout(initializedNodes, pendingEdges)
        reorganiseHandles(initializedNodes, pendingEdges)
      }

      await nextTick()
      updateNodeInternals(initializedNodes.map((n) => n.id))

      if (callback) callback(initializedNodes.length, initializedNodes.length, 'Connecting nodes...')
      
      addEdges(pendingEdges)
      historyStore.clear()
      
      await nextTick()

      if (callback) callback(initializedNodes.length, initializedNodes.length, 'Finalizing view...')
      
      fitView({ padding: 0.2, ...toValue(fitViewParams), duration: 800 })
      await new Promise((resolve) => setTimeout(resolve, 800))

      if (callback) callback(initializedNodes.length, initializedNodes.length, 'Complete.')
      if (resolveFunc) resolveFunc()

    } catch (error) {
      historyStore.clear()
      notify.error({ message: 'Error organizing graph layout' })
      if (rejectFunc) rejectFunc(error)
    } finally {
      layoutPending.value = false
      pendingEdges = []
      pendingProgressCallback = null
      layoutCompleteResolve = null
      layoutCompleteReject = null
    }
  })

  return { prepareLayout }
}
