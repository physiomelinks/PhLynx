<template>
  <ConfirmDialog group="app-confirm">
    <template #container="{ message, acceptCallback, rejectCallback, closeCallback }">
      <div class="confirm-container">
        <div class="confirm-body">
          <i :class="['confirm-icon', getIcon(message.severity)]" :style="{ color: getIconColor(message.severity) }" />

          <div class="confirm-text">
            <div class="confirm-header">
              {{ message.header }}
            </div>

            <div class="confirm-message">
              {{ message.message }}
            </div>

            <!-- Issues that name an element link to it: following one closes the dialog first. -->
            <ul v-if="message.issues?.length" class="confirm-issues">
              <li v-for="issue in message.issues" :key="issue.key">
                <button
                  v-if="issue.elementId && message.onIssue"
                  type="button"
                  class="confirm-issue-link"
                  :data-element-id="issue.elementId"
                  :title="`Show ${issue.label} in the diagram`"
                  @click="
                    () => {
                      message.onIssue(issue)
                      closeCallback()
                    }
                  "
                >
                  {{ issue.label }}
                </button>
                <span v-else-if="issue.label" class="confirm-issue-label">{{ issue.label }}</span>
                {{ issue.message }}
              </li>
            </ul>
          </div>
        </div>

        <div class="confirm-actions">
          <!-- With isRejectDefault, rejecting is the primary, focused action, and accepting the secondary one. -->
          <Button
            v-if="message.rejectLabel"
            :label="message.rejectLabel"
            :severity="message.isRejectDefault ? undefined : 'secondary'"
            :outlined="!message.isRejectDefault"
            :autofocus="!!message.isRejectDefault"
            @click="rejectCallback"
          />

          <!-- A third action (choose), resolved before the dialog closes, so closing doesn't reject it. It's the
               primary, focused action, so Enter takes it and never the accept action beside it. -->
          <Button
            v-if="message.extraLabel"
            :label="message.extraLabel"
            autofocus
            @click="
              () => {
                message.extra?.()
                closeCallback()
              }
            "
          />

          <Button
            :label="message.acceptLabel || 'OK'"
            :severity="getButtonSeverity(message.severity)"
            :outlined="!!message.isRejectDefault || !!message.extraLabel"
            @click="acceptCallback"
          />
        </div>
      </div>
    </template>
  </ConfirmDialog>
</template>

<script setup lang="ts">
import ConfirmDialog from 'primevue/confirmdialog'
import Button from 'primevue/button'

function getIcon(severity?: string) {
  switch (severity) {
    case 'error':
      return 'pi pi-times-circle'

    case 'warning':
      return 'pi pi-exclamation-triangle'

    case 'success':
      return 'pi pi-check-circle'

    default:
      return 'pi pi-info-circle'
  }
}

// Reads from PrimeVue's own theme tokens (with sensible fallbacks) rather than
// hardcoded Tailwind palette classes, so these track whatever preset/colors
// the app is actually themed with, and update automatically with PrimeVue's
// dark-mode class toggle instead of depending on Tailwind's separate dark:
// variant config staying in sync with it.
function getIconColor(severity?: string) {
  switch (severity) {
    case 'error':
      return 'var(--p-red-500, #ef4444)'

    case 'warning':
      return 'var(--p-orange-500, #f97316)'

    case 'success':
      return 'var(--p-green-500, #22c55e)'

    default:
      return 'var(--p-blue-500, #3b82f6)'
  }
}

function getButtonSeverity(severity?: string) {
  switch (severity) {
    case 'error':
      return 'danger'

    case 'warning':
      return 'warning'

    case 'success':
      return 'success'

    default:
      return 'primary'
  }
}
</script>

<style scoped>
.confirm-container {
  width: min(92vw, 420px);
  border-radius: 8px;
  padding: 24px;
  border: 1px solid var(--p-content-border-color, #e5e7eb);
  background: var(--p-content-background, #ffffff);
  box-shadow: var(--p-overlay-modal-shadow, 0 4px 24px rgba(0, 0, 0, 0.15));
}

.confirm-body {
  display: flex;
  align-items: flex-start;
  gap: 12px;
}

.confirm-icon {
  font-size: 1.5rem;
  line-height: 1;
}

.confirm-text {
  min-width: 0;
  flex: 1;
}

.confirm-header {
  font-size: 1.125rem;
  font-weight: 600;
  color: var(--p-text-color, #18181b);
}

.confirm-message {
  margin-top: 8px;
  font-size: 0.875rem;
  white-space: pre-wrap;
  color: var(--p-text-muted-color, #52525b);
}

.confirm-issues {
  max-height: 14rem;
  margin: 8px 0 0;
  padding-left: 18px;
  overflow-y: auto;
  font-size: 0.875rem;
  overflow-wrap: anywhere;
  color: var(--p-text-muted-color, #52525b);
}

.confirm-issues li + li {
  margin-top: 4px;
}

.confirm-issue-link,
.confirm-issue-label {
  margin-right: 6px;
  font-weight: 600;
}

.confirm-issue-link {
  padding: 0;
  border: none;
  border-radius: 2px;
  background: none;
  font: inherit;
  font-weight: 600;
  color: var(--p-primary-color);
  cursor: pointer;
}

.confirm-issue-link:hover {
  text-decoration: underline;
}

.confirm-issue-link:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 2px;
}

.confirm-actions {
  margin-top: 24px;
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
