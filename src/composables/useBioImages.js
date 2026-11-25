import { useBioPiecesStore } from '../stores/bioPiecesStore'
import { pickImageFile, readImageFile } from '../services/bioView/images'
import { notify } from '../utils/notify'

/**
 * Pictures for the physiology view's image pieces: read from a file and kept in the pieces' image store, saying what
 * is wrong where one can't be.
 *
 * @returns {{ keepImageFile: Function, chooseImage: Function }}
 */
export function useBioImages() {
  const pieces = useBioPiecesStore()

  /**
   * Reads a picture file and keeps it in the image store.
   *
   * @param {File} file
   * @returns {Promise<{id: string, width: number, height: number, label: string}|null>} The picture kept, as an
   *   image's drop takes it (see resolveImage); null where it can't be, having said why.
   */
  async function keepImageFile(file) {
    const read = await readImageFile(file)
    const id = read.entry ? pieces.addImage(read.entry) : null
    if (!id) {
      notify.error({ title: 'Could not add the picture', message: read.error ?? 'It is not a picture this can draw.' })
      return null
    }
    return { id, width: read.entry.width, height: read.entry.height, label: read.label }
  }

  /**
   * Asks for a picture file and keeps it, as keepImageFile does. Called from a click: a browser only opens its file
   * picker on one.
   *
   * @returns {Promise<{id: string, width: number, height: number, label: string}|null>} Null where none was chosen.
   */
  async function chooseImage() {
    const file = await pickImageFile()
    return file ? keepImageFile(file) : null
  }

  return { keepImageFile, chooseImage }
}
