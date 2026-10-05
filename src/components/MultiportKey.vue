<template>
  <!-- What a port variable chip's colour means -->
  <span class="multiport-key">
    <span v-for="entry in KEY" :key="entry.label" class="multiport-key__item" :title="entry.title">
      <MultiportChip :port="entry.port" name="v" />
      {{ entry.label }}
    </span>
  </span>
</template>

<script setup>
import MultiportChip from './MultiportChip.vue'

const KEY = [
  { label: 'One connection', title: 'The port takes one connection', port: { variables: ['v'], multiportType: 'None' } },
  { label: 'Shared', title: 'Linked to every connected module', port: { variables: ['v'], multiportType: 'True' } },
  { label: 'Summed', title: "The sum of every connected module's variable", port: { variables: ['v'], multiportType: 'Sum' } },
  {
    label: 'Multiplied',
    title: 'Reaches the connected variable times its factor',
    port: { variables: ['v'], multiportType: 'Multiply', multiplyFactor: 2 },
  },
]
</script>

<style scoped>
.multiport-key {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.multiport-key__item {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  color: var(--p-text-muted-color);
}
</style>
