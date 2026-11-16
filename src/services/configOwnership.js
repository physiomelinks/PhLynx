/**
 * Config ownership: a module config an instance made for itself, by "Create new config" or by saving math no module
 * used, carries `source: {kind: 'instance', nodeId}`, as a parameter set the instance made does. Edits to an owned
 * config update it without asking while its owner is its only user; any other config, or an owned one another instance
 * also uses (a duplicate, a paste, a drop from its library card), asks to overwrite it or create a new config.
 * Kept apart from moduleConfig, which imports the node builders, so the save composable can use it.
 */
import { sanitiseName } from '../utils/identifiers'

/** A config's `source.kind` when an instance made it. */
export const INSTANCE_CONFIG_KIND = 'instance'

/**
 * Gives the `source` marking a config as a node's own.
 *
 * @param {string} nodeId
 * @returns {{kind: string, nodeId: string}}
 */
export const instanceConfigSource = (nodeId) => ({ kind: INSTANCE_CONFIG_KIND, nodeId })

/**
 * Whether a node made a config.
 *
 * @param {Object|null|undefined} module
 * @param {string} nodeId
 * @returns {boolean}
 */
export const isOwnConfig = (module, nodeId) => module?.source?.kind === INSTANCE_CONFIG_KIND && module.source.nodeId === nodeId

/**
 * Whether an edit to a node's config updates it without asking: the node made it and no other node uses it.
 *
 * @param {Object|null|undefined} module
 * @param {string} nodeId
 * @param {number} otherCount - How many other nodes use the config.
 * @returns {boolean}
 */
export const isSoleOwnConfig = (module, nodeId, otherCount) => otherCount === 0 && isOwnConfig(module, nodeId)

/**
 * Gives the ref of the config "Create new config" makes for an instance: `<type>:<instance name>`, numbered `_2`,
 * `_3`, ... until free within the type.
 *
 * @param {string} moduleRef - The config the instance leaves, or the one it would take, for the type.
 * @param {string} name - The instance's name.
 * @param {(ref: string) => boolean} isTaken
 * @returns {string}
 */
export function newConfigRef(moduleRef, name, isTaken) {
  const type = moduleRef.split(':')[0]
  const base = `${type}:${sanitiseName(name ?? '') || 'config'}`
  if (!isTaken(base)) return base
  let n = 2
  while (isTaken(`${base}_${n}`)) n++
  return `${base}_${n}`
}

/**
 * Gives a module as pasted into a workspace that lacks it: the instance that made it isn't there, so it's no one's.
 *
 * @param {Object} module
 * @returns {Object}
 */
export function withoutOwner(module) {
  if (module?.source?.kind !== INSTANCE_CONFIG_KIND) return module
  const { source, ...rest } = module
  return rest
}
