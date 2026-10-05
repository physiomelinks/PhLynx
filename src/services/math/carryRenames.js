/**
 * Simple Mode: carries a renamed variable's row over to its new name, as cellml-text-editor's own
 * session does. Pure (no Vue, no DOM), so it is safe in a worker.
 */
import { detectRenames } from 'cellml-text-editor'

/**
 * Carries rows across the variables renamed between two analyses. A variable renamed everywhere
 * moves its row to the new name; renamed in some places, the new name gets a copy and `partial`
 * reports it. A name that was already in use keeps its own row.
 *
 * @param {Object|null} previousAnalysis - From analyzeMathXml, so it has `references`.
 * @param {Object|null} nextAnalysis
 * @param {Array} rows - Rows for `previousAnalysis`; never mutated.
 * @param {Object} [options]
 * @param {{from: string, to: string}|null} [options.pending] - A partial rename still on offer.
 *   Once its last use is renamed, its ports follow even though `to` already has a row.
 * @returns {{rows: Array, renames: Array<{from: string, to: string}>, portRenames: Array<{from: string, to: string}>, partial: {from: string, to: string, uses: number}|null}}
 */
export function carryRenames(previousAnalysis, nextAnalysis, rows, { pending = null } = {}) {
  const before = previousAnalysis?.references
  const after = nextAnalysis?.references
  if (!before || !after) return { rows, renames: [], portRenames: [], partial: null }

  const renames = detectRenames(before, after)
  const wasReferenced = new Set(before)
  const isReferenced = new Set(after)
  const rowsByName = new Map(rows.map((row) => [row.name, row]))

  let nextRows = rows
  const portRenames = []
  let partial = null

  for (const { from, to } of renames) {
    const isGone = !isReferenced.has(from)
    const row = rowsByName.get(from)
    const isTaken = wasReferenced.has(to) || rowsByName.has(to)

    // Finishing the offered rename: `to` is the copy, and takes over the state pairing it left out.
    if (isGone && pending?.from === from && pending?.to === to) {
      const target = rowsByName.get(to)
      if (row?.initialiser && target && !target.initialiser) {
        const completed = { ...target, stateRole: row.stateRole, initialiser: row.initialiser }
        nextRows = nextRows.map((other) => (other === target ? completed : other))
        rowsByName.set(to, completed)
      }
      portRenames.push({ from, to })
    }
    if (!row || isTaken) continue

    if (isGone) {
      const moved = { ...row, name: to }
      nextRows = nextRows.map((other) => {
        if (other === row) return moved
        return other.initialiser === from ? { ...other, initialiser: to } : other
      })
      rowsByName.delete(from)
      rowsByName.set(to, moved)
      portRenames.push({ from, to })
    } else {
      // The copy is a new variable; resolveStateInitialisers gives it a state role if it needs one.
      const { stateRole, initialiser, ...declaration } = row
      const copy = { ...declaration, name: to }
      nextRows = [...nextRows, copy]
      rowsByName.set(to, copy)
      partial = { from, to, uses: after.filter((name) => name === from).length }
    }
  }

  return { rows: nextRows, renames, portRenames, partial }
}

/**
 * The partial rename to offer after an edit: a new one, the offered one following a name still
 * being typed, or null once either name has left the math.
 *
 * @param {{from: string, to: string, uses: number}|null} pending - The rename on offer before the edit.
 * @param {ReturnType<typeof carryRenames>} carried - The edit's carryRenames result.
 * @param {Object} nextAnalysis
 * @returns {{from: string, to: string, uses: number}|null}
 */
export function followPendingRename(pending, { renames, partial }, nextAnalysis) {
  const references = nextAnalysis?.references ?? []
  let next = partial ?? pending
  if (!partial && next) {
    const retyped = renames.find(({ from }) => from === next.to && !references.includes(from))
    if (retyped) next = { ...next, to: retyped.to }
  }
  if (!next || !references.includes(next.from) || !references.includes(next.to)) return null
  return { ...next, uses: references.filter((name) => name === next.from).length }
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Content MathML with every `<ci>` naming `from` renamed to `to`. Attributes are kept.
 *
 * @param {string} mathml - One or more `<math>` elements.
 * @param {string} from
 * @param {string} to
 * @returns {string}
 */
export function renameCiInMathML(mathml, from, to) {
  const ci = new RegExp(`(<((?:[\\w-]+:)?ci)(?:\\s[^>]*)?>)\\s*${escapeRegExp(from)}\\s*(</\\2>)`, 'g')
  return mathml.replace(ci, (_, open, _name, close) => `${open}${to}${close}`)
}
