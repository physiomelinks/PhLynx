/**
 * The kinds of input a protocol's segment can hold, as the editor offers them, each with a glyph of its shape.
 */

// Each kind's label, and its glyph as polyline points in a 16 by 10 box.
export const INPUT_KINDS = [
  { value: 'number', label: 'Number', glyph: '0,5 16,5' },
  { value: 'step', label: 'Step', glyph: '0,8 7,8 7,2 16,2' },
  { value: 'pulse', label: 'Pulse', glyph: '0,8 5,8 5,2 11,2 11,8 16,8' },
  { value: 'pacing', label: 'Pacing', glyph: '0,8 2,8 2,2 4,2 4,8 8,8 8,2 10,2 10,8 14,8 14,2 16,2' },
  { value: 'ramp', label: 'Ramp', glyph: '0,8 16,2' },
  { value: 'trace', label: 'Trace', glyph: '0,7 3,4 6,6 9,2 12,5 16,3' },
]
const KINDS_BY_VALUE = new Map(INPUT_KINDS.map((kind) => [kind.value, kind]))

/**
 * Finds the kind of a segment's input.
 *
 * @param {Object} cell - From readProtocolInfo.
 * @returns {Object} One of INPUT_KINDS; pacing of several events counts as pacing.
 */
export function findInputKind(cell) {
  if (cell.kind === 'constant') return KINDS_BY_VALUE.get('number')
  if (cell.kind === 'trace') return KINDS_BY_VALUE.get('trace')
  return KINDS_BY_VALUE.get(cell.form?.type ?? 'pacing')
}
