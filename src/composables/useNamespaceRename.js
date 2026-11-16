import { useVueFlow } from '@vue-flow/core'

import { useConfirmDialog } from './useConfirmDialog'
import { useDefaultParametersStore } from '../stores/defaultParametersStore'
import { useFlowHistoryStore } from '../stores/historyStore'
import { useLibraryStore } from '../stores/libraryStore'
import {
  renameNamespaceInLibrary,
  renameNamespaceInNodeData,
  renameNamespaceInParameters,
} from '../services/library/renameNamespace'
import { FLOW_IDS } from '../utils/constants'
import { sanitiseNamespace } from '../utils/namespaces'
import { notify } from '../utils/notify'
import { detachReactivity } from '../utils/reactivity'

/**
 * Renames a library namespace everywhere it is used: its files and modules, their parameter sets, and the workspace's
 * instances of them, as one undo step.
 *
 * @returns {{ renameNamespace: (from: string) => Promise<boolean> }}
 */
export function useNamespaceRename() {
  const library = useLibraryStore()
  const parameters = useDefaultParametersStore()
  const history = useFlowHistoryStore()
  const { nodes } = useVueFlow(FLOW_IDS.MAIN)
  const { prompt } = useConfirmDialog()

  /**
   * Asks for a new name for a namespace and renames it.
   *
   * @param {string} from
   * @returns {Promise<boolean>} Whether it was renamed.
   */
  async function renameNamespace(from) {
    const taken = library.loadedNamespaces()
    const answer = await prompt({
      header: 'Rename Namespace',
      message: `Rename "${from}" everywhere it is used: its files, modules, parameter sets and instances.`,
      value: from,
      hint: (value) => {
        const name = sanitiseNamespace(value)
        if (!name) return 'A namespace needs a name.'
        return name !== from && taken.has(name) ? `"${name}" is in use; choose another name.` : ''
      },
      acceptLabel: 'Rename',
    })
    if (answer === null) return false
    const to = sanitiseNamespace(answer)
    if (!to || to === from) return false
    if (taken.has(to)) {
      notify.warning({ title: 'Namespace in Use', message: `"${to}" is in use, so "${from}" was not renamed.` })
      return false
    }

    const before = {
      library: detachReactivity(library.getState()),
      parameters: detachReactivity(parameters.getState()),
      nodes: new Map(),
    }
    const after = {
      library: renameNamespaceInLibrary(before.library, from, to),
      parameters: renameNamespaceInParameters(before.parameters, from, to),
      nodes: new Map(),
    }
    for (const node of nodes.value) {
      const renamed = renameNamespaceInNodeData(node.data, from, to)
      if (!renamed) continue
      before.nodes.set(node.id, { ...node.data })
      after.nodes.set(node.id, renamed)
    }

    const apply = (side) => {
      library.loadState(side.library)
      parameters.loadState(side.parameters)
      for (const node of nodes.value) {
        if (side.nodes.has(node.id)) node.data = { ...side.nodes.get(node.id) }
      }
    }
    await history.executeAndAddCommand({
      type: 'rename-namespace',
      redo: async () => apply(after),
      undo: async () => apply(before),
    })
    notify.success({ title: 'Namespace Renamed', message: `"${from}" is now "${to}".` })
    return true
  }

  return { renameNamespace }
}
