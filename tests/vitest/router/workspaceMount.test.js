import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'

import { ensureWorkspaceMounted, setWorkspaceMounted } from '../../../src/router/workspaceMount.js'

/**
 * Builds a router with the simulation page guarded as the app's is.
 *
 * @returns {import('vue-router').Router}
 */
function buildRouter() {
  const Empty = { render: () => null }
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'workspace', component: Empty },
      { path: '/simulation', name: 'simulation', component: Empty, beforeEnter: ensureWorkspaceMounted },
    ],
  })
}

describe('ensureWorkspaceMounted', () => {
  afterEach(() => setWorkspaceMounted(false))

  it('sends a first visit to the simulation page to the workspace', async () => {
    const router = buildRouter()
    await router.push('/simulation')
    expect(router.currentRoute.value.name).toBe('workspace')
  })

  it('opens the simulation page once the workspace has mounted', async () => {
    const router = buildRouter()
    await router.push('/')
    setWorkspaceMounted(true)
    await router.push({ name: 'simulation' })
    expect(router.currentRoute.value.name).toBe('simulation')
  })
})
