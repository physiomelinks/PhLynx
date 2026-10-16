<template>
  <div class="appearance-fields">
    <div class="field">
      <span class="field-label">Colour</span>
      <div class="colour-row">
        <ThemeColourButton
          :modelValue="shownColour"
          :autoColour="AUTOMATIC_EDGE_COLOUR"
          :palette="EDGE_COLOUR_PRESETS"
          title="Connection colour"
          @update:modelValue="onPreviewColour"
          @apply="onApplyColour"
          @cancel="onCancelColour"
        />
        <span class="field-note">{{ colourNote }}</span>
      </div>
    </div>

    <div v-for="field in SELECT_FIELDS" :key="field.key" class="field">
      <span :id="`${id}-${field.key}`" class="field-label">{{ field.label }}</span>
      <SelectButton
        :modelValue="mixed.includes(field.key) ? null : appearance[field.key]"
        :options="field.options"
        optionLabel="label"
        optionValue="value"
        :allowEmpty="false"
        size="small"
        :aria-labelledby="`${id}-${field.key}`"
        :data-testid="`appearance-${field.key}`"
        @update:modelValue="(value) => emit('change', { [field.key]: value })"
      />
    </div>
    <p v-if="mixed.length" class="field-note">Mixed values differ between the selected connections.</p>
  </div>
</template>

<script setup>
import { computed, ref, useId } from 'vue'
import SelectButton from 'primevue/selectbutton'

import ThemeColourButton from './ThemeColourButton.vue'

/** vue-flow's line colour, which an unset colour follows. */
const AUTOMATIC_EDGE_COLOUR = '#b1b1b7'
/** Line colours that read on both the light and the dark canvas. */
const EDGE_COLOUR_PRESETS = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899']

const SELECT_FIELDS = [
  {
    key: 'path',
    label: 'Path',
    options: [
      { label: 'Rounded', value: 'smoothstep' },
      { label: 'Step', value: 'step' },
      { label: 'Curved', value: 'bezier' },
      { label: 'Straight', value: 'straight' },
    ],
  },
  {
    key: 'arrow',
    label: 'Arrow',
    options: [
      { label: 'None', value: 'none' },
      { label: 'Small', value: 'small' },
      { label: 'Medium', value: 'medium' },
      { label: 'Large', value: 'large' },
    ],
  },
  {
    key: 'width',
    label: 'Width',
    options: [
      { label: 'Thin', value: 'thin' },
      { label: 'Normal', value: 'normal' },
      { label: 'Thick', value: 'thick' },
    ],
  },
]

const props = defineProps({
  /** A resolved appearance (see resolveEdgeAppearance); a null colour is automatic. */
  appearance: {
    type: Object,
    required: true,
  },
  /** Keys whose value differs between the connections shown. */
  mixed: {
    type: Array,
    default: () => [],
  },
})

// `change` carries a patch of appearance values; `preview` a colour shown before Apply, ended by `preview-end`.
const emit = defineEmits(['change', 'preview', 'preview-end'])

const id = useId()
const NO_DRAFT = Symbol('no draft')
const draftColour = ref(NO_DRAFT)

const shownColour = computed(() => {
  if (draftColour.value !== NO_DRAFT) return draftColour.value
  return props.mixed.includes('colour') ? undefined : (props.appearance.colour ?? undefined)
})

const colourNote = computed(() => {
  if (draftColour.value === NO_DRAFT && props.mixed.includes('colour')) return 'Mixed'
  return shownColour.value === undefined ? 'Automatic' : shownColour.value
})

/**
 * @param {string|undefined} value - The picked colour; undefined is automatic.
 */
function onPreviewColour(value) {
  draftColour.value = value
  emit('preview', value ?? null)
}

/**
 * @param {string|undefined} value
 */
function onApplyColour(value) {
  draftColour.value = NO_DRAFT
  emit('preview-end')
  emit('change', { colour: value ?? null })
}

function onCancelColour() {
  draftColour.value = NO_DRAFT
  emit('preview-end')
}
</script>

<style scoped>
.appearance-fields {
  display: flex;
  flex-direction: column;
  gap: 0.6rem;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.field-label {
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.colour-row {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.field-note {
  margin: 0;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.appearance-fields :deep(.p-selectbutton) {
  flex-wrap: wrap;
}
</style>
