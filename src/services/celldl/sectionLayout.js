/**
 * Lays a diagram's math out in bg2cellml's sections: each opens with a `// <title>` comment after a blank line, in the
 * CellML Text tab. The layout is PhLynx's sidecar (libraryStore mathLayouts), so the CellML itself holds no comments.
 */
import { CellMLTextGenerator, CellMLTextParser } from 'cellml-text-editor'

/**
 * Gets the text layout that heads each section of a module's math with its title.
 *
 * @param {string} math - The module's math, as stored: a model holding its component.
 * @param {string} [componentName] - The component to lay out; omitted, the math's only one.
 * @param {ReadonlyArray<{title: string, variables: ReadonlyArray<string>}>} [sections] - bg2cellml's
 *   `result.sections`: each section's equations are the component's next `variables.length`, in order.
 * @returns {import('cellml-text-editor').TextLayout | null} Null without sections, or when the math's equations
 *   aren't the ones they count.
 */
export function sectionLayout(math, componentName, sections) {
  if (!math || !sections?.length) return null
  const generated = new CellMLTextGenerator({ simplified: false }).generateResult(math)
  if (generated.errors.length) return null
  const { layout, errors } = new CellMLTextParser({ simplified: false, sourceLineAttribute: null }).parse(generated.text)
  const components = (!errors.length && layout?.components) || []
  const component = componentName
    ? components.find((candidate) => candidate.name === componentName)
    : components.length === 1 && components[0]
  if (!component) return null

  const equations = component.statements.filter((statement) => statement.kind === 'eq')
  const counted = sections.reduce((total, section) => total + section.variables.length, 0)
  if (equations.length !== counted) return null
  let next = 0
  for (const { title, variables } of sections) {
    if (!variables.length) continue
    equations[next].leading = ['', `// ${title}`]
    next += variables.length
  }
  return layout
}
