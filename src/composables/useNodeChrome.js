/**
 * What InstanceNode and SuperInstanceNode share: in-place renaming unique on the canvas, theme colour, simulated outline
 * and context menu. Their handles, shared with InterfaceNode too, are NodeHandles.
 */
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'

import { useActiveCanvas } from './useActiveCanvas'
import { useCanvasLevel } from './useCanvasLevel'
import { useHandleManagement } from './useHandleManagement'
import { useNodeDataHistory } from './useNodeDataHistory'
import { useNodeThemeStore } from '../stores/nodeThemeStore'
import { useSimulationResultsStore } from '../stores/simulationResultsStore'
import { localNameProblem } from '../utils/hierarchy'
import { sanitiseName } from '../utils/identifiers'
import { categoryStyle as themeCategoryStyle } from '../utils/nodeThemes'
import { notify } from '../utils/notify'

// Short enough to feel immediate; a slower double-click is caught by DOUBLE_CLICK_WINDOW_MS instead.
const RENAME_CLICK_DELAY_MS = 250
// Covers the default OS double-click interval (500ms on Windows and macOS).
const DOUBLE_CLICK_WINDOW_MS = 500

/**
 * Gives a node card its shared behaviour. Call it in the card's setup.
 *
 * @param {Object} props - The card's props: `id`, `data` (`name`, `domainType`).
 * @param {Function} emit - The card's emit; `open-context-menu` is emitted with `{clientX, clientY, id}`.
 * @param {Object} options
 * @param {Function} options.onDoubleClick - What a double-click on the card does, a pending rename dropped first.
 * @param {boolean} [options.isSuperInstance=false] - Whether the node is a super instance, whose name follows the rules for
 *   names inside super-modules wherever it is.
 * @param {string} [options.nameTakenMessage] - The error shown when another node on the canvas has the name.
 */
export function useNodeChrome(
  props,
  emit,
  { onDoubleClick, isSuperInstance = false, nameTakenMessage = 'An instance with this name already exists.' }
) {
  const { id: flowId, updateNodeData, viewport } = useVueFlow()
  const { scope, nodes: canvasNodes } = useActiveCanvas(flowId)
  const canvasLevel = useCanvasLevel(flowId)
  const { revertPendingGhostIfUnused } = useHandleManagement()
  const { recordEdit } = useNodeDataHistory(flowId)
  const nodeThemeStore = useNodeThemeStore()
  const simulationResultsStore = useSimulationResultsStore()

  // Outlined while the Simulation tab shows results of a selection that includes it, or any module inside it.
  const isSimulated = computed(() => {
    const scopeNodeIds = simulationResultsStore.results && simulationResultsStore.scopeNodeIds
    if (!scopeNodeIds) return false
    return canvasLevel.modelIdsOf([props.id]).some((id) => scopeNodeIds.includes(id))
  })

  // The node stores a category key; the active theme decides its colour (none when the theme lacks it).
  const categoryStyle = computed(() => themeCategoryStyle(nodeThemeStore.activeTheme, props.data.domainType))

  // ─── Name ──────────────────────────────────────────────────────────────────────

  const isEditing = ref(false)
  const editingName = ref('')
  const nameInputRef = ref(null)
  let renameClickTimeout = null
  let renameClickedAt = 0

  // Panning or zooming the canvas moves the field without a scroll or resize event, so re-anchor the popover.
  watch(viewport, () => {
    if (isEditing.value) nameInputRef.value?.updatePosition()
  })

  /**
   * Starts renaming a moment after a single click, so a double-click does the card's double-click instead.
   *
   * @param {MouseEvent} event
   */
  function onNameClick(event) {
    clearTimeout(renameClickTimeout)
    renameClickTimeout = null
    // A keyboard activation has no click count.
    if (event.detail === 0) {
      startEditing()
    } else if (event.detail === 1) {
      renameClickedAt = Date.now()
      renameClickTimeout = setTimeout(() => {
        renameClickTimeout = null
        startEditing()
      }, RENAME_CLICK_DELAY_MS)
    }
  }

  /** Does the card's double-click, dropping any rename a first click had scheduled. */
  function onNodeDoubleClick() {
    clearTimeout(renameClickTimeout)
    renameClickTimeout = null
    onDoubleClick()
  }

  /**
   * Treats a double-click that lands on a field a click just opened as a double-click on the name, so a double-click
   * slower than the rename delay still does the card's double-click.
   */
  function onNameInputDoubleClick() {
    if (Date.now() - renameClickedAt >= DOUBLE_CLICK_WINDOW_MS) return
    renameClickedAt = 0
    cancelEdit()
    onDoubleClick()
  }

  /** Swaps the name for a field holding it, with the cursor in it. */
  async function startEditing() {
    isEditing.value = true
    editingName.value = props.data.name

    await nextTick()
    nameInputRef.value?.focus()
  }

  /** Keeps the card from being dragged while its name is edited. */
  function stopDragWhileEditing(event) {
    if (isEditing.value) event.stopPropagation()
  }

  /** Renames the node to the field's name, as one undo step; an empty name leaves it as it was. Enter or blur. */
  function saveEdit() {
    // Unmounting the field can fire a late blur, so ignore commits once editing has ended.
    if (!isEditing.value) return
    revertPendingGhostIfUnused()
    if (!editingName.value || editingName.value.trim() === '') {
      isEditing.value = false
      return
    }

    const sanitisedName = sanitiseName(editingName.value)

    if (!sanitisedName) {
      isEditing.value = false
      return
    }

    const nameProblem = localNameProblem(sanitisedName, { scope: scope.value, superInstance: isSuperInstance })
    if (nameProblem) {
      notify.error({ items: [nameProblem] })
      return
    }

    const nameExists = canvasNodes.value.some((node) => node.id !== props.id && node.data && node.data.name === sanitisedName)

    if (nameExists) {
      notify.error({ items: [nameTakenMessage] })
      return
    }

    recordEdit({
      type: 'rename-node',
      nodeIds: [props.id],
      keys: ['name'],
      apply: () => updateNodeData(props.id, { name: sanitisedName }),
    })
    isEditing.value = false
  }

  /** Leaves the name as it was. Escape. */
  function cancelEdit() {
    isEditing.value = false
  }

  onBeforeUnmount(() => clearTimeout(renameClickTimeout))

  /** @param {MouseEvent} event - A right-click on the card. */
  function openContextMenu(event) {
    emit('open-context-menu', {
      clientX: event.clientX,
      clientY: event.clientY,
      id: props.id,
    })
  }

  return {
    flowId,
    isSimulated,
    categoryStyle,
    isEditing,
    editingName,
    nameInputRef,
    onNameClick,
    onNodeDoubleClick,
    onNameInputDoubleClick,
    startEditing,
    stopDragWhileEditing,
    saveEdit,
    cancelEdit,
    openContextMenu,
  }
}
