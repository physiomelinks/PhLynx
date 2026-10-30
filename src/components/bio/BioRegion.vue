<template>
  <div
    :class="['bio-region', `bio-region--${data.side ?? 'other'}`, { 'bio-region--at-right': data.at === 'right', 'bio-region--selected': selected }]"
    data-testid="bio-region"
  >
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
  position: relative;
  width: 100%;
  height: 100%;
  border-radius: 12px;
  background: color-mix(in srgb, var(--p-sky-200) 40%, transparent);
  border: 2px solid transparent;
}

.bio-region--basolateral {
  background: color-mix(in srgb, var(--p-rose-200) 40%, transparent);
}

/* A paracellular space, down a cell's side */
.bio-region--lateral {
  background: color-mix(in srgb, var(--p-teal-200) 45%, transparent);
}

/* Its top runs under the cells, so its name goes at the bottom, clear of their corners */
.bio-region--basolateral .bio-region__label {
  position: absolute;
  left: 0;
  bottom: 0;
}

/* Narrow, so its name runs down it, on the outer side away from the cell */
.bio-region--lateral .bio-region__label {
  writing-mode: vertical-rl;
  padding: 12px 8px;
}

.bio-region--at-right .bio-region__label {
  position: absolute;
  top: 0;
  right: 0;
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
