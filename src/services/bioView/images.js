/**
 * Pictures for image pieces: a picture the user chose, drawn in a compartment of the physiology view to look at, no
 * part of the model. Each is kept once in the pieces' image store (see bioPiecesStore) as a data URL, under an id
 * made from a hash of it, so the same picture added twice is kept once, and image pieces name it by that id.
 *
 * Only bitmaps (PNG, JPEG, WebP, GIF) are taken, always drawn with an <img>, so nothing in one can run. A big one is
 * shrunk as it is read, so a workspace stays small enough to save and undo.
 */

import { IMAGE_LABEL, IMAGE_REF, IMAGE_TYPES, LIMITS } from './pieces/constants.js'

/** The longest side a picture is kept at; a bigger one is shrunk to it. */
export const IMAGE_MAX_SIDE = 1600
/** How long a picture's data URL may be once read, shrunk where it needs to be: about 1.5 MB of picture. */
export const IMAGE_MAX_DATA = 2_000_000
/** How big a file may be to read at all: it is shrunk once read. */
export const IMAGE_MAX_FILE = 25 * 1024 * 1024
/** How long the longest side of a new image piece is drawn, at most. */
export const IMAGE_NEW_SIDE = 240

/** What the file picker offers. */
export const IMAGE_ACCEPT = IMAGE_TYPES.join(',')

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/
const isSide = (value) => Number.isInteger(value) && value > 0 && value <= 20000

/**
 * Whether an entry of the image store is a picture this build draws: a data URL of one of IMAGE_TYPES, base64, with
 * its size.
 *
 * @param {*} entry
 * @returns {boolean}
 */
export function isImageEntry(entry) {
  if (!entry || typeof entry !== 'object' || !IMAGE_TYPES.includes(entry.type)) return false
  if (!isSide(entry.width) || !isSide(entry.height)) return false
  const { data } = entry
  const prefix = `data:${entry.type};base64,`
  if (typeof data !== 'string' || !data.startsWith(prefix) || data.length > IMAGE_MAX_DATA) return false
  return BASE64.test(data.slice(prefix.length))
}

/** cyrb53: a quick 53-bit hash of a string. */
function cyrb53(text, seed) {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ code, 2654435761)
    h2 = Math.imul(h2 ^ code, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return 4294967296 * (2097151 & h2) + (h1 >>> 0)
}

/**
 * The id a picture is kept under: img- and 16 hexadecimal digits, from a hash of its data, so the same picture always
 * has the same id.
 *
 * @param {string} data - Its data URL.
 * @returns {string} Matches IMAGE_REF.
 */
export function imageIdOf(data) {
  const half = (seed) => (cyrb53(data, seed) % 0x100000000).toString(16).padStart(8, '0')
  const id = `img-${half(1)}${half(2)}`
  if (!IMAGE_REF.test(id)) throw new Error(`Bad image id ${id}`)
  return id
}

/**
 * How big a new image piece is drawn: as its picture is, its longest side IMAGE_NEW_SIDE at most, and no smaller than
 * a frame may be.
 *
 * @param {{width: number, height: number}} picture
 * @param {number} [longest=IMAGE_NEW_SIDE]
 * @returns {{width: number, height: number}}
 */
export function imageFrameSize({ width, height }, longest = IMAGE_NEW_SIDE) {
  const scale = Math.min(1, longest / Math.max(width, height))
  const side = (value) => Math.round(Math.min(LIMITS.size.max, Math.max(LIMITS.size.min, value * scale)))
  return { width: side(width), height: side(height) }
}

/**
 * The name a new image piece is given: its file's, without its extension, as long as a label may be.
 *
 * @param {string} [fileName]
 * @returns {string}
 */
export function imageLabelOf(fileName) {
  const bare = String(fileName ?? '')
    .replace(/\.[^.]+$/, '')
    .trim()
  return bare.slice(0, LIMITS.label) || IMAGE_LABEL
}

/** Why a file can't be an image's picture, or null where it can. */
export function imageFileProblem(file) {
  if (!file) return 'No file was chosen.'
  if (file.type === 'image/svg+xml' || /\.svg$/i.test(file.name ?? '')) {
    return 'SVG pictures can’t be added as images yet: save it as a PNG first.'
  }
  if (!IMAGE_TYPES.includes(file.type)) return 'Choose a PNG, JPEG, WebP or GIF picture.'
  if (file.size > IMAGE_MAX_FILE) return `That picture is too big: choose one under ${IMAGE_MAX_FILE / 1024 / 1024} MB.`
  return null
}

/** Whether a drag carries files that could all be pictures, as far as a drag tells before the drop. */
export function isImageFileDrag(event) {
  const items = [...(event.dataTransfer?.items ?? [])]
  return items.length > 0 && items.every((item) => item.kind === 'file' && IMAGE_TYPES.includes(item.type))
}

// ── In the browser ───────────────────────────────────────────────────────

const readAsDataUrl = (file) =>
  new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = () => reject(reader.error ?? new Error('The file could not be read.'))
    reader.readAsDataURL(file)
  })

const loadPicture = (src) =>
  new Promise((resolve, reject) => {
    const picture = new Image()
    picture.onload = () => resolve(picture)
    picture.onerror = () => reject(new Error('The picture could not be read.'))
    picture.src = src
  })

/**
 * Draws a picture smaller, as a data URL: a JPEG stays one, anything else is a WebP where the browser writes them,
 * else a PNG, so transparency is kept.
 */
function shrink(picture, type, width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  canvas.getContext('2d').drawImage(picture, 0, 0, width, height)
  if (type === 'image/jpeg') return { type, data: canvas.toDataURL(type, 0.88) }
  const webp = canvas.toDataURL('image/webp', 0.88)
  if (webp.startsWith('data:image/webp;')) return { type: 'image/webp', data: webp }
  return { type: 'image/png', data: canvas.toDataURL('image/png') }
}

/**
 * Reads a picture file as an image store entry, shrunk to IMAGE_MAX_SIDE and IMAGE_MAX_DATA where it is bigger.
 *
 * @param {File} file
 * @returns {Promise<{entry: {type: string, data: string, width: number, height: number}, label: string}|
 *   {error: string}>}
 */
export async function readImageFile(file) {
  const problem = imageFileProblem(file)
  if (problem) return { error: problem }
  try {
    const original = await readAsDataUrl(file)
    const picture = await loadPicture(original)
    const [width, height] = [picture.naturalWidth, picture.naturalHeight]
    if (!width || !height) return { error: 'The picture has no size.' }
    let entry = { type: file.type, data: original, width, height }
    let scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(width, height))
    for (let tries = 0; tries < 6 && (scale < 1 || entry.data.length > IMAGE_MAX_DATA); tries++) {
      const size = { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
      entry = { ...shrink(picture, file.type, size.width, size.height), ...size }
      if (entry.data.length <= IMAGE_MAX_DATA) break
      scale *= 0.7
    }
    if (!isImageEntry(entry)) return { error: 'The picture is too big to keep, even shrunk.' }
    return { entry, label: imageLabelOf(file.name) }
  } catch (error) {
    return { error: error?.message ?? 'The picture could not be read.' }
  }
}

/**
 * Asks the user for a picture file. Called from a click, as a browser only opens its file picker on one.
 *
 * @returns {Promise<File|null>} Null where they chose none.
 */
export function pickImageFile() {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = IMAGE_ACCEPT
    input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true })
    input.addEventListener('cancel', () => resolve(null), { once: true })
    input.click()
  })
}
