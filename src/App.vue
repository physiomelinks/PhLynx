<template>
  <div class="app-layout">
    <header class="global-nav">
      <!-- <div class="image-container">
        
      </div> -->
      <div class="brand">
        <img src="/phlynxlogo.svg" alt="PhLynx Logo" class="centred-image" />
        <strong data-testid="app-version">PhLynx v{{ appVersion }}</strong>
      </div>
      <div v-show="showsSessionName" class="session-name" @dblclick="startEditing">
        <strong
          v-if="!isEditing"
          ref="sessionNameEl"
          v-tooltip.bottom="{ value: hasSessionOverflow ? sessionName : '', class: 'nowrap-tooltip' }"
        >
          {{ sessionName }}
        </strong>
        <InputText
          v-else
          ref="inputRef"
          v-model="editingValue"
          @blur="saveEdit"
          @keyup.enter="saveEdit"
          @keyup.esc="cancelEdit"
        />
      </div>
      <nav>
        <router-link to="/">Workspace</router-link>
        <router-link to="/simulation">Simulation</router-link>
        <router-link to="/docs/" :class="{ 'force-active': isDocsActive }">User Guide</router-link>
        <router-link to="/about">About</router-link>
        <router-link
          :to="{ path: '/about', query: { tab: 'notices' } }"
          class="notices-link"
          active-class=""
          exact-active-class=""
          :aria-label="noticesLabel"
          v-hint.bottom="noticesLabel"
          data-testid="notices-link"
        >
          <i class="pi pi-bell" aria-hidden="true"></i>
          <span v-if="unreadCount" class="notices-badge" data-testid="notices-badge" aria-hidden="true">
            {{ unreadCount > 9 ? '9+' : unreadCount }}
          </span>
        </router-link>
        <a
          href="https://github.com/physiomelinks/phlynx/issues/new"
          target="_blank"
          rel="noopener"
          class="report-issue-link"
          aria-label="Report an issue"
          v-hint.bottom="'Report an issue'"
        >
          <BugIcon aria-hidden="true" />
        </a>
        <ThemeToggle class="nav-theme-toggle" />
      </nav>
    </header>

    <div class="view-container">
      <router-view v-slot="{ Component }">
        <keep-alive :include="['WorkspaceView', 'SimulationView']">
          <component :is="Component" />
        </keep-alive>
      </router-view>
    </div>
    <ConfirmDialog />
  </div>
</template>

<script setup>
import { computed, ref, nextTick, onBeforeUnmount, onMounted, watch } from 'vue'
import { useRoute } from 'vue-router'
import InputText from 'primevue/inputtext'

import { updateDocumentTitle } from './router/documentTitle'
import { useNotices } from './composables/useNotices'
import { useSessionMetadataStore } from './stores/sessionMetadataStore'

import ConfirmDialog from './components/ConfirmDialog.vue'
import BugIcon from './components/icons/BugIcon.vue'
import ThemeToggle from './components/ThemeToggle.vue'

const appVersion = __APP_VERSION__ + __BUILD_STATE_MARKER__
const route = useRoute()
const sessionMetadataStore = useSessionMetadataStore()

const { unreadCount, refreshNotices } = useNotices()

const noticesLabel = computed(() => {
  if (!unreadCount.value) return 'Notices'
  return `Notices (${unreadCount.value} unread)`
})

// On start, and on coming back to a tab left open: the fetch itself is held to once an hour.
const refreshNoticesWhenVisible = () => {
  if (document.visibilityState === 'visible') refreshNotices()
}

onMounted(() => {
  refreshNotices()
  document.addEventListener('visibilitychange', refreshNoticesWhenVisible)
})

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', refreshNoticesWhenVisible)
})

const sessionName = computed(() => sessionMetadataStore.lastSaveName)
const sessionNameEl = ref(null)
const hasSessionOverflow = ref(false)

const editingValue = ref('')
const isEditing = ref(false)
const inputRef = ref(null)

const checkOverflow = () => {
  const el = sessionNameEl.value
  if (el) {
    hasSessionOverflow.value = el.scrollWidth > el.clientWidth
  }
}

watch(sessionName, () => {
  nextTick(checkOverflow)
  // The router sets the title on navigation; a rename, save or load changes the name in place.
  updateDocumentTitle(route)
})

const isDocsActive = computed(() => {
  return route.path.startsWith('/docs')
})

// The simulation page shows the workspace's model, so it shows the session's name too.
const showsSessionName = computed(() => {
  return route.path === '/' || route.name === 'simulation'
})

async function startEditing(e) {
  e.stopPropagation()

  editingValue.value = sessionName.value
  isEditing.value = true

  await nextTick()
  // InputText may or may not expose focus()/select() directly depending on
  // version, so fall back to the underlying native input element.
  const el = inputRef.value?.$el ?? inputRef.value
  el?.focus()
  el?.select()
}

function saveEdit() {
  const name = editingValue.value.trim()

  if (!name) {
    cancelEdit()
    return
  }

  if (name !== sessionName.value) {
    sessionMetadataStore.setLastSaveName(name)
  }

  isEditing.value = false
}

function cancelEdit() {
  isEditing.value = false
}
</script>

<style>
:root {
  --view-header-height: 46px;
  --view-header-padding-x: 1rem;
  /* Where the canvas's floating controls sit: the panel toggles and the search box. Their offset below the view
     header, the toggles' offset in from the side, and the toggles' size, which the search box keeps clear of. */
  --canvas-control-top: 0.75rem;
  --canvas-control-side: 0.75rem;
  --canvas-toggle-size: 2.25rem;
}

.app-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
}

.global-nav {
  background-color: var(--p-surface-900);
  color: var(--p-surface-0);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  padding-bottom: 0.5rem;
  padding-top: 0.5rem;
  position: relative;
  /* Its height whatever the page below holds. */
  flex-shrink: 0;
}

.global-nav nav {
  display: flex;
  align-items: center;
}

.global-nav nav .nav-theme-toggle {
  margin-left: 20px;
}

.global-nav nav a {
  color: var(--p-surface-300);
  text-decoration: none;
  margin-left: 20px;
  font-size: 0.9rem;
  cursor: pointer;
}

.global-nav nav a.router-link-active,
.global-nav nav a.force-active {
  color: var(--p-primary-color);
  pointer-events: none;
  cursor: default;
}

/* An icon, not a page: it never takes the active colour. */
.global-nav nav a.report-issue-link {
  display: inline-flex;
  align-items: center;
  vertical-align: middle;
}

.global-nav nav a.report-issue-link svg {
  width: 1.05rem;
  height: 1.05rem;
}

.global-nav nav a.report-issue-link:hover {
  color: var(--p-primary-color);
}

/* An icon too, and a way to the notices from the About page itself. */
.global-nav nav a.notices-link {
  display: inline-flex;
  align-items: center;
  position: relative;
}

.global-nav nav a.notices-link .pi {
  font-size: 1.05rem;
}

.global-nav nav a.notices-link:hover {
  color: var(--p-primary-color);
}

.notices-badge {
  position: absolute;
  top: -0.5rem;
  right: -0.6rem;
  min-width: 1rem;
  padding: 0 0.2rem;
  border-radius: 999px;
  background-color: var(--p-red-500, #ef4444);
  color: #ffffff;
  font-size: 0.65rem;
  font-weight: 700;
  line-height: 1rem;
  text-align: center;
  box-sizing: border-box;
}

.view-container {
  flex-grow: 1;
  position: relative;
  overflow: hidden;
}

.brand {
  display: flex;
  align-items: center;
  width: 200px;
}

.centred-image {
  max-width: 40px;
  height: auto;
  padding-right: 10px;
}

.session-name {
  cursor: text;
  position: absolute;
  left: 50%;
  top: 50%;
  transform: translate(-50%, -50%);
  width: 240px;
  text-align: center;
}

.session-name:hover {
  color: var(--p-primary-color);
}

.session-name strong {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.session-name .p-inputtext {
  width: 100%;
  text-align: center;
  box-sizing: border-box;
}

.nowrap-tooltip {
  max-width: none;
}
</style>
