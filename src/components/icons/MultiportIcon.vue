<script>
import BaseIcon from '@primevue/icons/baseicon'

export default {
  name: 'MultiportIcon',
  extends: BaseIcon,
}
</script>

<template>
  <svg v-bind="pti()" xmlns="http://www.w3.org/2000/svg" data-name="Layer 2" viewBox="0 0 160 160">
    <circle cx="13.63" cy="81.59" r="10.81" style="fill:currentColor"/>
    <path d="M13.63 81.59h128.89" style="fill:none;stroke:currentColor;stroke-miterlimit:10;stroke-width:6px"/>
    <circle cx="146.52" cy="33.06" r="10.81" style="fill:currentColor"/>
    <circle cx="146.52" cy="130.12" r="10.81" style="fill:currentColor"/>
    <path d="M142.52 130.12c-71.06 0-39.08-48.53-98.89-48.53M142.27 33.06c-71.06 0-39.08 48.53-98.89 48.53" style="fill:none;stroke:currentColor;stroke-miterlimit:10;stroke-width:6px"/>
    <circle cx="146.52" cy="81.59" r="10.81" style="fill:currentColor"/>
  </svg>
</template>
