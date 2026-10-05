export const cleanName = (value) => sanitiseName(String(value ?? ''))

export function sanitiseName(name) {
  let sanitised = name
    .trim()
    .replace(/\s+/g, '_') // Replace spaces (and multiple spaces) with underscore
    .replace(/[^a-zA-Z0-9_]/g, '') // Remove all invalid characters

  // Ensure it starts with a letter or underscore
  if (sanitised && !/^[a-zA-Z_]/.test(sanitised)) {
    sanitised = '_' + sanitised
  }

  return sanitised
}

/**
 * Gets `baseName`, or `baseName_1`, `baseName_2`, ... if it is taken.
 *
 * @param {string} baseName
 * @param {Set<string>} takenNames
 * @returns {string}
 */
export function getUniqueName(baseName, takenNames) {
  let name = baseName
  let counter = 1
  while (takenNames.has(name)) name = `${baseName}_${counter++}`
  return name
}
