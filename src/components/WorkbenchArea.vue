<script setup>
import { Background } from '@vue-flow/background'
import { BACKGROUND_DOTS } from '../utils/constants'
</script>

<template>
  <div class="dropzone-background">
    <Background v-bind="BACKGROUND_DOTS" />

    <div class="overlay">
      <slot />
    </div>
  </div>
</template>

<style scoped>
.dropzone-background {
  width: 100%;
  height: 100%;
}
</style>
