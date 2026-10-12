<!-- Where files are dropped or picked; the dashed edge marks it as somewhere to act. -->
<template>
  <div class="drop"><slot /></div>
</template>

<style scoped>
.drop{border:1px dashed var(--color-outline);border-radius:var(--radius-md);padding:var(--space-page);text-align:center;display:grid;gap:var(--space-surface);justify-items:center;align-content:center;background:var(--color-surface)}
</style>
