/**
 * Names of nested modules. A module's path is the names from the root down to it joined with '/' (`heart/lv`), as
 * the breadcrumb shows it; it is the canonical name. Its flat name, which CellML components and CA rows use, joins
 * them with '__' (`heart__lv`). A root module's path and flat name are its own name.
 *
 * Names inside super-modules can't contain '__' nor start or end with '_' (see utils/hierarchy.js
 * localNameProblem), so a prefixed flat name splits back into its path. A super-module whose naming is 'preserve'
 * gives its children their own names, which don't encode a path: those are found through the expansion instead
 * (resolveName). A self leaf (a super-module's child whose role is 'self', from the CellML encapsulation import) is
 * its super instance's own component, so under 'prefixed' naming its flat name is its super instance's, though its path
 * is `<super instance>/self`.
 */

/** The role of a super-module's self leaf. */
export const SELF_ROLE = 'self'

/** Separates the levels of a path. */
export const PATH_SEPARATOR = '/'
/** Separates the levels of a flat name. */
export const LEVEL_SEPARATOR = '__'

/** @param {string[]} names @returns {string} The path of names from the root down. */
export const pathOfNames = (names) => names.join(PATH_SEPARATOR)

/** @param {string[]} names @returns {string} The flat name of names from the root down. */
export const flatNameOfNames = (names) => names.join(LEVEL_SEPARATOR)

/** @param {string} path @returns {string[]} The names along a path. */
export const namesOfPath = (path) => path.split(PATH_SEPARATOR)

/** @param {string} path - E.g. `heart/lv`. @returns {string} Its flat name, e.g. `heart__lv`. */
export const flatNameOfPath = (path) => flatNameOfNames(namesOfPath(path))

/**
 * Splits a prefixed flat name back into its path.
 *
 * @param {string} flatName - E.g. `heart__lv`.
 * @returns {string} E.g. `heart/lv`.
 */
export const splitFlat = (flatName) => pathOfNames(flatName.split(LEVEL_SEPARATOR))

/**
 * Finds a module of an expansion by its path or its flat name, through the expansion's own names, so a name under
 * 'preserve' naming is found too.
 *
 * @param {string} name - A path or a flat name.
 * @param {{ idOf: Function, pathOf: Function }} expansion - From expandHierarchy.
 * @returns {{ id: string, path: string }|null}
 */
export function resolveName(name, expansion) {
  const id = expansion.idOf(name) ?? (name.includes(LEVEL_SEPARATOR) ? expansion.idOf(splitFlat(name)) : undefined)
  return id === undefined ? null : { id, path: expansion.pathOf(id) }
}

/**
 * Gives a name as a path: a path as it is, a flat name through the expansion when it names one of its modules, else
 * split at '__'.
 *
 * @param {string} name
 * @param {{ idOf: Function, pathOf: Function }} [expansion]
 * @returns {string}
 */
export function toPath(name, expansion) {
  if (name.includes(PATH_SEPARATOR)) return name
  return (expansion && resolveName(name, expansion)?.path) ?? splitFlat(name)
}
