<template>
  <!-- Not a <button>: the SVG export leaves buttons out, and the name must be drawn. -->
  <span
    v-if="!isEditing"
    role="button"
    tabindex="0"
    class="bio-piece-name nodrag"
    :aria-label="`Rename ${name}`"
    data-testid="bio-piece-name"
    @click="onClick"
    @dblclick="cancelPending"
    @keydown.enter.prevent="startEditing"
    @keydown.space.prevent="startEditing"
    >{{ name }}</span
  >
  <!-- The field takes the size of what is typed, from a hidden copy of it, so the name stays where it was -->
  <span v-else class="bio-piece-name__edit nodrag nopan">
    <span class="bio-piece-name__mirror" aria-hidden="true">{{ draft || ' ' }}</span>
    <input
      ref="input"
      v-model="draft"
      class="bio-piece-name__input"
      :aria-label="`Name of ${name}`"
      size="1"
      data-testid="bio-piece-name-input"
      @click.stop
      @dblclick.stop
      @keydown.enter.prevent="commit"
      @keydown.esc.stop.prevent="cancel"
      @keydown.stop
      @blur="commit"
    />
  </span>
</template>

<script setup>
/**
 * The name of a cell or compartment of the physiology view, renamed as an instance is in the diagram: it shows it
 * can be edited under the pointer, and a click on it swaps it for a field holding it.
 */
import { inject, nextTick, onBeforeUnmount, ref } from 'vue'

const props = defineProps({
  /** The piece's node id in the view. */
  id: { type: String, default: null },
  name: { type: String, required: true },
})

/** The view's `(id, name) => void`, which names the piece: the piece itself, or the module on it. */
const rename = inject('bioRenamePiece', null)

// As the diagram's name: short enough to feel immediate, and dropped by a double-click, which opens the instance editor.
const RENAME_CLICK_DELAY_MS = 250

const isEditing = ref(false)
const draft = ref('')
const input = ref(null)
let pending = null

function cancelPending() {
  clearTimeout(pending)
  pending = null
}

/** Starts renaming a moment after a single click; a keyboard activation, which has no click count, at once. */
function onClick(event) {
  cancelPending()
  if (event.detail === 0) startEditing()
  else if (event.detail === 1) pending = setTimeout(startEditing, RENAME_CLICK_DELAY_MS)
}

/** Swaps the name for a field holding it, selected, with the cursor in it. */
async function startEditing() {
  pending = null
  if (!rename) return
  draft.value = props.name
  isEditing.value = true
  await nextTick()
  input.value?.focus()
  input.value?.select()
}

function commit() {
  if (!isEditing.value) return
  isEditing.value = false
  const name = draft.value.trim()
  if (name && name !== props.name) rename?.(props.id, name)
}

function cancel() {
  isEditing.value = false
}

onBeforeUnmount(cancelPending)
</script>

<style scoped>
.bio-piece-name {
  padding: 0 6px;
  margin: 0 -6px;
  border: 1px solid transparent;
  border-radius: 6px;
  cursor: text;
  pointer-events: auto;
}

.bio-piece-name:hover {
  border-color: var(--p-content-border-color);
  background: var(--p-content-background);
}

.bio-piece-name:focus-visible {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 1px;
}

.bio-piece-name__edit {
  display: inline-grid;
  margin: 0 -6px;
  pointer-events: auto;
}

/* One box over the other, each the name's own box: same padding, border and type */
.bio-piece-name__mirror,
.bio-piece-name__input {
  grid-area: 1 / 1;
  box-sizing: border-box;
  min-inline-size: 0;
  margin: 0;
  padding: 0 6px;
  border: 1px solid transparent;
  border-radius: 6px;
  font: inherit;
  letter-spacing: inherit;
  white-space: pre;
}

.bio-piece-name__mirror {
  visibility: hidden;
}

.bio-piece-name__input {
  inline-size: 100%;
  color: inherit;
  background: var(--p-content-background);
  border-color: var(--p-primary-color);
  outline: none;
}
</style>
