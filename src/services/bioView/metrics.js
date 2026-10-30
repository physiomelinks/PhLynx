/**
 * Sizes the physiological view is drawn at. Kept apart from geometry.js so the template validator can read
 * them without importing the shapes the built-in templates define.
 */

/** Size of a protein's cartoon, drawn with the outside up before it is turned to its facet. */
export const GLYPH_WIDTH = 64
export const GLYPH_HEIGHT = 48

/** Distance between neighbouring slots along a facet. */
export const SLOT_PITCH = 88

/** Space at each end of a facet, so slots stay clear of the rounded corners. */
export const FACET_INSET = 56

/** Corner radius of a cell's outline. */
export const CELL_RADIUS = 40

/** Smallest a cell is drawn. */
export const MIN_CELL = { width: 320, height: 240 }
