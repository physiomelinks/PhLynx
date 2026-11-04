/**
 * The physiology templates that ship with PhLynx, read from `src/assets/bio_templates`.
 */

import { validateTemplate } from './templates.js'

const files = import.meta.glob('../../assets/bio_templates/*.template.json', { eager: true })

/** The template listed first, as the usual starting point. */
export const DEFAULT_TEMPLATE_ID = 'epithelial-cell'

/**
 * Validates bundled template files, skipping (and logging) any that fail.
 *
 * @param {Object<string, *>} modules - Parsed files keyed by path, as import.meta.glob gives them.
 * @returns {Array<Object>} Frozen templates, the default first and then by name.
 */
export function loadBuiltInTemplates(modules) {
  const templates = []
  for (const [path, module] of Object.entries(modules)) {
    const { template, errors } = validateTemplate(module?.default ?? module)
    if (template) templates.push(template)
    else console.error(`Built-in template ${path} is invalid:`, errors)
  }
  return templates.sort(
    (a, b) => (b.id === DEFAULT_TEMPLATE_ID) - (a.id === DEFAULT_TEMPLATE_ID) || a.name.localeCompare(b.name),
  )
}

export const BUILT_IN_TEMPLATES = Object.freeze(loadBuiltInTemplates(files))

/**
 * @param {string} id
 * @returns {Object|null} The built-in template with that id.
 */
export function getBuiltInTemplate(id) {
  return BUILT_IN_TEMPLATES.find((template) => template.id === id) ?? null
}
