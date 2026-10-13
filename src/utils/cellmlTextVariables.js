/**
 * Finding the variables named in CellML Text, as CodeMirror's cellml() grammar parses it.
 */
import { syntaxTree } from '@codemirror/language'

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/
// CellML Text's own words, which can't name a variable.
const RESERVED_WORDS = new Set([
  'def', 'enddef', 'model', 'comp', 'as', 'var', 'unit', 'units', 'ode', 'sel', 'case', 'otherwise', 'endsel',
  'and', 'or', 'not', 'xor', 'pi', 'e', 'true', 'false', 'inf', 'infinity', 'NaN', 'notanumber',
])
// The grammar's nodes for names that aren't variables'. It leaves an equation's left-hand side and ode()'s arguments
// unnamed, so a variable is any identifier outside these.
const OTHER_NAME_NODES = new Set([
  'ComponentName',
  'UnitName',
  'UnitValue',
  'UnitAnnotation',
  'Number',
  'MathFunction',
  'MathConstant',
  'AnnotationKey',
  'AnnotationValue',
  'Comment',
])

/**
 * Finds the variable named at a position, including at either end of its name.
 *
 * @param {import('@codemirror/state').EditorState} state - A state with the cellml() language.
 * @param {number} position
 * @returns {{name: string, from: number, to: number}|null} The name and where it is, or null when the position is in
 *   no variable's name: a keyword, a units or function name, a number or a comment.
 */
export function findVariableAt(state, position) {
  const word = state.wordAt(position)
  if (!word) return null
  const name = state.sliceDoc(word.from, word.to)
  if (!IDENTIFIER.test(name) || RESERVED_WORDS.has(name)) return null
  if (OTHER_NAME_NODES.has(syntaxTree(state).resolveInner(word.from, 1).name)) return null
  // A function called, in a statement the grammar couldn't parse to mark it.
  if (/^\s*\(/.test(state.sliceDoc(word.to, Math.min(word.to + 40, state.doc.length)))) return null
  return { name, from: word.from, to: word.to }
}
