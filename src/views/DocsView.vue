<template>
  <div class="docs-page relative-container" >
    <ThemeToggle floating />

    <aside :class="['left-sidebar', { collapsed: isCollapse }]">
      <div class="sidebar-header">
        <h2 v-show="!isCollapse" class="sidebar-title">User Guide</h2>
        <div class="sidebar-header-actions">
          <Button
            class="collapse-btn"
            :icon="isCollapse ? 'pi pi-angle-right' : 'pi pi-angle-left'"
            rounded
            text
            severity="secondary"
            @click="isCollapse = !isCollapse"
          />
        </div>
      </div>

      <div class="sidebar-menu">
        <div v-for="group in menuGroups" :key="group.title" class="menu-group">
          <div class="menu-group-title" @click="toggleGroup(group.title)">
            <span class="menu-group-label">
              <i :class="group.icon" />
              <span v-show="!isCollapse">{{ group.title }}</span>
            </span>
            <i
              v-show="!isCollapse"
              class="pi pi-angle-down menu-group-caret"
              :class="{ 'menu-group-caret--open': isGroupOpen(group.title) }"
            />
          </div>

          <div v-show="isGroupOpen(group.title) && !isCollapse" class="menu-group-items">
            <router-link
              v-for="item in group.items"
              :key="item.path"
              :to="item.path"
              class="menu-item"
              active-class="menu-item--active"
            >
              {{ item.label }}
            </router-link>
          </div>
        </div>
      </div>
    </aside>

    <main class="markdown-body">
      <component :is="currentPageComponent" v-if="currentPageComponent" />
      <div v-else>
        <h2>Documentation Page Not Found</h2>
        <p>Select a page from the sidebar.</p>
      </div>
    </main>

    <aside class="toc-sidebar">
      <div class="toc-container">
        <h3 class="toc-title">On This Page</h3>
        <nav class="toc-nav">
          <ul v-if="headings.length > 0">
            <li
              v-for="heading in headings"
              :key="heading.id"
              :class="['toc-item', `toc-level-${heading.level}`, { active: activeHeading === heading.id }]"
            >
              <a :href="`#${heading.id}`" @click.prevent="scrollToHeading(heading.id)">
                {{ heading.text }}
              </a>
            </li>
          </ul>
          <p v-else class="toc-empty">No headings found</p>
        </nav>
      </div>
    </aside>
  </div>
</template>

<script setup>
import { computed, ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import Button from 'primevue/button'
import ThemeToggle from '../components/ThemeToggle.vue'
import { useRoute, useRouter } from 'vue-router'
import { useColorScheme } from '../composables/useColorScheme'
import githubMarkdownLightCss from 'github-markdown-css/github-markdown-light.css?inline'
import githubMarkdownDarkCss from 'github-markdown-css/github-markdown-dark.css?inline'

const route = useRoute()
const router = useRouter()
const { isDarkMode } = useColorScheme()
const isCollapse = ref(false)
const openGroups = ref(['Getting Started', 'Guides', 'Reference', 'Help'])
const markdownFiles = import.meta.glob('@docs/**/*.md', { eager: true })
const docsMap = {}

const menuGroups = [
  {
    title: 'Getting Started',
    icon: 'pi pi-star-fill',
    items: [
      { label: 'Introduction', path: '/docs/getting-started/introduction' },
      { label: 'Quick Start Guide', path: '/docs/getting-started/quick-start-guide' },
    ],
  },
  {
    title: 'Guides',
    icon: 'pi pi-book',
    items: [
      { label: 'Building Macros', path: '/docs/guides/macro-build-guide' },
      { label: 'Creating Custom Modules', path: '/docs/guides/build-custom-module' },
      { label: 'Writing CellML', path: '/docs/guides/writing-cellml' },
      { label: 'Editing Circulatory Autogen Files', path: '/docs/guides/use-with-circulatory-autogen' },
      { label: 'Developer Guide', path: '/docs/guides/develop-phlynx' },
    ],
  },
  {
    title: 'Reference',
    icon: 'pi pi-list',
    items: [
      { label: 'Interface Overview', path: '/docs/reference/ui-overview' },
      { label: 'Keyboard Shortcuts', path: '/docs/reference/keyboard-shortcuts' },
      { label: 'Ghost Nodes', path: '/docs/reference/ghost-nodes' },
      { label: 'Port Logic', path: '/docs/reference/valid-port-configurations' },
      { label: 'Supported File Formats', path: '/docs/reference/file-types' },
      { label: 'Parameter Matching', path: '/docs/reference/parameter-matching' },
      { label: 'Glossary', path: '/docs/reference/glossary' },
      { label: 'Changelog', path: '/docs/reference/change-log' },
    ],
  },
  {
    title: 'Help',
    icon: 'pi pi-question-circle',
    items: [
      { label: 'FAQs & Troubleshooting', path: '/docs/support/faq-and-troubleshooting' },
      { label: 'Feedback & Support', path: '/docs/support/support' },
    ],
  },
]

function toggleGroup(title) {
  if (openGroups.value.includes(title)) {
    openGroups.value = openGroups.value.filter((item) => item !== title)
  } else {
    openGroups.value = [...openGroups.value, title]
  }
}

function isGroupOpen(title) {
  return openGroups.value.includes(title)
}

for (const path in markdownFiles) {
  const fileName = path.replace('.md', '')
  docsMap[fileName] = markdownFiles[path].default
}

const currentSlug = computed(() => {
  const slug = route.params.slug
  if (Array.isArray(slug)) {
    const joined = slug.join('/')
    return joined
  }
  return route.params.slug || 'getting-started/introduction'
})

const currentPageComponent = computed(() => {
  const slug = currentSlug.value

  return docsMap[`/docs/${slug}`]
})

const headings = ref([])
const activeHeading = ref('')

const extractHeadings = () => {
  const mainElement = document.querySelector('.markdown-body')
  if (!mainElement) return []

  const headingElements = mainElement.querySelectorAll('h1, h2, h3, h4, h5, h6')
  const extractedHeadings = []
  const usedIds = new Set()

  headingElements.forEach((heading, index) => {
    let id =
      heading.id ||
      heading.textContent
        .toLowerCase()
        .replace(/[^\w\s-]/g, '')
        .replace(/\s+/g, '-')

    let uniqueId = id
    let counter = 1
    while (usedIds.has(uniqueId)) {
      uniqueId = `${id}-${counter}`
      counter++
    }

    heading.id = uniqueId
    usedIds.add(uniqueId)

    if (!(index === 0 && heading.tagName === 'H1')) {
      extractedHeadings.push({
        id: uniqueId,
        text: heading.textContent,
        level: parseInt(heading.tagName.charAt(1)),
      })
    }
  })

  return extractedHeadings
}

const scrollToHeading = (id) => {
  const element = document.getElementById(id)

  if (element) {
    element.scrollIntoView({ behavior: 'smooth', block: 'start' })

    activeHeading.value = id

    element.classList.add('heading-highlight')
    setTimeout(() => {
      element.classList.remove('heading-highlight')
    }, 3000)
  }
}

const updateActiveHeading = () => {
  const mainElement = document.querySelector('.markdown-body')
  if (!mainElement) return

  const headingElements = Array.from(mainElement.querySelectorAll('h1, h2, h3, h4, h5, h6'))
  if (headingElements.length === 0) return

  const scrollTop = mainElement.scrollTop
  const scrollHeight = mainElement.scrollHeight
  const clientHeight = mainElement.clientHeight

  const isAtTop = scrollTop < 50

  if (isAtTop) {
    activeHeading.value = ''
    return
  }

  const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10

  if (isAtBottom) {
    activeHeading.value = headingElements[headingElements.length - 1].id
    return
  }

  const scrollPosition = scrollTop + 100

  for (let i = headingElements.length - 1; i >= 0; i--) {
    const heading = headingElements[i]
    if (heading.offsetTop <= scrollPosition) {
      activeHeading.value = heading.id
      return
    }
  }

  activeHeading.value = ''
}

// Injects whichever github-markdown-css variant matches the current theme
// into a dedicated <style> tag, since the package's own dark mode only
// follows the OS's prefers-color-scheme, not our manual toggle.
let markdownThemeStyleEl = null

function applyMarkdownTheme(dark) {
  if (typeof document === 'undefined') return

  if (!markdownThemeStyleEl) {
    markdownThemeStyleEl = document.createElement('style')
    markdownThemeStyleEl.setAttribute('data-docs-markdown-theme', '')
    document.head.appendChild(markdownThemeStyleEl)
  }

  markdownThemeStyleEl.textContent = dark ? githubMarkdownDarkCss : githubMarkdownLightCss
}

watch(isDarkMode, (dark) => {
  applyMarkdownTheme(dark)
})

let scrollElement = null

onMounted(() => {
  applyMarkdownTheme(isDarkMode.value)

  nextTick(() => {
    headings.value = extractHeadings()
    scrollElement = document.querySelector('.markdown-body')
    if (scrollElement) {
      scrollElement.addEventListener('scroll', updateActiveHeading)
      updateActiveHeading()
    }
    setupInternalLinks()
  })
})

const setupInternalLinks = () => {
  const mainElement = document.querySelector('.markdown-body')
  if (!mainElement) return

  mainElement.addEventListener('click', (e) => {
    const target = e.target.closest('a')
    if (!target) return

    const href = target.getAttribute('href')

    if (href && (href.startsWith('./') || href.startsWith('../') || href.startsWith('/docs/'))) {
      e.preventDefault()

      let fullPath = href
      if (href.startsWith('./')) {
        const currentPath = route.path.split('/').slice(0, -1).join('/')
        fullPath = `${currentPath}/${href.substring(2)}`
      } else if (href.startsWith('../')) {
        const currentPath = route.path.split('/').slice(0, -2).join('/')
        fullPath = `${currentPath}/${href.substring(3)}`
      }

      const [path, hash] = fullPath.split('#')
      const cleanPath = path.replace('.md', '')

      // Navigate using router
      router.push(hash ? `${cleanPath}#${hash}` : cleanPath).then(() => {
        if (hash) {
          nextTick(() => {
            scrollToHeading(hash)
          })
        } else {
          mainElement.scrollTop = 0
        }
      })
    }
  })
}

onUnmounted(() => {
  if (scrollElement) {
    scrollElement.removeEventListener('scroll', updateActiveHeading)
  }
  if (markdownThemeStyleEl) {
    markdownThemeStyleEl.remove()
    markdownThemeStyleEl = null
  }
})

watch(currentSlug, () => {
  nextTick(() => {
    headings.value = extractHeadings()
    if (scrollElement) {
      updateActiveHeading()
    }
  })
})
</script>

<style>
.docs-page {
  display: flex;
  height: 100%;
  overflow: hidden;
}

.left-sidebar {
  width: 250px;
  flex-shrink: 0;
  height: 100%;
  overflow-y: auto;
  border-right: 1px solid var(--p-content-border-color);
  transition: width 0.3s ease;
  background: var(--p-content-background);
}

.left-sidebar.collapsed {
  width: 64px;
}

.theme-toggle-switch {
  margin-right: 8px;
}

.sidebar-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid var(--p-content-border-color);
  min-height: 60px;
}

.sidebar-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}

.sidebar-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  white-space: nowrap;
}

.collapse-btn {
  flex-shrink: 0;
}

.sidebar-menu {
  padding: 8px 0;
}

.menu-group {
  border-bottom: 1px solid color-mix(in srgb, var(--p-text-color) 6%, transparent);
}

.menu-group-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  cursor: pointer;
  font-weight: 600;
  color: var(--p-text-color);
  font-size: 14px;
}

.menu-group-label {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.menu-group-caret {
  transition: transform 0.2s ease;
}

.menu-group-caret--open {
  transform: rotate(180deg);
}

.menu-group-items {
  display: flex;
  flex-direction: column;
  padding: 0 8px 8px;
}

.menu-item {
  padding: 8px 12px;
  border-radius: 6px;
  color: var(--p-text-muted-color);
  text-decoration: none;
  transition: background-color 0.2s ease, color 0.2s ease;
  font-size: 13px;
}

.menu-item:hover,
.menu-item--active {
  background-color: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
  color: var(--p-primary-color);
}

.left-sidebar.collapsed .sidebar-header {
  justify-content: center;
  padding: 16px 8px;
}

.left-sidebar.collapsed .menu-group-title,
.left-sidebar.collapsed .menu-group-items {
  display: none;
}

.markdown-body {
  flex: 1;
  min-width: 0;
  height: 100%;
  overflow-y: auto;
  padding: 20px 40px;
  box-sizing: border-box;
}

.heading-highlight {
  animation: highlightFade 2s ease-in;
  position: relative;
}

@keyframes highlightFade {
  0% {
    background-color: color-mix(in srgb, var(--p-primary-color) 25%, transparent);
    box-shadow: 0 0 0 8px color-mix(in srgb, var(--p-primary-color) 25%, transparent);
    border-radius: 4px;
  }
  100% {
    background-color: transparent;
    box-shadow: 0 0 0 8px transparent;
    border-radius: 4px;
  }
}

.toc-sidebar {
  width: 250px;
  flex-shrink: 0;
  height: 100%;
  overflow-y: auto;
  overflow-x: hidden;
  border-left: 1px solid var(--p-content-border-color);
  background-color: var(--p-surface-50);
  transition: width 0.3s ease;
}

.p-dark .toc-sidebar {
  background-color: var(--p-surface-950);
}

.toc-container {
  transition: visibility 0s 0s;
  visibility: visible;
  padding: 20px 16px;
  position: sticky;
  top: 0;
}

@media (max-width: 900px) {
  .toc-sidebar {
    width: 0;
    border-left: none;
    padding: 0;
  }

  .toc-container {
    visibility: hidden;
    transition: visibility 0s 0.2s;
  }
}

.toc-title {
  white-space: nowrap;
  overflow: hidden;
  font-size: 14px;
  font-weight: 600;
  margin: 0 0 12px 0;
  color: var(--p-text-color);
  padding-bottom: 8px;
  border-bottom: 1px solid var(--p-content-border-color);
}

.toc-nav ul {
  list-style: none;
  padding: 0;
  margin: 0;
}

.toc-item {
  margin: 4px 0;
}

.toc-item a {
  display: block;
  padding: 4px 8px;
  color: var(--p-text-muted-color);
  text-decoration: none;
  font-size: 13px;
  line-height: 1.4;
  border-radius: 4px;
  transition: all 0.2s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.toc-item a:hover {
  color: var(--p-primary-color);
  background-color: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
}

.toc-item.active a {
  color: var(--p-primary-color);
  font-weight: 500;
  background-color: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
}

.toc-level-1 {
  padding-left: 0;
}

.toc-level-2 {
  padding-left: 0;
}

.toc-level-3 {
  padding-left: 12px;
  font-size: 12px;
}

.toc-level-4 {
  padding-left: 24px;
  font-size: 12px;
}

.toc-level-5,
.toc-level-6 {
  padding-left: 36px;
  font-size: 11px;
}

.toc-empty {
  color: var(--p-text-muted-color);
  font-size: 12px;
  font-style: italic;
}

.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4,
.markdown-body h5,
.markdown-body h6 {
  scroll-margin-top: 20px;
}

.relative-container {
  position: relative;
}

</style>
