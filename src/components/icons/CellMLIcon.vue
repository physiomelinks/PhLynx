<script>
import BaseIcon from '@primevue/icons/baseicon'

export default {
  name: 'CellMLIcon',
  extends: BaseIcon,
}
</script>

<template>
  <svg v-bind="pti()" 
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 30.49 30.56"
    aria-hidden="true"
    width="1em"
    height="1em"
  >
    <g fill="currentColor">
      <circle cx="8.23" cy="8.26" r="2.6" />
      <circle cx="4.32" cy="4.29" r="1.82" />
      <circle cx="1.17" cy="1.17" r="1.17" />
      <circle cx="22.27" cy="8.5" r="2.6" />
      <circle cx="26.17" cy="4.52" r="1.82" />
      <circle cx="29.33" cy="1.4" r="1.17" />
      <circle cx="8.23" cy="22.3" r="2.6" />
      <circle cx="4.32" cy="26.27" r="1.82" />
      <circle cx="1.17" cy="29.39" r="1.17" />
      <g>
        <rect x="12.46" y="5.22" width="1.68" height="8.94" rx=".84" ry=".84" transform="translate(-.31 .43) rotate(-1.85)" />
        <rect x="8.93" y="8.73" width="1.68" height="8.94" rx=".84" ry=".84" transform="translate(23.28 3.86) rotate(91.85)" />
      </g>
      <g>
        <rect x="12.45" y="16.43" width="1.68" height="8.94" rx=".84" ry=".84" transform="translate(.68 -.42) rotate(1.85)" />
        <rect x="8.93" y="12.92" width="1.68" height="8.94" rx=".84" ry=".84" transform="translate(-7.3 27.72) rotate(-91.85)" />
      </g>
      <g>
        <rect x="16.36" y="5.25" width="1.68" height="8.94" rx=".84" ry=".84" transform="translate(34.08 20) rotate(-178.15)" />
        <rect x="19.89" y="8.76" width="1.68" height="8.94" rx=".84" ry=".84" transform="translate(33.29 -7.91) rotate(88.15)" />
      </g>
    </g>
  </svg>
</template>
