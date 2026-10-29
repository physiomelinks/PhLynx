/**
 * The formats a module's math can be authored in. A math is CellML unless the library holds a
 * source for it (libraryStore.mathSources), whose `format` is one of these ids.
 *
 * Each format gives:
 * - `label`: its name, as messages show it;
 * - `isMathLocked`: whether the CellML is generated from the source, so must not be edited;
 * - `caModuleFormat`: the CA config's `module_format`;
 * - `isAvailable`: whether this build can open the format;
 * - `editorTab` (optional): the instance editor tab that edits the source, `{ value, label, icon, errorHeader,
 *   lockedNotice, editedNotice }`, shown after the CellML Text and Math Editor tabs for every module while the
 *   format is available, and locked, with `lockedNotice` as its tooltip, for math in another format. The template
 *   offers it until its math is edited, then locks it with `editedNotice`.
 */

export const DEFAULT_MODULE_FORMAT = 'cellml'

export const MODULE_FORMATS = Object.freeze({
  cellml: Object.freeze({
    id: 'cellml',
    label: 'CellML',
    isMathLocked: false,
    caModuleFormat: 'cellml',
    isAvailable: true,
  }),
  celldl: Object.freeze({
    id: 'celldl',
    label: 'CellDL',
    isMathLocked: true,
    // The CA export writes the generated CellML, never the diagram.
    caModuleFormat: 'cellml',
    editorTab: Object.freeze({
      value: 'celldl',
      // CellDL is still in development, so the tab says so.
      label: 'CellDL (beta)',
      icon: 'pi-sitemap',
      errorHeader: 'Diagram Has Errors',
      lockedNotice: 'CellDL diagrams can only start from the template',
      editedNotice: 'The CellML was edited, so this module is CellML. Undo the edits to draw a diagram instead',
    }),
    // Off in Electron, whose CSP blocks the converter's wasm and which has no simulator. The flag
    // is a Vite define, so it is missing outside Vite builds.
    isAvailable: typeof __IS_ELECTRON__ === 'undefined' || !__IS_ELECTRON__,
  }),
})

/**
 * Gets a format by id. A missing id is CellML; an unknown one gets a locked, unavailable fallback,
 * so its generated CellML stays read-only.
 *
 * @param {string|null|undefined} id
 * @returns {{ id: string, label: string, isMathLocked: boolean, caModuleFormat: string, isAvailable: boolean, editorTab?: Object }}
 */
export function getModuleFormat(id) {
  if (!id) return MODULE_FORMATS[DEFAULT_MODULE_FORMAT]
  if (Object.hasOwn(MODULE_FORMATS, id)) return MODULE_FORMATS[id]
  return Object.freeze({
    id,
    label: id,
    isMathLocked: true,
    caModuleFormat: 'cellml',
    isAvailable: false,
  })
}

/**
 * Gets the formats whose editor tab this build shows.
 *
 * @returns {Object[]} Formats, in table order.
 */
export function getEditorTabFormats() {
  return Object.values(MODULE_FORMATS).filter((format) => format.editorTab && format.isAvailable)
}

/**
 * Checks a math source read from a file or the clipboard. Its format must be named, and its
 * document and document URI must be text (the document may be null for a new, empty diagram).
 * Other fields are kept as they are, so a newer format's source survives a round trip.
 *
 * @param {*} source
 * @returns {Object|null} The source, or null if it is malformed.
 */
export function checkMathSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) return null
  if (typeof source.format !== 'string' || !source.format) return null
  if (source.document !== null && typeof source.document !== 'string') return null
  if (typeof source.documentUri !== 'string') return null
  return source
}
