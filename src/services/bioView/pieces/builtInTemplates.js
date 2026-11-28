/**
 * The templates written as pieces (schema 4) that ship with PhLynx, read from `src/assets/bio_pieces`. Each is a
 * shortcut: dropping one adds copies of its pieces to the view.
 */

import { validatePiecesTemplate } from './model.js'

const files = import.meta.glob('../../../assets/bio_pieces/*.pieces.json', { eager: true })

/** The order they are listed in: the plainest first. */
const ORDER = [
  'cell',
  'epithelial-cell',
  'two-cell-epithelium',
  'chemical-synapse',
  'cardiomyocyte',
  'rod-photoreceptor',
]

/**
 * Validates bundled template files, skipping (and logging) any that fail.
 *
 * @param {Object<string, *>} modules - Parsed files keyed by path, as import.meta.glob gives them.
 * @returns {Array<Object>} Frozen templates, in ORDER and then by name.
 */
export function loadBuiltInPieceTemplates(modules) {
  const templates = []
  for (const [path, module] of Object.entries(modules)) {
    const { template, errors } = validatePiecesTemplate(module?.default ?? module)
    if (template) templates.push(template)
    else console.error(`Built-in template ${path} is invalid:`, errors)
  }
  const rank = (template) => (ORDER.includes(template.id) ? ORDER.indexOf(template.id) : ORDER.length)
  return templates.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

export const BUILT_IN_PIECE_TEMPLATES = Object.freeze(loadBuiltInPieceTemplates(files))

/**
 * @param {string} id
 * @returns {Object|null} The built-in template with that id.
 */
export const getBuiltInPieceTemplate = (id) => BUILT_IN_PIECE_TEMPLATES.find((template) => template.id === id) ?? null
