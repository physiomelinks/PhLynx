import JSZip from 'jszip'

/** The one entry in a draft's zip: the workspace, as a save would write it but without the indentation. */
export const DRAFT_ENTRY = 'workspace.json'

/**
 * Zips a workspace for keeping as a recovery draft.
 *
 * @param {Object} state - A workspace, as buildWorkspaceFile makes it.
 * @returns {Promise<Uint8Array>} The zip. Bytes rather than a Blob, which some browsers keep badly in IndexedDB.
 */
export async function packDraft(state) {
  const zip = new JSZip()
  zip.file(DRAFT_ENTRY, JSON.stringify(state))
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level: 6 } })
}

/**
 * Reads the workspace back out of a draft's zip.
 *
 * @param {Uint8Array|ArrayBuffer|Blob} data - The zip, as packDraft made it.
 * @returns {Promise<Object>} The workspace.
 */
export async function unpackDraft(data) {
  const zip = await JSZip.loadAsync(data)
  const entry = zip.file(DRAFT_ENTRY)
  if (!entry) throw new Error('The recovery draft holds no workspace.')
  return JSON.parse(await entry.async('string'))
}
