import { ref } from 'vue'
import { useRoute } from 'vue-router'

import { whenLibCellMLReady } from '../utils/cellml'

function normaliseKeyword(open) {
  return open?.replace(/\/+$/, '').toLowerCase() ?? ''
}

export function useLoadFromUrl() {
  const route = useRoute()

  const isLoading = ref(false)

  const load = async (handlers, onError) => {
    const rawHash = route.hash.slice(1)
    if (!rawHash) return
    isLoading.value = true

    const keyword = normaliseKeyword(route.query.open)
    const handler = handlers[keyword]

    try {
      await whenLibCellMLReady()
      if (!handler) {
        onError?.(`Don't know how to open "${route.query.open ?? ''}".`)
        return
      }
      await handler(rawHash)
      // Only clear the hash once loaded, so a failed link can be retried.
      window.history.replaceState(null, '', window.location.pathname)
    } catch (e) {
      onError?.(`Failed to load from link: ${e.message}`)
    } finally {
      isLoading.value = false
    }
  }

  return {
    isLoading,
    load,
  }
}
