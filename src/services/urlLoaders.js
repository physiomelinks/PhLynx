import { base64ToUtf8, base64ToBlob } from './compress'

/**
 * Builds the ?open= loaders. Each decodes its payload, then waits for libraryReady so the built-in library is
 * registered before the loaded state goes in, never on top of it.
 *
 * @param {{ applyWorkspaceState: Function, importOmexFile: Function, processImportedOmexArchive: Function,
 *   libraryReady?: Promise<unknown> }} deps
 */
export function createUrlLoaders({
  applyWorkspaceState,
  importOmexFile,
  processImportedOmexArchive,
  libraryReady = Promise.resolve(),
}) {
  return {
    workspace_json: async (base64) => {
      const json = JSON.parse(await base64ToUtf8(base64))
      await libraryReady
      await applyWorkspaceState(json, { source: 'url' })
    },

    omex: async (base64) => {
      const zipBlob = await base64ToBlob(base64, 'application/zip')
      await libraryReady
      const result = await importOmexFile(zipBlob)
      await processImportedOmexArchive(zipBlob, result, 'url_imported.omex')
    },
  }
}
