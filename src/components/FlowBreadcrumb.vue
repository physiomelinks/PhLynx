<template>
  <div v-if="!isAtRoot" class="flow-level">
    <nav class="flow-breadcrumb" aria-label="Canvas level">
      <ol class="crumb-list">
        <li class="crumb-item">
          <button type="button" class="crumb crumb--link" @click="exitTo(0)">
            <i class="pi pi-home" aria-hidden="true" /> Model
          </button>
        </li>
        <li v-for="(entry, index) in path" :key="`${index}:${entry.instanceId ?? entry.smId}`" class="crumb-item">
          <i class="pi pi-angle-right crumb-separator" aria-hidden="true" />
          <component
            :is="index < path.length - 1 ? 'button' : 'span'"
            :type="index < path.length - 1 ? 'button' : undefined"
            :class="['crumb', index < path.length - 1 ? 'crumb--link' : 'crumb--current']"
            :aria-current="index === path.length - 1 ? 'location' : undefined"
            :title="`${entry.name} — super-module '${entry.supermoduleName}' in the library`"
            @click="index < path.length - 1 && exitTo(index + 1)"
          >
            <i v-if="entry.instanceId === null" class="pi pi-pencil crumb-icon" aria-hidden="true" />
            <!-- On one line, so the name and its detail read with a space between. -->
            <span class="crumb-name">{{ entry.name }}</span> <span v-if="detailOf(entry)" class="crumb-detail">({{ detailOf(entry) }})</span>
          </component>
        </li>
      </ol>
    </nav>
    <div
      v-if="current"
      :class="['supermodule-banner', { 'supermodule-banner--shared': sharedCount > 1 }]"
      role="status"
    >
      <i :class="['pi', sharedCount > 1 ? 'pi-clone' : 'pi-book']" aria-hidden="true" />
      <span>Editing super-module '{{ current.supermoduleName }}' in the library — {{ impact }}</span>
      <Button
        v-if="sharedCount > 1 && current.instanceId !== null"
        label="Make unique"
        size="small"
        text
        class="banner-action"
        v-tooltip.bottom="{ value: `Give '${current.name}' its own copy of the super-module`, showDelay: 300 }"
        @click="makeUnique"
      />
    </div>
  </div>
</template>

<script setup>
/**
 * Where the canvas is: Model, then each super instance entered (or the super-module edited on its own), the last the one
 * shown, each titled with its super-module. Earlier entries go back there, and Escape goes up one level. A banner names the
 * library super-module being edited and how many super instances an edit changes; while that is more than one, and
 * the canvas came through a super instance, it offers to give that one its own copy.
 */
import { computed } from 'vue'
import Button from 'primevue/button'
import vTooltip from 'primevue/tooltip'

import { useActiveDocumentListeners } from '../composables/useActiveDocumentListeners'
import { useCanvasLevel } from '../composables/useCanvasLevel'
import { useHierarchyOperations } from '../composables/useHierarchyOperations'
import { shouldIgnoreShortcut } from '../composables/useWorkspaceClipboard'
import { notify } from '../utils/notify'

const props = defineProps({
  // While a dialog or another use of Escape is open, Escape leaves the level as it is.
  escapeDisabled: {
    type: Boolean,
    default: false,
  },
})

const { isAtRoot, path, exitTo, exitOne } = useCanvasLevel()

const current = computed(() => path.value.at(-1))
const sharedCount = computed(() => current.value?.occurrences ?? 0)
// What an edit to the super-module shown changes.
const impact = computed(() => {
  if (sharedCount.value > 1) return `changes apply to ${sharedCount.value} super instances`
  return sharedCount.value === 1 ? 'changes apply to its one super instance' : 'no super instance uses it yet'
})
const { makeUniqueSuperInstance } = useHierarchyOperations()

/** Gives the super instance shown its own copy of its super-module; the canvas then shows the copy. */
async function makeUnique() {
  const { problems } = await makeUniqueSuperInstance(current.value.instanceId)
  if (problems.length) notify.warning({ title: 'Not Made Unique', message: problems.join(' ') })
}

/**
 * Says what a crumb is a copy of: a super instance's super-module, where its name differs, and how many super instances that
 * has, when more than one; for the super-module edited on its own, that it is one. Its title always names the
 * super-module, as the banner does.
 *
 * @param {Object} entry - A path entry of useCanvasLevel.
 * @returns {string} Empty when there is nothing to add.
 */
function detailOf(entry) {
  if (entry.instanceId === null) return 'super-module'
  const parts = []
  if (entry.supermoduleLabel !== entry.name) parts.push(entry.supermoduleLabel)
  if (entry.count > 1) parts.push(`×${entry.count}`)
  return parts.join(' ')
}

/** Goes up one level on Escape, unless it is meant for a field, a dialog or a menu. */
function onKeydown(event) {
  if (event.key !== 'Escape' || event.defaultPrevented || isAtRoot.value) return
  if (shouldIgnoreShortcut(event, props.escapeDisabled)) return
  if (event.target?.closest?.('[role="dialog"], [role="alertdialog"]')) return
  // An open menu, such as the canvas's context menu, takes Escape to close.
  if (document.querySelector('[role="menu"]')) return
  exitOne()
}

useActiveDocumentListeners({ keydown: onKeydown })
</script>

<style scoped>
/* The canvas runs under the library panel, whose width the workbench sets. */
.flow-level {
  position: absolute;
  top: 16px;
  left: calc(var(--library-panel-width, 0px) + 16px);
  transition: left 160ms ease;
  z-index: 10;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 6px;
  max-width: calc(100% - var(--library-panel-width, 0px) - var(--workspace-search-width, 15.5rem) - 48px);
}

.flow-breadcrumb {
  max-width: 100%;
  padding: 4px 8px;
  border-radius: 6px;
  background: var(--p-content-background);
  box-shadow: 0 2px 8px color-mix(in srgb, var(--p-text-color) 15%, transparent);
  font-size: 13px;
}

.crumb-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.crumb-item {
  display: flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
}

.crumb {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  padding: 2px 4px;
  border: none;
  border-radius: 4px;
  background: none;
  color: var(--p-text-muted-color);
  font: inherit;
  white-space: nowrap;
}

.crumb--link {
  cursor: pointer;
}

.crumb--link:hover {
  color: var(--p-primary-color);
  background: color-mix(in srgb, var(--p-primary-color) 8%, transparent);
}

.crumb--link:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 1px;
}

.crumb--current {
  color: var(--p-text-color);
  font-weight: 600;
}

.crumb-name {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.crumb-detail {
  color: var(--p-text-muted-color);
  font-weight: 400;
}

.crumb-icon {
  font-size: 11px;
}

.crumb-separator {
  font-size: 10px;
  color: var(--p-text-muted-color);
}

.supermodule-banner {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  background: var(--p-content-background);
  color: var(--p-text-color);
  font-size: 12px;
}

/* An edit changes more than this super instance. */
.supermodule-banner--shared {
  border-color: color-mix(in srgb, var(--p-orange-500) 45%, transparent);
  background: color-mix(in srgb, var(--p-orange-500) 12%, var(--p-content-background));
}

.banner-action {
  padding: 0 6px;
  font-size: 12px;
}
</style>
