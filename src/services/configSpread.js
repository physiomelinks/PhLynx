/**
 * What updating a module does to its other instances: the edited instance's ports and variable kinds spread to them.
 * Kept apart from moduleConfig, which imports the node builders, so the save composable can use it.
 */
import { detachReactivity } from '../utils/reactivity'

/**
 * Gets the ports and rows another instance takes when updating a module spreads an instance's config to it: the
 * config's ports, without the connection dialog's per-node ids, and its own rows with the config's units, access and
 * types, plus the config's rows it lacks, blank. Its values stay its own.
 *
 * @param {Object} node - The instance the config spreads to.
 * @param {{ports: Array, variables: Array}} config - The edited instance's ports and rows.
 * @returns {{ports: Array, variables: Array}}
 */
export function spreadConfig(node, { ports, variables }) {
  const kinds = new Map(variables.map((row) => [row.name, row]))
  const rows = (node.data?.variables ?? []).map((row) => {
    const kind = kinds.get(row.name)
    return kind ? { ...row, units: kind.units, access: kind.access, type: kind.type } : row
  })
  const names = new Set(rows.map((row) => row.name))
  const added = variables
    .filter((row) => !names.has(row.name))
    .map(({ name, units, access, type }) => ({ name, value: null, units, access, type, data_reference: null }))
  return { ports: detachReactivity(ports ?? []).map(({ _uid, ...port }) => port), variables: [...rows, ...added] }
}

/**
 * Gets the other instances a ports edit reaches when its instance's module is updated, as useInstanceSave's
 * savePortEdit spreads it: every other instance on that module the edit doesn't itself change, with the ports and rows
 * spreadConfig gives it.
 *
 * @param {Array<{node: Object, ports: Array}>} edits - Each edited instance as it was, with its edited ports.
 * @param {Map<string, Object>} configs - Each changed instance's config by id (see useModuleConfigPrompt).
 * @param {Array} nodes - Every node.
 * @returns {Map<string, {ports: Array, variables: Array}>} By instance id.
 */
export function spreadPortEdits(edits, configs, nodes) {
  const edited = new Set(edits.map(({ node }) => node.id))
  const spread = new Map()
  for (const { node, ports } of edits) {
    if (configs.get(node.id)?.action !== 'update') continue
    const moduleRef = node.data?.moduleRef
    nodes
      .filter((other) => !edited.has(other.id) && !configs.has(other.id) && other.data?.moduleRef === moduleRef)
      .forEach((other) => spread.set(other.id, spreadConfig(other, { ports, variables: node.data?.variables ?? [] })))
  }
  return spread
}
