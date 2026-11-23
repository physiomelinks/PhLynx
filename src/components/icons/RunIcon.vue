<script>
import BaseIcon from '@primevue/icons/baseicon'

/** A figure running, for running a simulation. */
export default {
  name: 'RunIcon',
  extends: BaseIcon,
}
</script>

<template>
  <svg v-bind="pti()" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="15.5" cy="4" r="2" fill="currentColor" stroke="none" />
      <path d="M6.5 10.5 10 8l3.5.5 2 3 3.5 1" />
      <path d="M13.5 8.5 11 14.5" />
      <path d="M11 14.5l3.5 2.5-1 4.5" />
      <path d="M11 14.5 8.5 18l-4 .5" />
    </g>
  </svg>
</template>
