import { EditorState } from '@codemirror/state'
import { ensureSyntaxTree } from '@codemirror/language'
import { cellml } from 'cellml-text-editor'
import { describe, expect, it } from 'vitest'

import { findVariableAt } from '../../../src/utils/cellmlTextVariables.js'

const TEXT = `def comp c as
  var x: metre {init: 1};
  ode(x, t) = -k_on*x + sin(x)*pi + 2{per_second}; // x decays
enddef;
`

/**
 * Finds the variable at the start of a piece of the text.
 *
 * @param {string} piece
 * @param {number} [offset] - From the piece's start.
 * @returns {string|null}
 */
function nameAt(piece, offset = 0) {
  const state = EditorState.create({ doc: TEXT, extensions: [cellml()] })
  ensureSyntaxTree(state, TEXT.length, 5000)
  return findVariableAt(state, TEXT.indexOf(piece) + offset)?.name ?? null
}

describe('findVariableAt', () => {
  it('finds a variable wherever it is named, including at its name’s end', () => {
    expect(nameAt('x: metre')).toBe('x')
    expect(nameAt('x, t)')).toBe('x')
    expect(nameAt('t) =')).toBe('t')
    expect(nameAt('k_on', 2)).toBe('k_on')
    expect(nameAt('k_on', 4)).toBe('k_on')
  })

  it('finds no variable in keywords, units, functions, constants, numbers or comments', () => {
    for (const piece of ['def', 'comp c', 'c as', 'var', 'metre', 'init', 'ode', 'sin', 'pi', 'per_second', 'decays', 'enddef']) {
      expect(nameAt(piece), piece).toBeNull()
    }
    expect(nameAt('2{per')).toBeNull()
  })
})
