<template>
  <IconField class="search-field">
    <InputIcon class="pi pi-search" />
    <!-- Listeners such as @keydown and @input go to the input. -->
    <InputText
      ref="inputRef"
      v-model="model"
      v-bind="$attrs"
      class="w-full"
      :aria-label="label"
      @focus="isFocused = true"
      @blur="isFocused = false"
    />
    <div v-if="!model && !isFocused" class="search-placeholder">
      <span>Type</span>
      <kbd>{{ shortcut }}</kbd>
      <span>to search</span>
    </div>
    <InputIcon v-if="model" class="search-clear-input pi pi-times-circle" @click="emit('clear')" />
  </IconField>
</template>

<script setup>
/**
 * The search box the workspace and the docs share: a search icon, a hint naming the shortcut that focuses it while
 * it is empty, and a clear button once it has text. The unscoped styles below also style the result dropdowns the
 * views put beneath it.
 */
import { ref } from 'vue'
import IconField from 'primevue/iconfield'
import InputIcon from 'primevue/inputicon'
import InputText from 'primevue/inputtext'

defineOptions({ inheritAttrs: false })

defineProps({
  /** The key the hint names. */
  shortcut: { type: String, default: '/' },
  label: { type: String, default: 'Search' },
})

const emit = defineEmits(['clear'])
const model = defineModel({ type: String, default: '' })

const inputRef = ref(null)
const isFocused = ref(false)

/** Focuses the box and selects its text, so typing replaces the last query. */
function focus() {
  const input = inputRef.value?.$el
  input?.focus()
  input?.select()
}

function blur() {
  inputRef.value?.$el?.blur()
}

defineExpose({ focus, blur })
</script>

<style>
.search-field {
  position: relative;
}

.search-placeholder {
  position: absolute;
  left: 2.5rem;
  top: 50%;
  transform: translateY(-50%);
  display: flex;
  align-items: center;
  gap: 0.3rem;
  color: #8b949e;
  font-size: 0.875rem;
  pointer-events: none;
  white-space: nowrap;
}

.search-placeholder kbd {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 1.2rem;
  height: 1.25rem;
  padding: 0 0.25rem;
  border: 1px solid #d0d7de;
  border-radius: 4px;
  background: #f6f8fa;
  color: #57606a;
  font-family: inherit;
  font-size: 0.75rem;
  line-height: 1;
  box-shadow: 0 1px 0 rgba(27, 31, 36, 0.04);
}

.search-clear-input {
  cursor: pointer;
}

.search-clear-input:hover {
  color: var(--p-text-color);
}

/* The result dropdowns beneath the box. */
.search-match-count {
  font-size: 12px;
  color: var(--p-text-muted-color);
  padding-right: 8px;
}

.search-suffix-content {
  display: flex;
  flex-direction: column;
  background: var(--p-content-background);
  border-radius: 4px;
  box-shadow: 0 2px 8px color-mix(in srgb, var(--p-text-color) 15%, transparent);
  overflow: hidden;
}

.search-suffix-header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 4px;
  padding: 4px 8px;
}

.search-match-list {
  list-style: none;
  margin: 0;
  padding: 4px;
  max-height: 168px;
  overflow-y: auto;
  border-top: 1px solid var(--p-content-border-color, color-mix(in srgb, var(--p-text-color) 10%, transparent));
}

.search-match-item {
  padding: 8px 10px;
  border-radius: 4px;
  font-size: 13px;
  color: var(--p-text-color);
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.search-match-item:hover {
  background: color-mix(in srgb, var(--p-text-color) 6%, transparent);
}

.search-match-item.active {
  background: color-mix(in srgb, var(--p-primary-color) 15%, transparent);
  color: var(--p-primary-color);
  font-weight: 600;
}

.search-match-vars {
  display: block;
  font-size: 11px;
  font-weight: 400;
  color: var(--p-text-muted-color);
  overflow: hidden;
  text-overflow: ellipsis;
}

.search-empty {
  margin: 0;
  padding: 4px 2px;
  font-size: 12px;
  color: var(--p-text-muted-color);
}
</style>
