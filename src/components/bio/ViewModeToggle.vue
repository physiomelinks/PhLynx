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
    <template #option="{ option }">
      <span :title="option.description">{{ option.label }}</span>
      <Tag
        v-if="option.beta"
        value="Beta"
        severity="info"
        class="view-mode-beta"
        data-testid="view-mode-beta"
        :title="BETA_NOTE"
        :aria-label="BETA_NOTE"
      />
    </template>
  </SelectButton>
</template>

<script setup>
import SelectButton from 'primevue/selectbutton'
import Tag from 'primevue/tag'
import { useViewModeStore } from '../../stores/viewModeStore'

const BETA_NOTE = 'Physiology view is in beta — behaviour may change.'

const VIEW_MODES = [
  { id: 'diagram', label: 'Diagram', description: 'Modules and their couplings' },
  {
    id: 'bio',
    label: 'Physiology',
    description: 'Cells, membranes and transporters, from annotations or templates',
    beta: true,
  },
]

const viewMode = useViewModeStore()
</script>

<style scoped>
.view-mode-beta {
  margin-left: 0.35rem;
  padding: 0 0.3rem;
  font-size: 0.65rem;
  line-height: 1.2;
  text-transform: uppercase;
  letter-spacing: 0.03em;
}
</style>
