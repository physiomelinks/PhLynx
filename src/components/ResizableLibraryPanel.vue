<template>
  <div
    class="resizable-library-panel"
    :class="{
      'resizable-library-panel--inline': !overlay,
      'resizable-library-panel--collapsed': isCollapsed,
      'resizable-library-panel--right': side === 'right',
    }"
    ref="panelRef"
  >
    <!-- One toggle for both directions, fixed where the hamburger sits. Its three
         bars morph into a tapering tornado while the panel is open. The tooltip's
         side is a directive modifier, so each side gets its own copy. -->
    <button
      v-if="side === 'right'"
      v-bind="toggleAttrs"
      @click="toggleCollapsed"
      v-tooltip.left="toggleLabel"
    >
      <svg class="library-toggle-icon" viewBox="0 0 24 24" aria-hidden="true">
        <line v-for="line in toggleLines" :key="line.y" v-bind="line" pathLength="100" />
      </svg>
    </button>
    <button v-else v-bind="toggleAttrs" @click="toggleCollapsed" v-tooltip.right="toggleLabel">
      <svg class="library-toggle-icon" viewBox="0 0 24 24" aria-hidden="true">
        <line v-for="line in toggleLines" :key="line.y" v-bind="line" pathLength="100" />
      </svg>
    </button>

    <Transition name="library-drop">
      <div v-show="!isCollapsed" class="library-panel-body">
        <aside :style="{ width: width + 'px' }" class="module-aside">
          <div class="module-aside-header">
            <!-- Detail such as a count or the selected item's name follows the title, muted. -->
            <h4 class="module-aside-title">
              <!-- Kept on one line so a space separates title and detail when read aloud. -->
              <span class="module-aside-title-text">{{ title }}</span> <span v-if="$slots['title-detail']" class="module-aside-title-detail"><slot name="title-detail" /></span>
            </h4>
            <div v-if="$slots['header-actions']" class="module-aside-header-actions">
              <slot name="header-actions" />
            </div>
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
import { computed, ref, watch } from 'vue'
import { useResizableAside } from '../composables/useResizableAside'
import { PANEL_RESIZE_HANDLE_WIDTH } from '../utils/constants'

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
  // Which edge the panel docks to; the toggle and resize handle mirror to match.
  side: {
    type: String,
    default: 'left',
    validator: (value) => ['left', 'right'].includes(value),
  },
})

const emit = defineEmits(['resize'])

const panelRef = ref(null)

const { width, startResize } = useResizableAside(
  props.initialWidth,
  props.minWidth,
  props.maxWidth,
  props.side,
  panelRef
)
// Parents may bind v-model:collapsed to open or close the panel themselves.
const isCollapsed = defineModel('collapsed', { type: Boolean, default: false })

const toggleLabel = computed(() => `${isCollapsed.value ? 'Show' : 'Hide'} ${props.subject}`)

const toggleAttrs = computed(() => ({
  type: 'button',
  class: ['library-toggle', { 'library-toggle--open': !isCollapsed.value }],
  'aria-label': toggleLabel.value,
  'aria-expanded': String(!isCollapsed.value),
}))

/** The three bars, drawn from the panel's outer edge so the tornado tapers toward the canvas. */
const toggleLines = computed(() => {
  const [x1, x2] = props.side === 'right' ? [20, 4] : [4, 20]
  return [7, 12, 17].map((y, i) => ({
    class: `library-toggle-line library-toggle-line--${i + 1}`,
    x1,
    y1: y,
    x2,
    y2: y,
  }))
})

/** The open panel's width: none while it is closed, when at most its hamburger's strip shows. */
const effectiveWidth = computed(() => (isCollapsed.value ? 0 : width.value))

watch(effectiveWidth, (val) => emit('resize', val), { immediate: true })

/** Shows or hides the library panel; the one toggle keeps focus throughout. */
function toggleCollapsed() {
  isCollapsed.value = !isCollapsed.value
}

defineExpose({ isCollapsed, toggleCollapsed })
</script>

<style scoped>
.resizable-library-panel {
  /* Where the toggle sits; the panel header lines its title up beside it. */
  --library-toggle-top: var(--canvas-control-top);
  --library-toggle-left: var(--canvas-control-side);
  --library-toggle-size: var(--canvas-toggle-size);
  display: flex;
  height: 100%;
}

.resizable-library-panel:not(.resizable-library-panel--inline) {
  position: absolute;
  top: 0;
  left: 0;
  z-index: 20;
}

.resizable-library-panel--right:not(.resizable-library-panel--inline) {
  left: auto;
  right: 0;
}

.resizable-library-panel--inline {
  --library-toggle-top: 0.375rem;
  position: relative;
  flex-shrink: 0;
}

/* Inline, the collapsed panel reserves only the toggle's footprint: the toggle with its offset either side. */
.resizable-library-panel--inline.resizable-library-panel--collapsed {
  min-width: calc(2 * var(--library-toggle-left) + var(--library-toggle-size));
}

.library-panel-body {
  display: flex;
  height: 100%;
}

/* Docked right: the handle sits on the canvas side, before the aside. */
.resizable-library-panel--right .library-panel-body {
  flex-direction: row-reverse;
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

/* Spans the toggle's row, with the title starting just past it. */
.module-aside-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-height: var(--library-toggle-size);
  margin: calc(var(--library-toggle-top) - 1rem) 0 0.75rem
    calc(var(--library-toggle-left) + var(--library-toggle-size) - 0.5rem);
}

.resizable-library-panel--right .module-aside {
  border-right: none;
  border-left: 1px solid var(--p-content-border-color);
  box-shadow: -4px 0px color-mix(in srgb, var(--p-text-color) 15%, transparent);
}

.resizable-library-panel--right .module-aside-header {
  margin-left: 0;
  margin-right: calc(var(--library-toggle-left) + var(--library-toggle-size) - 0.5rem);
}

.module-aside-title {
  display: flex;
  align-items: baseline;
  gap: 0.35rem;
  flex: 1 1 auto;
  min-width: 0;
  margin: 0;
  font-size: 1rem;
  white-space: nowrap;
}

.module-aside-title-text {
  flex-shrink: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

/* The detail gives way first when the panel is narrow. */
.module-aside-title-detail {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  font-size: 0.8rem;
  font-weight: 400;
  color: var(--p-text-muted-color);
}

.module-aside-header-actions {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  flex-shrink: 0;
}

.module-aside-content {
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

.library-toggle {
  position: absolute;
  top: var(--library-toggle-top);
  left: var(--library-toggle-left);
  z-index: 2;
  display: flex;
  align-items: center;
  justify-content: center;
  width: var(--library-toggle-size);
  height: var(--library-toggle-size);
  padding: 0;
  border: 1px solid var(--p-content-border-color);
  border-radius: 6px;
  background: var(--p-content-background);
  color: var(--p-text-color);
  box-shadow: 0 2px 6px color-mix(in srgb, var(--p-text-color) 20%, transparent);
  cursor: pointer;
  transition:
    color 120ms ease,
    border-color 120ms ease,
    background-color 120ms ease,
    box-shadow 200ms ease;
}

.resizable-library-panel--right .library-toggle {
  left: auto;
  right: var(--library-toggle-left);
}

/* Open, it sits in the panel header, so it drops its floating frame. */
.library-toggle--open {
  border-color: transparent;
  box-shadow: none;
  color: var(--p-text-muted-color);
}

.library-toggle:hover {
  color: var(--p-primary-contrast-color, #ffffff);
  background: var(--p-primary-color);
  border-color: var(--p-primary-color);
}

.library-toggle--open:hover {
  color: var(--p-primary-color);
  background: color-mix(in srgb, var(--p-primary-color) 12%, transparent);
  border-color: transparent;
}

.library-toggle:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 2px;
}

.library-toggle-icon {
  width: 1.25rem;
  height: 1.25rem;
  overflow: visible;
}

/* Each line is drawn as one dash along a 0–100 path, so the dash's length and
   offset can shorten and shift it while the round caps stay round. */
.library-toggle-line {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-dasharray: 100 200;
  stroke-dashoffset: 0;
  transform-box: view-box;
  transform: translateX(0);
  transition:
    stroke-dasharray 260ms cubic-bezier(0.5, 0, 0.2, 1),
    stroke-dashoffset 260ms cubic-bezier(0.5, 0, 0.2, 1),
    transform 260ms cubic-bezier(0.5, 0, 0.2, 1);
}

.library-toggle-line--2 {
  transition-delay: 40ms;
}

.library-toggle-line--3 {
  transition-delay: 80ms;
}

/* Tornado: each line shorter than the one above, drifting away from the panel's
   outer edge (bars 16 units long, so 100 path units = 16). */
.library-toggle--open .library-toggle-line--1 {
  stroke-dasharray: 100 200;
  transform: translateX(-1px);
}

.library-toggle--open .library-toggle-line--2 {
  stroke-dasharray: 62 200;
  stroke-dashoffset: -22;
  transform: translateX(0.5px);
}

.library-toggle--open .library-toggle-line--3 {
  stroke-dasharray: 25 200;
  stroke-dashoffset: -50;
  transform: translateX(1.5px);
}

.resize-handle {
  width: v-bind('PANEL_RESIZE_HANDLE_WIDTH + "px"');
  flex-shrink: 0;
  /* Positioned so it paints over the aside's edge shadow, which reaches across it. */
  position: relative;
  cursor: col-resize;
  background-color: var(--p-content-border-color);
  transition: background-color 120ms ease;
}

.resize-handle:hover {
  background-color: var(--p-primary-color);
}

/* Mirrored drift for the right-docked tornado. */
.resizable-library-panel--right .library-toggle--open .library-toggle-line--1 {
  transform: translateX(1px);
}

.resizable-library-panel--right .library-toggle--open .library-toggle-line--2 {
  transform: translateX(-0.5px);
}

.resizable-library-panel--right .library-toggle--open .library-toggle-line--3 {
  transform: translateX(-1.5px);
}

/* Drop-down reveal anchored at the top corner where the toggle sits. */
.library-drop-enter-active {
  transition: clip-path 200ms ease-out;
}

.library-drop-leave-active {
  transition: clip-path 120ms ease-in;
}

/* Both ends are inset() shapes so clip-path interpolates; the negative side
   insets keep the aside's box-shadow visible while animating. */
.library-drop-enter-to,
.library-drop-leave-from {
  clip-path: inset(0 -8px 0 -8px);
}

.library-drop-enter-from,
.library-drop-leave-to {
  clip-path: inset(0 -8px 100% -8px);
}

@media (prefers-reduced-motion: reduce) {
  .library-drop-enter-active,
  .library-drop-leave-active,
  .library-toggle-line {
    transition: none;
  }
}
</style>
