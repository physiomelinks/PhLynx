/**
 * Sizes the physiological view is drawn at. Kept apart from geometry.js so the template validator can read
 * them without importing the shapes the built-in templates define.
 */

/** Size of a protein's cartoon, drawn with the outside up before it is turned to its facet. */
export const GLYPH_WIDTH = 64
export const GLYPH_HEIGHT = 48

/** Distance between neighbouring slots along a facet, at least: wider names along a top or bottom edge push it out. */
export const SLOT_PITCH = 88

/**
 * How wide a protein's name is drawn, estimated per character: at least `min`, cut short past `max` (see
 * BioProtein), with its padding on top.
 */
export const PROTEIN_LABEL = { char: 7, detailChar: 5.5, min: 40, max: 160, padding: 8 }

/** Space kept between the names of neighbouring proteins along a top or bottom edge. */
export const LABEL_GAP = 12

/**
 * Estimates how wide a protein's name, and the line of what it carries under it, are drawn.
 *
 * @param {string} [name]
 * @param {string} [detail]
 * @returns {number}
 */
export function proteinLabelWidth(name = '', detail = '') {
  const { char, detailChar, min, max, padding } = PROTEIN_LABEL
  return Math.min(max, Math.max(min, [...name].length * char, [...detail].length * detailChar)) + padding
}

/** Space at each end of a facet, so slots stay clear of the rounded corners. */
export const FACET_INSET = 56

/** Corner radius of a cell's outline. */
export const CELL_RADIUS = 40

/** Smallest a cell is drawn. */
export const MIN_CELL = { width: 320, height: 240 }
