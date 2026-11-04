<script>
import BaseIcon from '@primevue/icons/baseicon'

/** A beetle seen from above, for reporting a bug. */
export default {
  name: 'BugIcon',
  extends: BaseIcon,
}
</script>

<template>
  <svg v-bind="pti()" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">
    <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M9 7.5V6a3 3 0 0 1 6 0v1.5" />
      <path d="M8 4 6.5 2.5M16 4l1.5-1.5" />
      <rect x="6.5" y="7.5" width="11" height="13" rx="5.5" />
      <path d="M12 11v9.5" />
      <path d="M6.5 11H3M6.5 15H2.5M6.7 18.5 4 20.5M17.5 11H21M17.5 15h4M17.3 18.5l2.7 2" />
    </g>
  </svg>
</template>
