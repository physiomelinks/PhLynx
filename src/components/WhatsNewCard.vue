<template>
  <transition name="whats-new">
    <aside v-if="shown" class="whats-new-card" role="status" aria-labelledby="whats-new-title" data-testid="whats-new">
      <div class="whats-new-icon" aria-hidden="true"><i class="pi pi-sparkles"></i></div>
      <div class="whats-new-text">
        <h2 id="whats-new-title" class="whats-new-title">PhLynx {{ whatsNew.release }} is here</h2>
        <p v-if="whatsNew.summary" class="whats-new-summary">{{ whatsNew.summary }}</p>
        <Button
          label="See what's new"
          size="small"
          class="whats-new-open"
          data-testid="whats-new-open"
          @click="openPage"
        />
      </div>
      <Button
        icon="pi pi-times"
        text
        rounded
        severity="secondary"
        size="small"
        class="whats-new-close"
        aria-label="Dismiss"
        data-testid="whats-new-dismiss"
        @click="markSeen"
      />
    </aside>
  </transition>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import Button from 'primevue/button'

import { useWhatsNew } from '../composables/useWhatsNew'

const props = defineProps({
  /** How long after start the card waits, so it does not appear while the app is still loading. */
  delay: { type: Number, default: 1500 },
})

const route = useRoute()
const router = useRouter()
const { pending, whatsNew, path, markSeen } = useWhatsNew()

const ready = ref(props.delay <= 0)
let timer = null
onMounted(() => {
  if (!ready.value) timer = setTimeout(() => (ready.value = true), props.delay)
})
onBeforeUnmount(() => clearTimeout(timer))

const onPage = computed(() => route.path.replace(/\/+$/, '') === path)
const shown = computed(() => ready.value && pending.value && !onPage.value)

// Reading the page, however it was reached, is seeing what is new.
watch(
  onPage,
  (here) => {
    if (here) markSeen()
  },
  { immediate: true }
)

function openPage() {
  markSeen()
  router.push(path)
}
</script>

<style scoped>
.whats-new-card {
  position: fixed;
  bottom: 24px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 1100;
  display: flex;
  align-items: flex-start;
  gap: 12px;
  width: min(380px, calc(100vw - 32px));
  padding: 14px 10px 14px 16px;
  border: 1px solid var(--p-content-border-color, #e5e7eb);
  border-radius: 10px;
  background-color: var(--p-content-background, #ffffff);
  color: var(--p-text-color, #1f2937);
  box-shadow: 0 10px 30px rgb(0 0 0 / 0.18);
  box-sizing: border-box;
}

.whats-new-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  width: 2rem;
  height: 2rem;
  border-radius: 999px;
  background-color: color-mix(in srgb, var(--p-primary-color, #3b82f6) 15%, transparent);
  color: var(--p-primary-color, #3b82f6);
}

.whats-new-text {
  flex: 1;
  min-width: 0;
}

.whats-new-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
}

.whats-new-summary {
  margin: 4px 0 0;
  font-size: 0.875rem;
  line-height: 1.4;
  color: var(--p-text-muted-color, #6b7280);
}

.whats-new-open {
  margin-top: 10px;
}

.whats-new-close {
  flex-shrink: 0;
  margin-top: -4px;
}

.whats-new-enter-active,
.whats-new-leave-active {
  transition: opacity 0.25s ease, transform 0.25s ease;
}

.whats-new-enter-from,
.whats-new-leave-to {
  opacity: 0;
  transform: translate(-50%, 12px);
}
</style>
