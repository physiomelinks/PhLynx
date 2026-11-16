/**
 * Keeps recovery drafts in IndexedDB, one record per tab: { id, savedAt, name, nodeCount, data }, keyed by id, the
 * tab's id. IndexedDB rather than localStorage, whose few megabytes a workspace can fill, and whose writes block.
 */

const DB_NAME = 'phlynx-recovery'
const STORE_NAME = 'drafts'

/**
 * @param {IDBFactory} [factory=globalThis.indexedDB]
 * @returns {{
 *   get: (id: string) => Promise<Object|null>,
 *   put: (draft: Object) => Promise<void>,
 *   delete: (id: string) => Promise<void>,
 *   list: () => Promise<Object[]>,
 * }}
 */
export function createDraftStore(factory = globalThis.indexedDB) {
  let opening = null

  function open() {
    if (!factory) return Promise.reject(new Error('This browser cannot keep recovery drafts.'))
    opening ??= new Promise((resolve, reject) => {
      const request = factory.open(DB_NAME, 1)
      request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: 'id' })
      request.onsuccess = () => resolve(request.result)
      request.onerror = () => {
        opening = null
        reject(request.error)
      }
    })
    return opening
  }

  /** Runs one request in its own transaction, resolving with its result once the transaction completes. */
  async function run(mode, makeRequest) {
    const db = await open()
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode)
      const request = makeRequest(transaction.objectStore(STORE_NAME))
      transaction.oncomplete = () => resolve(request.result)
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  }

  return {
    get: async (id) => (await run('readonly', (store) => store.get(id))) ?? null,
    put: async (draft) => {
      await run('readwrite', (store) => store.put(draft))
    },
    delete: async (id) => {
      await run('readwrite', (store) => store.delete(id))
    },
    list: async () => (await run('readonly', (store) => store.getAll())) ?? [],
  }
}
