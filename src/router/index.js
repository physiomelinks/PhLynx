import { createRouter, createWebHistory, START_LOCATION } from 'vue-router'
import { useGtm } from '../composables/useGtm'

import WorkspaceView from '../views/WorkspaceView.vue'
import AboutView from '../views/AboutView.vue'
import NotFoundView from '../views/NotFoundView.vue'
import SimulationView from '../views/SimulationView.vue'
import { formatDocsSlug, routeTitle, updateDocumentTitle } from './documentTitle'
import { ensureWorkspaceMounted } from './workspaceMount'

const { trackPageView } = useGtm()

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'workspace',
      component: WorkspaceView,
      meta: { title: 'Workflow Builder', showsProjectName: true },
    },
    {
      path: '/simulation',
      name: 'simulation',
      component: SimulationView,
      meta: { title: 'Simulation', showsProjectName: true },
      // The page shows the workspace's model, so the workspace loads first.
      beforeEnter: ensureWorkspaceMounted,
    },
    {
      path: '/about',
      name: 'about',
      component: AboutView,
      meta: { title: 'About' },
    },
    {
      path: '/docs/',
      redirect: '/docs/getting-started/introduction',
      meta: { title: 'Introduction' },
    },
    {
      path: '/docs/:slug(.*)*',
      name: 'docs',
      component: () => import('../views/DocsView.vue'),
      meta: {
        title: (route) => {
          const slug = route.params.slug

          // Fallback if visiting /docs/ root
          if (!slug || slug.length === 0) return 'Documentation'

          return formatDocsSlug(slug)
        },
      },
    },
    {
      path: '/:pathMatch(.*)',
      name: 'not-found',
      component: NotFoundView,
      meta: { title: '404 Not Found' },
    },
  ],
})

router.afterEach((to, from, failure) => {
  updateDocumentTitle(to)

  if (failure || (from !== START_LOCATION && to.path === from.path)) return
  // The route's title alone: the project's name stays out of analytics.
  trackPageView(to, routeTitle(to))
})

export default router
