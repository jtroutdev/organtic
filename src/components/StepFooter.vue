<!-- A wizard step's way back on the left and its way forward on the right. -->
<template>
  <div class="foot">
    <div class="row"><slot name="back" /></div>
    <div class="row"><slot /></div>
  </div>
</template>

<style scoped>
.foot{display:grid;grid-template-columns:minmax(0,auto) minmax(0,auto);justify-content:space-between;align-items:center;gap:var(--space-surface)}
.foot>:last-child{justify-content:flex-end}
</style>
