/**
 * The words and bounds of the pieces the physiology view is built from (schema 4): compartments, membranes, tubes,
 * folds and process zones, and images, which are only drawn. See model.js for what each piece holds and topology.js
 * for how they relate.
 */

/** The format version of a list of pieces, and of a template written as one. */
export const PIECES_SCHEMA_VERSION = 4

/** The kinds of piece. */
export const PIECE_KINDS = Object.freeze(['compartment', 'membrane', 'tube', 'fold', 'zone', 'image'])

/** Whether a piece stands within a compartment by its `compartment`, as a process zone does, not by its `parent`. */
export const isWithinPiece = (piece) => piece?.kind === 'zone'

/**
 * What a piece stands in, as it is written: a zone's compartment, another's parent; undefined for the canvas, where
 * an image always is.
 */
export const containerIdOf = (piece) => (isWithinPiece(piece) ? piece.compartment : piece?.parent)

/** The sides of a membrane, clockwise from the top. A span's `from` and `to` run left to right, or top to bottom. */
export const SIDES = Object.freeze(['top', 'right', 'bottom', 'left'])

/** Which face of a membrane a compartment docks against: the one towards what it encloses, or the one away. */
export const FACES = Object.freeze(['inside', 'outside'])

/**
 * What a tube carries, kept for the connection rules: a flow along a conduit, a gap junction between two cells, a
 * bridge (an open channel of cytoplasm, its walls membrane, as a connecting cilium), or diffusion.
 */
export const FLUXES = Object.freeze(['flow', 'junction', 'bridge', 'diffusion'])

/** What a new process zone is called, numbered past the first (see addZone). */
export const ZONE_LABEL = 'Process zone'

/** Whether a process zone still has the name it was given when added, as no one has named it. */
export const isDefaultZoneLabel = (label) => new RegExp(`^${ZONE_LABEL}( \\d+)?$`).test(String(label ?? ''))

/** What a new image is called where its file gives it no name. */
export const IMAGE_LABEL = 'Image'

/** An image piece's picture: its id in the pieces' image store, from a hash of its data (see bioView/images.js). */
export const IMAGE_REF = /^img-[0-9a-f]{16}$/

/** The kinds of picture an image can be. */
export const IMAGE_TYPES = Object.freeze(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])

/** The colours a compartment can be drawn in. */
export const TONES = Object.freeze(['sky', 'rose', 'teal', 'amber', 'violet', 'lime', 'slate'])

/** The styles a compartment can be drawn in, other than a plain box. */
export const COMPARTMENT_STYLES = Object.freeze(['vessel'])

/** A piece's id, and a span's within its membrane. */
export const PIECE_ID = /^[a-z][a-z0-9-]{0,31}$/

/** A template's id. */
export const TEMPLATE_ID = /^[a-z][a-z0-9-]{1,47}$/

/** An ontology term, as a CURIE such as GO:0005737. */
export const CURIE = /^[A-Za-z][A-Za-z0-9_]{0,15}:[A-Za-z0-9_]{1,32}$/

/** A site's path: a piece's id, or '<membrane>.<span>' for a stretch of membrane. */
export const SITE_PATH = /^[a-z][a-z0-9-]{0,31}(?:\.[a-z][a-z0-9-]{0,31})?$/

/** Where along its side a fold dips in when it doesn't say: towards the right or bottom end, as folds always have. */
export const DEFAULT_FOLD_AT = 0.75

/** How far in from a membrane a compartment docked inside it starts, in pixels. */
export const INNER_INSET = 10
/**
 * How far what stands by its frame in a compartment or cell keeps from each of its sides, the same all round: it is
 * kept that far in from the top and left, and the compartment grows to leave as much past it at the right and bottom.
 */
export const ROOM_INSIDE = 30

export const DEFAULT_TONE = 'sky'
export const DEFAULT_FLUX = 'flow'

export const LIMITS = Object.freeze({
  name: 64,
  description: 280,
  author: 64,
  license: 64,
  label: 64,
  pieces: 256,
  spans: 8,
  docks: 8,
  bends: 16,
  sites: 256,
  /** A frame's size. */
  size: Object.freeze({ min: 20, max: 4000 }),
  /** How far a docked compartment reaches from its docks. */
  depth: Object.freeze({ min: 20, max: 1000 }),
  /** A frame's corner, from its parent's. */
  at: Object.freeze({ min: -20000, max: 20000 }),
  fold: Object.freeze({ min: 80, max: 1000 }),
})

/** The keys each object may have, in the order a clean copy lists them. */
export const PIECE_KEYS = Object.freeze({
  assembly: ['$schema', 'schemaVersion', 'id', 'name', 'description', 'author', 'license', 'pieces'],
  compartment: ['id', 'kind', 'label', 'parent', 'frame', 'docks', 'depth', 'tone', 'term', 'style', 'skin', 'site'],
  membrane: ['id', 'kind', 'label', 'parent', 'encloses', 'sides', 'frame', 'skin', 'site'],
  tube: ['id', 'kind', 'label', 'ends', 'flux', 'bends', 'skin', 'site'],
  fold: ['id', 'kind', 'label', 'membrane', 'side', 'at', 'depth', 'site'],
  zone: ['id', 'kind', 'label', 'compartment', 'frame', 'site'],
  image: ['id', 'kind', 'label', 'frame', 'image', 'opacity'],
  dock: ['on', 'side', 'face', 'from', 'to'],
  span: ['id', 'label', 'to', 'annotation', 'group', 'site'],
  annotation: ['facet', 'at'],
  frame: ['x', 'y', 'width', 'height'],
  point: ['x', 'y'],
  skin: ['ref', 'mode', 'opacity'],
})
