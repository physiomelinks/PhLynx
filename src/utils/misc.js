import { sanitiseName } from '../utils/identifiers'

/**
 * Read a File object as text.
 */
export const readFileAsText = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target.result)
    reader.onerror = () => reject(new Error(`Failed to read ${file.name}`))
    reader.readAsText(file)
  })

export function sanitiseNameOnBlur(name) {
  if (name && name?.trim()) {
    const sanitised = sanitiseName(name)
    if (sanitised) {
      name = sanitised
    }
  }
}

/**
 * Hash a string to a 53-bit integer using the cyrb53 algorithm.
 * @param str Input string to hash.
 * @param seed Integer seed for the hash function (default: 0).
 * @returns A 53-bit integer hash of the input string.
 */
export const cyrb53 = (str, seed = 0) => {
    let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
    for(let i = 0, ch; i < str.length; i++) {
        ch = str.charCodeAt(i);
        h1 = Math.imul(h1 ^ ch, 2654435761);
        h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1  = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2  = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);

    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
};
