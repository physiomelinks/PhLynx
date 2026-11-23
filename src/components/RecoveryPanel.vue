<script setup>
import Button from 'primevue/button'
import { onMounted, useTemplateRef } from 'vue'

/**
 * Offers back the unsaved work of tabs that closed without saving it. Shown on the empty canvas.
 *
 * Opens with the newest draft's Restore focused, unless something else already has the focus, so Enter restores it.
 * Escape, or the close button, hides the panel.
 */
defineProps({
  /** The drafts on offer, newest first: { id, savedAt, name, nodeCount }. */
  drafts: { type: Array, required: true },
  /** The id of the draft being restored, while one is. */
  restoring: { type: String, default: null },
})

const emit = defineEmits(['restore', 'discard', 'dismiss'])

const restoreButtons = useTemplateRef('restoreButtons')

onMounted(() => {
  const active = document.activeElement
  if (active && active !== document.body) return
  restoreButtons.value?.[0]?.$el?.focus?.()
})

const savedAt = (time) => new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
const modules = (count) => `${count} module${count === 1 ? '' : 's'}`
</script>

<template>
  <section
    class="recovery-panel"
    data-testid="recovery-panel"
    aria-labelledby="recovery-panel-title"
    @keydown.esc.stop="emit('dismiss')"
  >
    <div class="recovery-header">
      <h2 id="recovery-panel-title" class="recovery-title">
        <i class="pi pi-history" aria-hidden="true"></i>
        Unsaved work found
      </h2>
      <Button
        icon="pi pi-times"
        size="small"
        severity="secondary"
        text
        rounded
        :disabled="!!restoring"
        aria-label="Hide until the page is next loaded"
        v-hint.left="'Hide until the page is next loaded (Esc)'"
        data-testid="recovery-dismiss"
        @click="emit('dismiss')"
      />
    </div>
    <p class="recovery-note">
      {{ drafts.length === 1 ? 'A workspace was' : 'Workspaces were' }} closed without saving. Restoring one does not
      bring back its undo history.
    </p>
    <ul class="recovery-list">
      <li v-for="draft in drafts" :key="draft.id" class="recovery-draft" data-testid="recovery-draft">
        <div class="draft-text">
          <span class="draft-name">{{ draft.name || 'Untitled workspace' }}</span>
          <span class="draft-meta">{{ modules(draft.nodeCount) }} · {{ savedAt(draft.savedAt) }}</span>
        </div>
        <Button
          label="Discard"
          size="small"
          severity="secondary"
          text
          :disabled="!!restoring"
          data-testid="recovery-discard"
          @click="emit('discard', draft.id)"
        />
        <Button
          ref="restoreButtons"
          label="Restore"
          size="small"
          :loading="restoring === draft.id"
          :disabled="!!restoring"
          data-testid="recovery-restore"
          @click="emit('restore', draft.id)"
        />
      </li>
    </ul>
  </section>
</template>

<style scoped>
.recovery-panel {
  width: min(28rem, calc(100% - 32px));
  max-height: 70%;
  overflow-y: auto;
  padding: 1rem 1.25rem;
  background: var(--p-content-background);
  color: var(--p-text-color);
  border: 1px solid var(--p-content-border-color);
  border-radius: var(--p-content-border-radius, 6px);
  box-shadow: 0 4px 16px rgb(0 0 0 / 12%);
}

.recovery-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin: 0 0 0.25rem;
}

.recovery-title {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin: 0;
  font-size: 1.05rem;
  font-weight: 600;
}

.recovery-note {
  margin: 0 0 0.75rem;
  font-size: 0.875rem;
  color: var(--p-text-muted-color);
}

.recovery-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.recovery-draft {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0;
  border-top: 1px solid var(--p-content-border-color);
}

.draft-text {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.draft-name {
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.draft-meta {
  font-size: 0.8rem;
  color: var(--p-text-muted-color);
}
</style>
