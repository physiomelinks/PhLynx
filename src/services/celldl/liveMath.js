/**
 * Gets a module's math from a live conversion's CellML, as saving the diagram would store it: its component, with its
 * values moved out (separateParameters).
 */
import { extractComponentsFromCellmlString } from '../../utils/cellml.js'
import { separateParameters } from '../math/separateParameters.js'

/**
 * Gets the named component of converted CellML as a module's math, or the only one when the conversion had no name.
 *
 * @param {string} cellml - bg2cellml's CellML.
 * @param {string} [componentName] - The component it was generated as.
 * @returns {string|null} The component's math, or null when the CellML doesn't parse or has no such component.
 */
export function liveComponentMath(cellml, componentName) {
  const components = extractComponentsFromCellmlString(cellml).xml
  if (!components?.length) return null
  const component = componentName
    ? components.find((candidate) => candidate.name === componentName)
    : components.length === 1 && components[0]
  return component ? separateParameters(component.math).math : null
}
