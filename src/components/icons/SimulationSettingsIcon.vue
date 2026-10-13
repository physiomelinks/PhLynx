<template>
  <!-- A line chart with a cog on its corner: simulation settings, told apart from the Simulation tab's chart. -->
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
    <defs>
      <mask :id="maskId">
        <rect width="24" height="24" fill="#fff" />
        <!-- A gap around the cog, so it reads apart from the chart on any background. -->
        <circle cx="17.5" cy="17.5" r="7.2" fill="#000" />
      </mask>
    </defs>
    <g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" :mask="`url(#${maskId})`">
      <path d="M2.5 2.5v19h19" />
      <path d="M6.5 13.5l3.5-4.5 3 3 6-7" />
    </g>
    <g fill="none" stroke="currentColor">
      <!-- Eight teeth, as dashes around the rim. -->
      <circle cx="17.5" cy="17.5" r="4.6" stroke-width="2.6" stroke-dasharray="1.85 1.76" />
      <circle cx="17.5" cy="17.5" r="2.9" stroke-width="1.9" />
    </g>
  </svg>
</template>

<script setup>
import { useId } from 'vue'

// Each icon needs its own mask id, as several can be on the page at once.
const maskId = useId()
</script>
