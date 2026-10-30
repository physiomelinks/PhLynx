<template>
  <SelectButton
    v-model="viewMode.mode"
    :options="VIEW_MODES"
    option-label="label"
    option-value="id"
    :allow-empty="false"
    size="small"
    class="view-mode-toggle"
    data-testid="view-mode"
  >
    <template #option="{ option }"><span :title="option.description">{{ option.label }}</span></template>
  </SelectButton>
</template>

<script setup>
import SelectButton from 'primevue/selectbutton'
import { useViewModeStore } from '../../stores/viewModeStore'

const VIEW_MODES = [
  { id: 'diagram', label: 'Diagram', description: 'Modules and their couplings' },
  { id: 'bio', label: 'Physiology', description: 'Cells, membranes and transporters, from the annotations' },
]

const viewMode = useViewModeStore()
</script>
