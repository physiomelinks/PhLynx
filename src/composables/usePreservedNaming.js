/**
 * Keeps 'preserve' naming single-instance: a super-module imported from CellML encapsulation keeps its components' own
 * flat names only while it occurs once. Before a change gives it a second occurrence (another super instance of it, or
 * of a super-module holding it, placed or pasted), this asks to switch it to 'prefixed' naming, listing the flat names
 * that change, as SED-ML and PMR references name them; declined, the change isn't made.
 */
import { useVueFlow } from '@vue-flow/core'

import { useFlowHistoryFor } from './useFlowHistoryFor'
import { flatNameChanges, preserveConflicts, withPrefixedNaming } from '../services/hierarchy/operations'
import { FLOW_IDS, SUPER_INSTANCE_NODE_TYPE } from '../utils/constants'
import { detachReactivity } from '../utils/reactivity'

// A flow without nodes, such as a stub of one, reads as empty.
const NONE = Object.freeze({ value: Object.freeze([]) })
// The flat names a question lists before saying how many more.
const LISTED = 8

/**
 * Words the question for flat names that change.
 *
 * @param {string[]} names - The super-modules switching.
 * @param {Array<{from: string, to: string}>} changes
 * @returns {string}
 */
export function prefixedNamingMessage(names, changes) {
  const listed = changes.slice(0, LISTED).map(({ from, to }) => `${from} → ${to}`)
  if (changes.length > LISTED) listed.push(`and ${changes.length - LISTED} more`)
  const which = names.map((name) => `"${name}"`).join(', ')
  return (
    `${which} ${names.length === 1 ? 'keeps' : 'keep'} the original CellML component names only while used once, so ` +
    `${names.length === 1 ? 'its' : 'their'} modules will be named after their super instances. These flat names, ` +
    `which SED-ML and PMR references use, will change:\n${listed.join('\n')}`
  )
}

/**
 * Gives a flow's guard of 'preserve' naming.
 *
 * @param {Object} [options]
 * @param {string} [options.flowId=FLOW_IDS.MAIN]
 * @param {Function} [options.confirm] - The confirm dialog (useConfirmDialog's); without one, a change that needs the
 *   switch is refused.
 * @param {Object} [options.history] - The undo stack; the nearest provided one by default.
 * @returns {{allow: Function, asks: Function, withSuperInstance: Function}}
 */
export function usePreservedNaming({ flowId = FLOW_IDS.MAIN, confirm = null, history = useFlowHistoryFor() } = {}) {
  const flow = useVueFlow(flowId)
  const allNodes = () => (flow.nodes ?? flow.getNodes ?? NONE).value

  /**
   * Asks before a change that gives a super-module with preserved names a second occurrence, and switches those to
   * 'prefixed' naming, as one undo step, when the user agrees.
   *
   * @param {Array} after - Every node as the change leaves it; a stand-in for each super instance added will do.
   * @returns {Promise<boolean>} Whether the change may be made.
   */
  async function allow(after) {
    const smIds = preserveConflicts(after)
    if (!smIds.length) return true
    if (!confirm) return false
    const before = detachReactivity(allNodes())
    const changes = flatNameChanges(before, withPrefixedNaming(before, smIds))
    const names = smIds.map((smId) => before.find((node) => node.id === smId)?.data?.supermodule?.name ?? smId)
    const answer = await confirm({
      header: 'Flat Names Will Change',
      message: prefixedNamingMessage(names, changes),
      severity: 'warning',
      acceptLabel: 'Change Names',
      rejectLabel: 'Cancel',
    })
    if (answer !== true) return false
    const write = (naming) => {
      for (const smId of smIds) {
        const node = flow.findNode(smId)
        if (node) node.data = { ...node.data, supermodule: { ...node.data.supermodule, naming } }
      }
    }
    await history.executeAndAddCommand({ type: 'prefix-supermodule-names', redo: () => write('prefixed'), undo: () => write('preserve') })
    return true
  }

  /**
   * Gives the store as another super instance of a super-module in a scope leaves it, for asks and allow.
   *
   * @param {string} smId
   * @param {string|null} scope
   * @returns {Array} Every node, with a stand-in for the super instance.
   */
  const withSuperInstance = (smId, scope) => [...allNodes(), { id: '\0added', type: SUPER_INSTANCE_NODE_TYPE, data: { scope, smId } }]

  /** @returns {boolean} Whether a change leaving the store as `after` asks first (see allow). */
  const asks = (after) => preserveConflicts(after).length > 0

  return { allow, asks, withSuperInstance }
}
