/**
 * The items of a canvas node's context menu.
 */
import { SUPER_INSTANCE_NODE_TYPE, SUPERMODULE_INTERFACE_NODE_TYPE } from './constants'

/**
 * Builds a canvas node's context menu: a super instance's Open, Edit Super-module, Make Unique, Un-nest and Delete, or a
 * module's Replace Module, with Nest Selection and Simulate for either. A super-module edited on its own stands for
 * every copy of it, so then there is no Simulate. A super-module's interface node, which neither nests nor simulates,
 * has Go Up a Level and Fit View.
 *
 * @param {Object} options
 * @param {Object} options.node - The node right-clicked.
 * @param {boolean} options.isEditingSupermodule
 * @param {string} options.simulateLabel - What Simulate runs, such as `Simulate Selection (2)`.
 * @param {string} [options.nestLabel] - What Nest nests, such as `Nest Selection (2)`; no Nest item without it.
 * @param {boolean} [options.canMakeUnique=false] - Whether the super instance's super-module has more than one copy.
 * @param {Object} options.actions - `open`, `editSupermodule`, `makeUnique`, `unnest`, `nest`, `remove`, `replace`,
 *   `simulate`, `goUp` and `fitView`, each given the node.
 * @returns {{label: string, action: Function, disabled?: boolean, title?: string}[]}
 */
export function nodeContextMenuItems({ node, isEditingSupermodule, simulateLabel, nestLabel, canMakeUnique = false, actions }) {
  if (node.type === SUPERMODULE_INTERFACE_NODE_TYPE) {
    return [
      { label: 'Go Up a Level', action: () => actions.goUp(node) },
      { label: 'Fit View', action: () => actions.fitView(node) },
    ]
  }
  const simulate = isEditingSupermodule ? [] : [{ label: simulateLabel, action: () => actions.simulate(node) }]
  const nest = nestLabel ? [{ label: nestLabel, action: () => actions.nest(node) }] : []
  if (node.type === SUPER_INSTANCE_NODE_TYPE) {
    return [
      { label: 'Open', action: () => actions.open(node) },
      { label: 'Edit Super-module', action: () => actions.editSupermodule(node) },
      {
        label: 'Make Unique',
        action: () => actions.makeUnique(node),
        disabled: !canMakeUnique,
        title: canMakeUnique ? 'Give this super instance its own copy of its super-module.' : 'Its super-module has no other copy.',
      },
      { label: 'Un-nest', action: () => actions.unnest(node) },
      ...nest,
      ...simulate,
      { label: 'Delete', action: () => actions.remove(node) },
    ]
  }
  return [{ label: 'Replace Module', action: () => actions.replace(node) }, ...nest, ...simulate]
}
