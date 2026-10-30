/**
 * A localStorage double backed by a Map, so tests never share the real store.
 *
 * @returns {{ getItem: Function, setItem: Function, removeItem: Function, store: Map<string, string> }}
 */
export function createMemoryStorage() {
  const store = new Map()
  return {
    store,
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  }
}
