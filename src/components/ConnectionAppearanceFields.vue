<template>
  <div class="appearance-fields">
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
import { useId } from 'vue'
import SelectButton from 'primevue/selectbutton'

const SELECT_FIELDS = [
  {
    key: 'path',
    label: 'Corners',
    options: [
      { label: 'Rounded', value: 'smoothstep' },
      { label: 'Square', value: 'step' },
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

defineProps({
  /** A resolved appearance (see resolveEdgeAppearance). */
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

// `change` carries a patch of appearance values.
const emit = defineEmits(['change'])

const id = useId()
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

.field-note {
  margin: 0;
  font-size: 0.75rem;
  color: var(--p-text-muted-color);
}

.appearance-fields :deep(.p-selectbutton) {
  flex-wrap: wrap;
}
</style>
