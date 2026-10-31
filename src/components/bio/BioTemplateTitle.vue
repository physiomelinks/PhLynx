<template>
  <div class="bio-template-title" data-testid="bio-template-title" :title="data.name">
    <i class="pi pi-objects-column"></i>
    <span>{{ data.name }}</span>
  </div>
</template>

<script setup>
defineProps({
  data: { type: Object, required: true },
})
</script>

<style scoped>
.bio-template-title {
  display: flex;
  align-items: center;
  gap: 6px;
  height: 100%;
  overflow: hidden;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
  color: var(--p-text-muted-color);
}

.bio-template-title i {
  font-size: 11px;
}
</style>
