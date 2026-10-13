<template>
  <div
    class="resizable-library-panel"
    :class="{
      'resizable-library-panel--inline': !overlay,
      'resizable-library-panel--collapsed': isCollapsed,
    }"
    ref="panelRef"
  >
    <!-- Fades in once the panel has rolled up into it, and goes at once when it drops back down. -->
    <Transition name="library-toggle">
      <button
        v-if="isCollapsed"
        ref="expandToggleRef"
        type="button"
        class="library-expand-toggle"
        :aria-label="`Show ${subject}`"
        aria-expanded="false"
        @click="toggleCollapsed"
        v-tooltip.right="`Show ${subject}`"
      >
        <i class="pi pi-bars"></i>
      </button>
    </Transition>

    <Transition name="library-drop">
      <div v-show="!isCollapsed" class="library-panel-body">
        <aside :style="{ width: width + 'px' }" class="module-aside">
          <div class="module-aside-header">
            <h4 class="module-aside-title">{{ title }}</h4>
            <button
              ref="collapseToggleRef"
              type="button"
              class="library-collapse-toggle"
              :aria-label="`Hide ${subject}`"
              aria-expanded="true"
              @click="toggleCollapsed"
              v-tooltip.bottom="`Hide ${subject}`"
            >
              <i class="pi pi-chevron-left"></i>
            </button>
          </div>
          <div class="module-aside-content">
            <slot />
          </div>
        </aside>

        <div class="resize-handle" @mousedown="startResize"></div>
      </div>
    </Transition>
  </div>
</template>

<script setup>
import { computed, nextTick, ref, watch } from 'vue'
import { useResizableAside } from '../composables/useResizableAside'

const props = defineProps({
  title: {
    type: String,
    default: 'Available Modules',
  },
  // What the show/hide buttons name, as in "Hide module library".
  subject: {
    type: String,
    default: 'module library',
  },
  initialWidth: {
    type: Number,
    default: 300,
  },
  minWidth: {
    type: Number,
    default: 150,
  },
  maxWidth: {
    type: Number,
    default: 400,
  },
  overlay: {
    type: Boolean,
    default: true,
  },
})

const emit = defineEmits(['resize'])

const panelRef = ref(null)
const expandToggleRef = ref(null)
const collapseToggleRef = ref(null)

const { width, startResize } = useResizableAside(
  props.initialWidth,
  props.minWidth,
  props.maxWidth,
  'left',
  panelRef
)
const isCollapsed = ref(false)

const effectiveWidth = computed(() => (isCollapsed.value ? 0 : width.value))

watch(effectiveWidth, (val) => emit('resize', val), { immediate: true })

/** Shows or hides the library panel, moving focus to the toggle now shown. */
async function toggleCollapsed() {
  isCollapsed.value = !isCollapsed.value
  await nextTick()
  const target = isCollapsed.value ? expandToggleRef.value : collapseToggleRef.value
  target?.focus()
}

defineExpose({ isCollapsed, toggleCollapsed })
</script>

<style scoped>
.resizable-library-panel {
  display: flex;
  height: 100%;
}

.resizable-library-panel:not(.resizable-library-panel--inline) {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 20;
}

.resizable-library-panel--inline {
  position: relative;
  flex-shrink: 0;
}

/* Inline, the collapsed panel reserves only the hamburger's footprint. */
.resizable-library-panel--inline.resizable-library-panel--collapsed {
  min-width: 3.75rem;
}

.library-panel-body {
  display: flex;
  height: 100%;
}

.module-aside {
  display: flex;
  flex-direction: column;
  background-color: var(--p-content-background);
  border-right: 1px solid var(--p-content-border-color);
  padding: 1rem;
  box-sizing: border-box;
  overflow: hidden;
  box-shadow: 4px 0px color-mix(in srgb, var(--p-text-color) 15%, transparent);
}

.module-aside-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  margin: -0.25rem -0.25rem 0.75rem 0;
}

.module-aside-title {
  margin: 0;
  font-size: 1rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.module-aside-content {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.library-collapse-toggle,
.library-expand-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  padding: 0;
  cursor: pointer;
  transition:
    color 120ms ease,
    border-color 120ms ease,
    background-color 120ms ease;
}

.library-collapse-toggle {
  width: 1.75rem;
  height: 1.75rem;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: var(--p-text-muted-color);
}

.library-collapse-toggle:hover {
  color: var(--p-primary-color);
  border-color: var(--p-primary-color);
}

.library-expand-toggle {
  position: absolute;
  top: 0.75rem;
  left: 0.75rem;
  z-index: 1;
  width: 2.25rem;
  height: 2.25rem;
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  background: var(--p-content-background);
  color: var(--p-text-color);
  font-size: 1.1rem;
  box-shadow: 0 2px 6px color-mix(in srgb, var(--p-text-color) 20%, transparent);
}

/* Inline, centre the hamburger on the neighbouring toolbar row. */
.resizable-library-panel--inline .library-expand-toggle {
  top: 0.375rem;
}

.library-expand-toggle:hover {
  color: var(--p-primary-contrast-color, #ffffff);
  background: var(--p-primary-color);
  border-color: var(--p-primary-color);
}

.library-collapse-toggle:focus-visible,
.library-expand-toggle:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 2px;
}

.resize-handle {
  width: 6px;
  flex-shrink: 0;
  cursor: col-resize;
  background-color: var(--p-content-border-color);
  transition: background-color 120ms ease;
}

.resize-handle:hover {
  background-color: var(--p-primary-color);
}

/* Drop-down reveal anchored at the top-left, where the hamburger sits. */
.library-drop-enter-active {
  transition: clip-path 200ms ease-out;
}

.library-drop-leave-active {
  transition: clip-path 120ms ease-in;
}

/* Both ends are inset() shapes so clip-path interpolates; the negative right
   inset keeps the aside's box-shadow visible while animating. */
.library-drop-enter-to,
.library-drop-leave-from {
  clip-path: inset(0 -8px 0 0);
}

.library-drop-enter-from,
.library-drop-leave-to {
  clip-path: inset(0 -8px 100% 0);
}

/* The hamburger waits for the panel's 120ms roll-up before fading in. */
.library-toggle-enter-active {
  transition: opacity 150ms ease-out 120ms;
}

.library-toggle-enter-from {
  opacity: 0;
}

/* Gone at once, without waiting on the button's own colour transition. */
.library-toggle-leave-active {
  transition: none;
}

@media (prefers-reduced-motion: reduce) {
  .library-toggle-enter-active,
  .library-drop-enter-active,
  .library-drop-leave-active {
    transition: none;
  }
}
</style>
