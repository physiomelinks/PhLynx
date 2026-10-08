import { defineStore } from 'pinia'
import { ref } from 'vue'

import { DEFAULT_CELLML_FILE_NAME } from '../utils/constants'

function arrayBufferToBase64(value) {
  if (value == null) return ''

  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value)
  let binary = ''

  for (let index = 0; index < bytes.byteLength; index += 1) {
    binary += String.fromCharCode(bytes[index])
  }

  return btoa(binary)
}

function base64ToArrayBuffer(value) {
  if (!value) return null

  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }

  return bytes.buffer
}

function normaliseArchiveEntry(entry) {
  if (!entry || !entry.location) {
    return null
  }

  return {
    location: entry.location,
    format: entry.format || 'application/octet-stream',
    payload: entry.payload ?? null,
  }
}

function encodeEntryPayload(payload) {
  if (payload == null) return null

  if (typeof payload === 'string') {
    return payload
  }

  if (payload instanceof ArrayBuffer) {
    return arrayBufferToBase64(payload)
  }

  if (ArrayBuffer.isView(payload)) {
    return arrayBufferToBase64(payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength))
  }

  return null
}

function decodeEntryPayload(payload) {
  if (payload == null) return null

  if (payload instanceof ArrayBuffer) {
    return payload
  }

  if (ArrayBuffer.isView(payload)) {
    return payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength)
  }

  if (typeof payload === 'string') {
    return base64ToArrayBuffer(payload)
  }

  return null
}

export const useOmexStore = defineStore('omex', () => {
  const archiveName = ref('')
  const archiveType = ref('omex')
  const cellmlFileName = ref(DEFAULT_CELLML_FILE_NAME) // Default to 'model.cellml' if not set
  const manifestXml = ref('')
  const preservedExtras = ref([])
  // The archiveHash is not a hash of the archive itself but the hash of the workspace state
  // that the content of the archive represents at the time the archive was imported.
  // It is used to determine if the workspace has changed since the archive was imported.
  const archiveHash = ref(0)

  function resetState() {
    archiveName.value = ''
    archiveType.value = 'omex'
    cellmlFileName.value = DEFAULT_CELLML_FILE_NAME
    manifestXml.value = ''
    preservedExtras.value = []
    archiveHash.value = 0
  }

  function setHash(hash) {
    archiveHash.value = hash
  }

  function setArchive({
    archiveName: nextArchiveName = '',
    archiveType: nextArchiveType = 'omex',
    cellmlFileName: nextCellmlFileName = DEFAULT_CELLML_FILE_NAME,
    manifestXml: nextManifestXml = '',
    extras = [],
  } = {}) {
    archiveName.value = nextArchiveName
    archiveType.value = nextArchiveType
    cellmlFileName.value = nextCellmlFileName
    manifestXml.value = nextManifestXml
    preservedExtras.value = (Array.isArray(extras) ? extras : [])
      .map(normaliseArchiveEntry)
      .filter(Boolean)
      .map((entry) => ({ ...entry, payload: decodeEntryPayload(entry.payload) }))
  }

  function loadState(state) {
    resetState()

    if (!state) {
      return
    }

    setArchive({
      archiveHash: state.archiveHash || 0,
      archiveName: state.archiveName || '',
      archiveType: state.archiveType || 'omex',
      cellmlFileName: state.cellmlFileName || DEFAULT_CELLML_FILE_NAME,
      manifestXml: state.manifestXml || '',
      extras: (state.preservedExtras || []).map((entry) => ({
        ...entry,
        payload: entry.payload,
      })),
    })
  }

  function getState() {
    return {
      archiveHash: archiveHash.value,
      archiveName: archiveName.value,
      archiveType: archiveType.value,
      cellmlFileName: cellmlFileName.value,
      manifestXml: manifestXml.value,
      preservedExtras: preservedExtras.value.map((entry) => ({
        ...entry,
        payload: encodeEntryPayload(entry.payload),
      })),
    }
  }

  /**
   * Writes a file the archive carries, replacing the one at its location or adding it.
   *
   * @param {{location: string, format: string, payload: ArrayBuffer}} entry
   */
  function writeExtra(entry) {
    const written = normaliseArchiveEntry(entry)
    const index = preservedExtras.value.findIndex(({ location }) => location === written.location)
    preservedExtras.value = index < 0 ? [...preservedExtras.value, written] : preservedExtras.value.map((extra, i) => (i === index ? written : extra))
  }

  /**
   * Moves a file the archive carries to another place among them, the others keeping their order. The order is
   * saved, and written into the archive's manifest.
   *
   * @param {string} location
   * @param {number} index - Its place once moved.
   */
  function moveExtra(location, index) {
    const from = preservedExtras.value.findIndex((extra) => extra.location === location)
    if (from < 0) return
    const extras = [...preservedExtras.value]
    const [moved] = extras.splice(from, 1)
    extras.splice(Math.max(0, Math.min(index, extras.length)), 0, moved)
    preservedExtras.value = extras
  }

  /**
   * Removes a file the archive carries.
   *
   * @param {string} location
   */
  function removeExtra(location) {
    preservedExtras.value = preservedExtras.value.filter((extra) => extra.location !== location)
  }

  /**
   * Moves a file the archive carries to another location, keeping its place among them.
   *
   * @param {string} location
   * @param {string} nextLocation
   * @throws {Error} When another file is at the new location.
   */
  function renameExtra(location, nextLocation) {
    if (location === nextLocation) return
    if (preservedExtras.value.some((extra) => extra.location === nextLocation)) throw new Error(`${nextLocation} already exists.`)
    preservedExtras.value = preservedExtras.value.map((extra) => (extra.location === location ? { ...extra, location: nextLocation } : extra))
  }

  return {
    archiveHash,
    archiveName,
    archiveType,
    cellmlFileName,
    manifestXml,
    preservedExtras,
    resetState,
    setArchive,
    writeExtra,
    moveExtra,
    removeExtra,
    renameExtra,
    setHash,
    loadState,
    getState,
  }
})
