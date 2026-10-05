<template>
  <div class="h-screen overflow-y-auto">
    <ThemeToggle floating />
    <div class="about-wrapper">
      <transition name="fade-slide" appear>
        <div class="image-container" :class="{ 'is-compact': activeTab === 'changelog' }">
          <img src="/phlynxlogo.svg" alt="PhLynx Logo" class="centred-image" />
        </div>
      </transition>

      <transition name="fade-slide-delayed" appear>
        <div class="about-page">
          <Tabs v-model:value="activeTab" class="about-tabs">
            <TabList>
              <Tab value="overview">Overview</Tab>
              <Tab value="changelog">Release Notes</Tab>
            </TabList>

            <TabPanels>
              <TabPanel value="overview">
                <div class="tab-content">
                  <h1>About Physiome Links</h1>
                  <p class="intro-text">
                    <strong>Physiome Links (or PhLynx)</strong> is a specialised tool to streamline the coupling and
                    editing of models written in CellML.
                  </p>

                  <Divider />

                  <h3>The Workflow</h3>
                  <p>
                    <strong>PhLynx</strong> allows users to:
                  </p>
                  <ul>
                    <li>Visually connect independent CellML modules.</li>
                    <li>Construct cohesive system representations.</li>
                    <li>
                      Generate configuration files ready for parameter identification to calibrate to clinical data.
                    </li>
                  </ul>

                  <p>
                    For more information on the science and methodology behind the broader project, please visit the
                    <a href="https://www.cellml.org/" target="_blank" class="prime-link">
                      CellML website</a
                    >.
                  </p>

                  <Divider />

                  <h3>Credits & Support</h3>
                  <p>
                    <strong>Developed by: </strong>
                    <a href="https://github.com/jmdowrick" target="_blank" class="prime-link">Jarrah Dowrick</a>,
                    <a href="https://github.com/finbarargus" target="_blank" class="prime-link">Finbar Argus</a>, &
                    <a href="https://github.com/hsorby" target="_blank" class="prime-link">Hugh Sorby</a>
                  </p>
                  <p>
                    For reporting bugs or requesting features, please visit our
                    <a href="https://github.com/physiomelinks/phlynx" target="_blank" class="prime-link">
                      GitHub Repository
                    </a>.
                  </p>

                  <Divider />

                  <h3>License</h3>
                  <p>This project is licensed under the Apache License, Version 2.0.</p>
                </div>
              </TabPanel>

              <TabPanel value="changelog">
                <div class="tab-content">
                  <ChangelogViewer />
                </div>
              </TabPanel>
            </TabPanels>
          </Tabs>

          <div class="build-info-footer">
            <div class="version-badge" data-testid="build-version">v{{ appVersion }}</div>

            <div class="info-row">
              <span
                >Branch: <strong>{{ branch }}</strong></span
              >
              <span class="divider">•</span>
              <span>
                Commit:
                <a :href="commitUrl" target="_blank" rel="noopener" class="commit-link">
                  {{ commitHash }}
                </a>
              </span>
            </div>

            <div class="info-row timestamp">Built: {{ formattedDate }}</div>
          </div>
        </div>
      </transition>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue'
import ChangelogViewer from '../components/ChangeLogViewer.vue'

import Tabs from 'primevue/tabs'
import TabList from 'primevue/tablist'
import Tab from 'primevue/tab'
import TabPanels from 'primevue/tabpanels'
import TabPanel from 'primevue/tabpanel'
import Divider from 'primevue/divider'

import ThemeToggle from '../components/ThemeToggle.vue'

const activeTab = ref('overview')

const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ + __BUILD_STATE_MARKER__ : 'Dev'
const commitHash = typeof __COMMIT_HASH__ !== 'undefined' ? __COMMIT_HASH__ : 'N/A'
const branch = typeof __BRANCH__ !== 'undefined' ? __BRANCH__ : 'N/A'
const buildDate = typeof __BUILD_DATE__ !== 'undefined' ? __BUILD_DATE__ : new Date().toISOString()

const formattedDate = computed(() => {
  if (buildDate === 'N/A') return 'Unknown'
  return new Date(buildDate).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
})

const commitUrl = computed(() => `https://github.com/physiomelinks/phlynx/commit/${commitHash}`)
</script>

<style scoped>
/* --- Transitions --- */
.fade-slide-enter-from {
  transform: translateY(-8px);
}
.fade-slide-delayed-enter-from {
  opacity: 0;
  transform: translateY(-12px);
}
.fade-slide-enter-to,
.fade-slide-delayed-enter-to {
  opacity: 1;
  transform: translateY(0);
}
.fade-slide-enter-active {
  transition: opacity 0.45s cubic-bezier(0.25, 0.8, 0.25, 1), transform 0.45s cubic-bezier(0.25, 0.8, 0.25, 1);
}
.fade-slide-delayed-enter-active {
  transition: opacity 0.8s cubic-bezier(0.25, 0.8, 0.25, 1), transform 0.8s cubic-bezier(0.25, 0.8, 0.25, 1);
  transition-delay: 0.15s;
}

/* --- Layout --- */
.image-container {
  margin-top: 50px;
  display: flex;
  justify-content: center;
  align-items: center;
  transition: margin-top 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.centred-image {
  max-width: 250px;
  height: auto;
  transition: max-width 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
}

.image-container.is-compact {
  margin-top: 25px; 
}

.image-container.is-compact .centred-image {
  max-width: 120px; 
}

.centred-image {
  max-width: 250px;
  height: auto;
}

.about-page {
  max-width: 800px;
  margin: 0 auto;
  padding: 0 20px 40px 20px;
  line-height: 1.6;
}

/* --- Content Styling --- */
.intro-text {
  font-size: 1.1rem;
  color: var(--p-text-muted-color, var(--text-color-secondary, #6b7280));
}

.prime-link {
  font-size: 1rem;
  color: var(--p-primary-color, var(--primary-color, #3b82f6));
  text-decoration: none;
  transition: color 0.2s;
}

.prime-link:hover {
  text-decoration: underline;
}

h1 {
  margin-bottom: 20px;
  text-align: center;
}
h3 {
  margin-top: 30px;
  margin-bottom: 10px;
}
ul {
  margin-bottom: 20px;
  padding-left: 20px;
}
li {
  margin-bottom: 8px;
}

.build-info-footer {
  margin-top: 60px;
  padding-top: 20px;
  border-top: 1px solid var(--p-content-border-color, var(--surface-border, #e5e7eb));
  text-align: center;
  font-family: 'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace;
  font-size: 0.8rem;
  color: var(--p-text-muted-color, var(--text-color-secondary, #6b7280));
}

.version-badge {
  display: inline-block;
  background-color: color-mix(in srgb, var(--p-primary-color, var(--primary-color, #3b82f6)) 12%, transparent);
  color: var(--p-primary-color, var(--primary-color, #3b82f6));
  padding: 2px 8px;
  border-radius: 12px;
  font-weight: bold;
  margin-bottom: 10px;
}

.info-row {
  margin-bottom: 4px;
}

.divider {
  margin: 0 8px;
  color: var(--p-content-border-color, var(--surface-border, #e5e7eb));
}

.commit-link {
  color: var(--p-text-muted-color, var(--text-color-secondary, #6b7280));
  text-decoration: underline;
  transition: color 0.2s;
}

.commit-link:hover {
  color: var(--p-primary-color, var(--primary-color, #3b82f6));
}

/* --- Tab Adjustments --- */
.about-tabs {
  margin-top: 20px;
}

:deep(.p-tablist-tab-list) {
  width: 100%;
}
:deep(.p-tab) {
  flex: 1;
  justify-content: center;
}

.tab-content {
  padding: 10px 0;
}

.relative-container {
  position: relative;
}

</style>
