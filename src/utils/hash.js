/**
 * Hashes text by 32-bit FNV-1a: short and stable, to tell contents apart, never for security.
 *
 * @param {string} text
 * @returns {string} Eight hex digits.
 */
export function hashText(text) {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193) >>> 0
  return hash.toString(16).padStart(8, '0')
}
