<template>
  <div class="notices">
    <p v-if="!notices.length" class="notices-empty" data-testid="notices-empty">There are no notices at the moment.</p>
    <ul v-else class="notice-list">
      <li
        v-for="notice in notices"
        :key="notice.id"
        class="notice"
        :class="`notice-${notice.severity}`"
        data-testid="notice"
      >
        <div class="notice-header">
          <i :class="['pi', SEVERITY_ICONS[notice.severity]]" aria-hidden="true"></i>
          <h3 class="notice-title">{{ notice.title }}</h3>
          <Tag v-if="fresh.has(notice.id)" value="New" class="notice-new" data-testid="notice-new" />
        </div>
        <p v-if="notice.description" class="notice-description">{{ notice.description }}</p>
        <div v-if="notice.published !== null || notice.link" class="notice-footer">
          <time v-if="notice.published !== null" :datetime="new Date(notice.published).toISOString()">
            {{ formatDate(notice.published) }}
          </time>
          <a v-if="notice.link" :href="notice.link" target="_blank" rel="noopener noreferrer" class="notice-link">
            More information
          </a>
        </div>
      </li>
    </ul>
  </div>
</template>

<script setup>
import { reactive, watch } from 'vue'
import Tag from 'primevue/tag'

import { useNotices } from '../composables/useNotices'

const props = defineProps({
  /** Whether the panel is on show: its notices are marked read once it is. */
  active: { type: Boolean, default: false },
})

const SEVERITY_ICONS = {
  info: 'pi-info-circle',
  warning: 'pi-exclamation-triangle',
  critical: 'pi-exclamation-circle',
}

const { notices, unreadIds, markAllRead, refreshNotices } = useNotices()

/** The notices first seen on this visit: marked read at once, but still told apart until the page is left. */
const fresh = reactive(new Set())

const formatDate = (time) => new Date(time).toLocaleDateString(undefined, { dateStyle: 'medium' })

watch(
  () => props.active,
  (active) => {
    if (active) refreshNotices()
  },
  { immediate: true }
)

// Also on a change of notices, for those that arrive while the panel is open.
watch(
  [() => props.active, unreadIds],
  ([active, ids]) => {
    if (!active || !ids.length) return
    ids.forEach((id) => fresh.add(id))
    markAllRead()
  },
  { immediate: true }
)
</script>

<style scoped>
.notices-empty {
  text-align: center;
  color: var(--p-text-muted-color, #6b7280);
  padding: 30px 0;
}

.notice-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.notice {
  --notice-colour: var(--p-primary-color, #3b82f6);
  margin: 0;
  padding: 12px 16px;
  border: 1px solid var(--p-content-border-color, #e5e7eb);
  border-left: 4px solid var(--notice-colour);
  border-radius: 6px;
  background-color: var(--p-content-background, #ffffff);
}

.notice-warning {
  --notice-colour: var(--p-amber-500, #f59e0b);
}

.notice-critical {
  --notice-colour: var(--p-red-500, #ef4444);
}

.notice-header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.notice-header .pi {
  color: var(--notice-colour);
}

.notice-title {
  flex: 1;
  margin: 0;
  font-size: 1rem;
}

.notice-new {
  font-size: 0.7rem;
}

.notice-description {
  margin: 8px 0 0;
  /* The feed's text as written, line breaks and all - never as markup. */
  white-space: pre-line;
}

.notice-footer {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  margin-top: 8px;
  font-size: 0.85rem;
  color: var(--p-text-muted-color, #6b7280);
}

.notice-link {
  margin-left: auto;
  color: var(--p-primary-color, #3b82f6);
  text-decoration: none;
}

.notice-link:hover {
  text-decoration: underline;
}
</style>
