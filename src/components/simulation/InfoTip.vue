<template>
  <!-- The tooltip shows on hover only, so focusing the icon shows it too, for keyboard users. -->
  <button
    v-tooltip.top="text"
    type="button"
    class="info-tip"
    :aria-label="label ?? text"
    @focus="(event) => passAs(event, 'mouseenter')"
    @blur="(event) => passAs(event, 'mouseleave')"
  >
    <i class="pi pi-info-circle" aria-hidden="true"></i>
  </button>
</template>

<script setup>
/**
 * A small info icon whose tooltip says something worth knowing but not worth the room: on hover, or on keyboard focus.
 */
defineProps({
  // What the tooltip says.
  text: { type: String, required: true },
  // What a screen reader says, when not the text itself.
  label: { type: String, default: null },
})

/**
 * Passes a focus change on as the hover the tooltip listens for.
 *
 * @param {FocusEvent} event
 * @param {'mouseenter' | 'mouseleave'} type
 */
function passAs(event, type) {
  event.currentTarget.dispatchEvent(new MouseEvent(type))
}
</script>

<style scoped>
.info-tip {
  flex: none;
  display: inline-flex;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: none;
  font: inherit;
  color: var(--p-text-muted-color);
  cursor: help;
}

.info-tip .pi {
  font-size: 0.75rem;
}

.info-tip:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 2px;
}
</style>
