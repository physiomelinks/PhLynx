import { createApp } from 'vue'
import { createPinia } from 'pinia'
import PrimeVue from 'primevue/config'
import Tooltip from 'primevue/tooltip'
import Ripple from 'primevue/ripple'
import Aura from '@primevue/themes/aura'
import ConfirmationService from 'primevue/confirmationservice'
import ToastService from 'primevue/toastservice'
import libcellmlPlugin from 'vue3-libcellml.js'
import GlossaryLink from './components/GlossaryLink.vue'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/minimap/dist/style.css'
import '@vue-flow/node-resizer/dist/style.css'
import '@vue-flow/controls/dist/style.css'
import 'markdown-it-github-alerts/styles/github-colors-light.css'
import 'markdown-it-github-alerts/styles/github-colors-dark-class.css'
import 'markdown-it-github-alerts/styles/github-base.css'
import 'primeicons/primeicons.css'
import '@physiomelinks/protocol-kit/editor.css'

import './assets/style.css'
import './assets/main.css'
import './assets/sanitisewarning.css'

import router from './router'
import { useNodeThemeStore } from './stores/nodeThemeStore'
import App from './App.vue'
import { waitForIsolationReload } from './utils/isolation'
import { libopencor, loadLibOpenCOR } from './services/simulation/libopencorLoader'

// The first visit reloads once to install the isolation service worker; starting the app before that
// would load anything it was opened with twice.
waitForIsolationReload().then(() => {
  const app = createApp(App)
  const pinia = createPinia()

  app.use(pinia)
  app.use(router)
  app.use(PrimeVue, {
    ripple: true,
    theme: {
      preset: Aura,
      options: {
        darkModeSelector: '.p-dark',
        cssLayer: {
          name: 'primevue',
          /* Add this strict order for Tailwind v4 compatibility */
          order: 'theme, base, primevue, utilities',
        },
      },
    },
  })
  app.use(ConfirmationService)
  app.use(ToastService)
  app.directive('tooltip', Tooltip)
  app.directive('ripple', Ripple)
  app.use(libcellmlPlugin)
  app.component('GlossaryLink', GlossaryLink)
  app.provide('$libopencor', libopencor)
  app.mount('#app')

  // In the background, so the simulator is ready by the time it's needed; nothing waits for it here.
  loadLibOpenCOR()

  // Shared node colour themes load in the background; the built-in theme covers first paint.
  useNodeThemeStore(pinia).init()
})
