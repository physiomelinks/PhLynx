/**
 * Warns, once a workspace is open, of the connections whose couplings circulatory_autogen (CA) would pair otherwise
 * (see couplingProblems), so they can be fixed in each one's dialog, which shows them too.
 */
import { escapeHtml } from '../../utils/importBatch'
import { notify } from '../../utils/notify'
import { couplingProblems } from './caReproducible'

// The most connections listed; the rest are counted.
const MAX_LISTED = 8

/**
 * Builds the warning for the workspace's connections CA would pair otherwise: one line per connection and reason,
 * as "<source> → <target>: <reason>", escaped, as the toast shows HTML.
 *
 * @param {Array} nodes - The store's nodes.
 * @param {Array} edges - The store's edges.
 * @returns {{title: string, message: string, duration: number}|null} The notify options, sticky; null when every
 *   connection pairs as CA does, or the workspace can't be checked.
 */
export function couplingProblemsWarning(nodes, edges) {
  let problems
  try {
    problems = couplingProblems(nodes, edges)
  } catch (error) {
    console.warn('Could not check the couplings against CA:', error)
    return null
  }
  if (!problems.length) return null

  const nameOf = (id) => nodes.find((node) => node.id === id)?.data?.name ?? id
  const edgeById = new Map(edges.map((edge) => [edge.id, edge]))
  const lines = [
    ...new Set(
      problems.map(({ edgeId, message }) => {
        const edge = edgeById.get(edgeId)
        return `${escapeHtml(nameOf(edge?.source))} → ${escapeHtml(nameOf(edge?.target))}: ${escapeHtml(message)}`
      })
    ),
  ]
  const shown = lines.slice(0, MAX_LISTED)
  if (lines.length > MAX_LISTED) shown.push(`…and ${lines.length - MAX_LISTED} more.`)
  return {
    title: 'Connections CA Would Pair Otherwise',
    message: [...shown, 'Open a connection to see and fix its problems.'].join('<br>'),
    duration: 0,
  }
}

/**
 * Shows the warning for the workspace's connections CA would pair otherwise, if any (see couplingProblemsWarning).
 *
 * @param {Array} nodes - The store's nodes.
 * @param {Array} edges - The store's edges.
 */
export function warnCouplingProblems(nodes, edges) {
  const warning = couplingProblemsWarning(nodes, edges)
  if (warning) notify.warning(warning)
}
