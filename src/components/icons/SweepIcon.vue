<script>
import BaseIcon from '@primevue/icons/baseicon'

/** A chart's axes with three curves, one above another, as a sweep draws one per value. */
export default {
  name: 'SweepIcon',
  extends: BaseIcon,
}
</script>

<template>
  <svg v-bind="pti()" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M3 3v18h18" />
      <g stroke-width="1.75">
        <path class="sweep-curve sweep-curve--1" d="M7 10c2.5-4 6.5-6 13-6.5" />
        <path class="sweep-curve sweep-curve--2" d="M7 14c2.5-4 6.5-6 13-6.5" />
        <path class="sweep-curve sweep-curve--3" d="M7 18c2.5-4 6.5-6 13-6.5" />
      </g>
    </g>
  </svg>
</template>
