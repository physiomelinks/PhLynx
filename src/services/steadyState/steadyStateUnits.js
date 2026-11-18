/**
 * Units for the variables a steady-state reduction adds (the flux, its lumped parameters, the cycle's total), found
 * by dimensional analysis of their definitions and matched to units the module already uses.
 */
import { readMathML, toEquations } from '@physiomelinks/math-ast'

import { resolveUnits, sameDimensions } from '../../utils/units'

const DIMENSIONLESS = { coefficient: 1, power: 0, dimensions: {}, affine: false }

function multiply(a, b, exponent = 1) {
  const dimensions = { ...a.dimensions }
  for (const [name, power] of Object.entries(b.dimensions)) dimensions[name] = (dimensions[name] ?? 0) + power * exponent
  return { coefficient: a.coefficient * b.coefficient ** exponent, power: a.power + b.power * exponent, dimensions, affine: false }
}

const scale = (expansion) => expansion.coefficient * 10 ** expansion.power
const sameScale = (a, b) => Math.abs(scale(a) - scale(b)) <= 1e-9 * Math.max(Math.abs(scale(a)), Math.abs(scale(b)))

/**
 * Infers the units of the variables `mathml` defines that `known` doesn't have.
 *
 * @param {Object} options
 * @param {string} options.mathml - The reduced module's equations, as one `<math>`.
 * @param {Map<string, string>} options.known - Units of the variables the module already has, by name.
 * @param {Map<string, Array<Object>>} options.unitDefinitions - From mergeUnitDefinitions.
 * @returns {{ units: Map<string, string>, unresolved: string[] }} Units by variable, and the variables whose units
 *   couldn't be found or matched to a name the module uses.
 */
export function inferSteadyStateUnits({ mathml, known, unitDefinitions }) {
  const cache = new Map()
  const expansionOf = (unitsName) => resolveUnits(unitsName, unitDefinitions, cache) ?? null
  const expansions = new Map()
  for (const [name, unitsName] of known) {
    const expansion = expansionOf(unitsName)
    if (expansion) expansions.set(name, expansion)
  }

  const evaluate = (node) => {
    switch (node.type) {
      case 'Number':
        return node.units ? expansionOf(node.units) : DIMENSIONLESS
      case 'Identifier':
        return expansions.get(node.name) ?? null
      case 'Add': {
        for (const child of node.children) {
          const expansion = evaluate(child)
          if (expansion) return expansion
        }
        return null
      }
      case 'Subtract':
        return evaluate(node.minuend) ?? evaluate(node.subtrahend)
      case 'Negate':
        return evaluate(node.value)
      case 'Multiply':
        return node.children.reduce((product, child) => {
          const expansion = product && evaluate(child)
          return expansion ? multiply(product, expansion) : null
        }, DIMENSIONLESS)
      case 'Divide': {
        const top = evaluate(node.numerator)
        const bottom = evaluate(node.denominator)
        return top && bottom ? multiply(top, bottom, -1) : null
      }
      case 'Power': {
        const base = evaluate(node.base)
        return base && node.exponent.type === 'Number' ? multiply(DIMENSIONLESS, base, node.exponent.value) : null
      }
      case 'FunctionCall':
        return ['exp', 'ln', 'log'].includes(node.name) ? DIMENSIONLESS : null
      default:
        return null
    }
  }

  // Definitions may come before what they use, so repeat until nothing more is found
  const definitions = toEquations(readMathML(mathml).expressions.filter(Boolean)).filter(
    (equation) => equation.left.type === 'Identifier' && !known.has(equation.left.name)
  )
  let progress = true
  while (progress) {
    progress = false
    for (const { left, right } of definitions) {
      if (expansions.has(left.name)) continue
      const expansion = evaluate(right)
      if (expansion) {
        expansions.set(left.name, expansion)
        progress = true
      }
    }
  }

  // Name each found expansion with units the module uses
  const candidates = [...new Set(['dimensionless', ...known.values()])]
    .map((unitsName) => ({ unitsName, expansion: expansionOf(unitsName) }))
    .filter(({ expansion }) => expansion)
  const units = new Map()
  const unresolved = []
  for (const { left } of definitions) {
    const expansion = expansions.get(left.name)
    const match =
      expansion &&
      candidates.find((candidate) => sameDimensions(candidate.expansion, expansion) && sameScale(candidate.expansion, expansion))
    if (match) units.set(left.name, match.unitsName)
    else unresolved.push(left.name)
  }
  return { units, unresolved }
}
