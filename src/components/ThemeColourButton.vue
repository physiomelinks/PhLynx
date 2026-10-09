<template>
  <button
    type="button"
    class="colour-chip"
    :class="{ 'colour-chip--auto': isAuto, 'colour-chip--open': isOpen }"
    :style="{ '--chip-fill': shownColour }"
    v-tooltip.top="isOpen ? null : `${title}: ${isAuto ? 'automatic' : shownColour}`"
    :aria-label="`${title}, ${isAuto ? 'automatic' : shownColour}`"
    aria-haspopup="dialog"
    :aria-expanded="isOpen"
    @click="toggle"
  >
    <span v-if="isAuto" class="colour-chip-badge">A</span>
  </button>

  <Popover ref="popover" @hide="onHide">
    <div class="colour-popover" role="dialog" :aria-label="title">
      <div class="popover-title">{{ title }}</div>

      <ColorPicker :key="pickerKey" :modelValue="pickerValue" inline format="hex" @update:modelValue="onPick" />

      <div class="hex-row">
        <InputText
          v-model="hexText"
          size="small"
          class="hex-input"
          :invalid="!isValidColour(hexText)"
          aria-label="Hex colour"
          @update:modelValue="onHexInput"
          @keydown.enter.prevent="apply"
        />
        <span
          class="sample"
          :style="{ background: shownColour, color: textColour }"
          v-tooltip.top="'Contrast with node text (WCAG AA needs 4.5:1)'"
        >
          Aa {{ ratio.toFixed(1) }}:1
          <i v-if="ratio < 4.5" class="pi pi-exclamation-triangle"></i>
        </span>
      </div>

      <div class="presets" role="group" aria-label="Preset colours">
        <button
          v-for="preset in presetColours"
          :key="preset"
          type="button"
          class="preset"
          :class="{ 'preset--active': preset === shownColour }"
          :style="{ background: preset }"
          :aria-label="preset"
          @click="setColour(preset)"
        ></button>
      </div>

      <div class="popover-actions">
        <Button
          v-if="autoColour"
          label="Automatic"
          size="small"
          text
          :disabled="isAuto"
          v-tooltip.top="'Derive from the light colour'"
          @click="emit('update:modelValue', undefined)"
        />
        <span class="spacer"></span>
        <Button label="Cancel" size="small" text @click="cancel" />
        <Button label="Apply" icon="pi pi-check" size="small" @click="apply" />
      </div>
    </div>
  </Popover>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import Button from 'primevue/button'
import ColorPicker from 'primevue/colorpicker'
import InputText from 'primevue/inputtext'
import Popover from 'primevue/popover'

import { contrastRatio, isValidColour, normaliseColour } from '../utils/nodeThemes'

/** Light fills that keep node text readable, offered alongside the theme's own colours. */
const PALETTE = ['#ffe7e1', '#ffe2ec', '#f3e8ff', '#e1edff', '#dbeafe', '#d1fff0', '#dcfce7', '#fef9c3', '#ffedd5', '#e5e7eb']

const props = defineProps({
  /** Hex colour; undefined means automatic when `autoColour` is given. */
  modelValue: {
    type: String,
    default: undefined,
  },
  /** The colour used when no value is set; enables the Automatic option. */
  autoColour: {
    type: String,
    default: undefined,
  },
  title: {
    type: String,
    default: 'Colour',
  },
  /** Node text colour this fill sits behind, for the contrast sample. */
  textColour: {
    type: String,
    required: true,
  },
  /** Other colours in the theme, offered as presets. */
  themeColours: {
    type: Array,
    default: () => [],
  },
})

// The value updates live so the canvas previews it; Apply keeps it, anything else puts the original back.
const emit = defineEmits(['update:modelValue'])

const popover = ref(null)
const isOpen = ref(false)
const hexText = ref('')
/** Bumped when the colour is set from outside the picker, so its handles move to the new colour. */
const pickerKey = ref(0)
let original
let applied = false

const isAuto = computed(() => props.modelValue === undefined && props.autoColour !== undefined)

const shownColour = computed(() => {
  const value = isAuto.value ? props.autoColour : props.modelValue
  return isValidColour(value) ? normaliseColour(value) : '#000000'
})

const pickerValue = computed(() => shownColour.value.slice(1))

const ratio = computed(() => contrastRatio(shownColour.value, props.textColour))

const presetColours = computed(() => [
  ...new Set([...props.themeColours.filter(isValidColour).map(normaliseColour), ...PALETTE]),
])

watch(shownColour, (value) => {
  if (!isValidColour(hexText.value) || normaliseColour(hexText.value) !== value) hexText.value = value
}, { immediate: true })

// ColorPicker skips the next outside update after a drag that left the hex unchanged, and keeps its
// own hue, so re-create it whenever anything other than the picker sets the colour.
let lastPicked

function setColour(value) {
  if (!isValidColour(value)) return
  lastPicked = undefined
  emit('update:modelValue', normaliseColour(value))
}
watch(
  () => props.modelValue,
  (value) => {
    if (value !== lastPicked) pickerKey.value++
  }
)

function onPick(value) {
  const text = String(value).startsWith('#') ? value : `#${value}`
  if (!isValidColour(text)) return
  lastPicked = normaliseColour(text)
  if (lastPicked !== props.modelValue) emit('update:modelValue', lastPicked)
}

function onHexInput(value) {
  const text = String(value ?? '').trim()
  setColour(text.startsWith('#') ? text : `#${text}`)
}

function toggle(event) {
  if (!isOpen.value) {
    original = props.modelValue
    applied = false
    isOpen.value = true
  } else if (!applied) {
    revert()
    isOpen.value = false
  }
  popover.value?.toggle(event)
}

function revert() {
  if (props.modelValue !== original) emit('update:modelValue', original)
}

/** Closing any other way (outside click, Escape) counts as Cancel. */
function onHide() {
  if (isOpen.value && !applied) revert()
  isOpen.value = false
}

function apply() {
  applied = true
  isOpen.value = false
  popover.value?.hide()
}

function cancel() {
  revert()
  isOpen.value = false
  popover.value?.hide()
}

defineExpose({ apply, cancel })
</script>

<style scoped>
.colour-chip {
  position: relative;
  width: 28px;
  height: 28px;
  padding: 0;
  flex-shrink: 0;
  border: 1px solid color-mix(in srgb, var(--p-text-color) 25%, transparent);
  border-radius: 6px;
  background: var(--chip-fill);
  cursor: pointer;
}

.colour-chip:hover,
.colour-chip--open {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 1px;
}

.colour-chip--auto {
  border-style: dashed;
}

.colour-chip-badge {
  position: absolute;
  right: 1px;
  bottom: 0;
  font-size: 0.6rem;
  font-weight: 700;
  color: var(--p-text-muted-color);
}

.colour-popover {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
  width: 200px;
}

.popover-title {
  font-size: 0.8rem;
  font-weight: 600;
}

.hex-row {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.hex-input {
  width: 6.5rem;
  font-family: monospace;
}

.sample {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.25rem;
  padding: 0.3rem 0.4rem;
  border-radius: 6px;
  border: 1px solid var(--p-content-border-color);
  font-size: 0.75rem;
  font-weight: 600;
  white-space: nowrap;
}

.presets {
  display: grid;
  grid-template-columns: repeat(8, 1fr);
  gap: 4px;
}

.preset {
  aspect-ratio: 1;
  padding: 0;
  border: 1px solid color-mix(in srgb, var(--p-text-color) 20%, transparent);
  border-radius: 4px;
  cursor: pointer;
}

.preset--active,
.preset:hover {
  outline: 2px solid var(--p-primary-color);
  outline-offset: 1px;
}

.popover-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.spacer {
  flex: 1;
}
</style>
