<template>
  <div :class="['bio-region', `bio-region--${data.side ?? 'other'}`, { 'bio-region--selected': selected }]" data-testid="bio-region">
    <span class="bio-region__label">{{ data.name }}</span>
  </div>
</template>

<script setup>
defineProps({
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
})
</script>

<style scoped>
.bio-region {
  width: 100%;
  height: 100%;
  border-radius: 12px;
  background: color-mix(in srgb, var(--p-sky-200) 40%, transparent);
  border: 2px solid transparent;
}

.bio-region--basolateral {
  background: color-mix(in srgb, var(--p-rose-200) 40%, transparent);
}

.bio-region--selected {
  border-color: var(--p-primary-color);
}

.bio-region__label {
  display: block;
  padding: 8px 12px;
  font-weight: 600;
  color: var(--p-text-muted-color);
}
</style>
